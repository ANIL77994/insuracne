import { Router, Response } from 'express';
import bcrypt from 'bcrypt';
import { prisma } from '../lib/prisma';
import { requireRole, AuthenticatedRequest } from '../middleware/auth';
import { requireAccessContext, requireFeature, AccessRequest } from '../middleware/access';
import { asyncHandler, createError } from '../middleware/errorHandler';
import {
  ROLES,
  PROTECTED_ROLES,
  RoleName,
  Feature,
  isRole,
  isFeature,
} from '../constants/access';
import {
  getRoleMatrix,
  getAllMatrices,
  invalidateWorkspace,
  seedDefaultPermissions,
} from '../services/permissions';

const router = Router();

// System status
router.get('/system-status', requireRole(['admin']), asyncHandler(async (req: any, res: Response) => {
  res.json({
    success: true,
    data: {
      status: 'healthy',
      version: '1.0.0',
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      message: 'System status check'
    }
  });
}));

// System logs
router.get('/logs', requireRole(['admin']), asyncHandler(async (req: any, res: Response) => {
  res.json({
    success: true,
    data: {
      logs: [],
      message: 'System logs'
    }
  });
}));

// ─────────────────────────────────────────────────────────────────────────────
// ME / PERMISSIONS (Effective permissions for current authenticated user)
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  '/me/permissions',
  requireAccessContext,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const accessReq = req as AccessRequest;
    const { workspaceId, role, userId } = accessReq.access;

    const matrix = await getRoleMatrix(workspaceId, role);

    res.json({
      success: true,
      data: {
        userId,
        workspaceId,
        role,
        features: matrix.features,
        claimActions: matrix.claimActions,
        permissions: req.user?.permissions || [],
      },
    });
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// ACCESS LEVELS (Role Matrix Configuration)
// ─────────────────────────────────────────────────────────────────────────────

// View all 8 roles & their permission matrices
router.get(
  '/access-levels',
  requireFeature('access_levels', 'view'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const workspaceId = req.workspace_id!;
    await seedDefaultPermissions(workspaceId);

    const matrices = await getAllMatrices(workspaceId);
    const roles = ROLES.map((role) => ({
      role,
      ...matrices[role],
    }));

    res.json({
      success: true,
      data: {
        roles,
      },
    });
  })
);

// Update a role's permissions matrix
router.put(
  '/access-levels/:role',
  requireFeature('access_levels', 'update'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const workspaceId = req.workspace_id!;
    const targetRole = req.params.role as RoleName;

    if (!isRole(targetRole)) {
      throw createError(`Invalid role: ${req.params.role}`, 400, 'VALIDATION_ERROR');
    }

    // SUPER_ADMIN role matrix is immutable
    if (targetRole === 'SUPER_ADMIN') {
      throw createError('SUPER_ADMIN role matrix is immutable and cannot be modified', 403, 'FORBIDDEN');
    }

    // Privilege escalation check: An ordinary admin cannot grant permissions they do not possess
    if (req.user?.role !== 'SUPER_ADMIN' && PROTECTED_ROLES.includes(targetRole)) {
      throw createError('Only a SUPER_ADMIN can modify protected roles', 403, 'FORBIDDEN');
    }

    const { features, claimActions } = req.body;

    await prisma.$transaction(async (tx) => {
      // 1. Update features
      if (Array.isArray(features)) {
        for (const item of features) {
          if (!item.feature || !isFeature(item.feature)) continue;

          await tx.rolePermission.upsert({
            where: {
              workspaceId_role_feature: {
                workspaceId,
                role: targetRole,
                feature: item.feature,
              },
            },
            update: {
              canView: Boolean(item.canView),
              canCreate: Boolean(item.canCreate),
              canUpdate: Boolean(item.canUpdate),
              canDelete: Boolean(item.canDelete),
              updatedBy: req.user?.id,
            },
            create: {
              workspaceId,
              role: targetRole,
              feature: item.feature,
              canView: Boolean(item.canView),
              canCreate: Boolean(item.canCreate),
              canUpdate: Boolean(item.canUpdate),
              canDelete: Boolean(item.canDelete),
              updatedBy: req.user?.id,
            },
          });
        }
      }

      // 2. Update claim actions if provided
      if (Array.isArray(claimActions)) {
        await tx.roleClaimAction.deleteMany({
          where: {
            workspaceId,
            role: targetRole,
          },
        });

        if (claimActions.length > 0) {
          await tx.roleClaimAction.createMany({
            data: claimActions.map((ca: any) => ({
              workspaceId,
              role: targetRole,
              claimType: ca.claimType || '*',
              action: ca.action,
            })),
          });
        }
      }
    });

    // Invalidate permission cache so changes take effect immediately across all requests
    invalidateWorkspace(workspaceId);

    const updatedMatrix = await getRoleMatrix(workspaceId, targetRole);

    res.json({
      success: true,
      data: updatedMatrix,
    });
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// USER & EMPLOYEE MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

// List users in current workspace
router.get(
  '/users',
  requireFeature('users', 'view'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const workspaceId = req.workspace_id!;

    const users = await prisma.user.findMany({
      where: { workspaceId },
      select: {
        userId: true,
        workspaceId: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      success: true,
      data: {
        users,
      },
    });
  })
);

// Create employee / admin
router.post(
  '/users',
  requireFeature('users', 'create'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const workspaceId = req.workspace_id!;
    const { email, password, firstName, lastName, role } = req.body;

    if (!email || !firstName || !lastName || !role) {
      throw createError('Email, first name, last name, and role are required', 400, 'VALIDATION_ERROR');
    }

    if (!isRole(role)) {
      throw createError(`Invalid role: ${role}`, 400, 'VALIDATION_ERROR');
    }

    // Privilege escalation prevention: Non-SUPER_ADMIN cannot create a SUPER_ADMIN or DEVELOPER
    if (req.user?.role !== 'SUPER_ADMIN' && PROTECTED_ROLES.includes(role)) {
      throw createError('Only a SUPER_ADMIN can create users with protected roles', 403, 'FORBIDDEN');
    }

    // Check if user already exists in workspace
    const existing = await prisma.user.findFirst({
      where: {
        workspaceId,
        email: email.toLowerCase(),
      },
    });

    if (existing) {
      throw createError('User already exists in this workspace', 409, 'USER_EXISTS');
    }

    const saltRounds = 10;
    const defaultPassword = password || 'Password@123';
    const passwordHash = await bcrypt.hash(defaultPassword, saltRounds);

    const newUser = await prisma.user.create({
      data: {
        workspaceId,
        email: email.toLowerCase(),
        passwordHash,
        firstName,
        lastName,
        role,
        isActive: true,
      },
      select: {
        userId: true,
        workspaceId: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
    });

    // Ensure default permissions are seeded
    await seedDefaultPermissions(workspaceId);

    res.status(201).json({
      success: true,
      data: {
        user: newUser,
      },
    });
  })
);

// Update user / employee
router.put(
  '/users/:userId',
  requireFeature('users', 'update'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const workspaceId = req.workspace_id!;
    const { userId } = req.params;
    const { firstName, lastName, role, isActive, status } = req.body;

    const targetUser = await prisma.user.findFirst({
      where: { userId, workspaceId },
    });

    if (!targetUser) {
      throw createError('User not found', 404, 'NOT_FOUND');
    }

    // ─────────────────────────────────────────────────────────
    // Self-Modification Protections
    // ─────────────────────────────────────────────────────────
    if (req.user?.id === userId) {
      // 1. Cannot change own role
      if (role !== undefined && role !== req.user.role) {
        throw createError('You cannot change your own role', 400, 'SELF_UPDATE');
      }

      // 2. Cannot deactivate own account
      if (isActive === false || status === 'inactive') {
        throw createError('You cannot deactivate your own account', 400, 'SELF_UPDATE');
      }
    }

    // ─────────────────────────────────────────────────────────
    // Privilege Escalation Guards
    // ─────────────────────────────────────────────────────────
    if (req.user?.role !== 'SUPER_ADMIN') {
      // Ordinary admin cannot touch a SUPER_ADMIN or promote anyone to SUPER_ADMIN
      if (targetUser.role === 'SUPER_ADMIN' || (role && role === 'SUPER_ADMIN')) {
        throw createError('Cannot modify or grant SUPER_ADMIN privileges', 403, 'FORBIDDEN');
      }
      if (role && PROTECTED_ROLES.includes(role as RoleName)) {
        throw createError('Cannot grant protected roles', 403, 'FORBIDDEN');
      }
    }

    if (role !== undefined && !isRole(role)) {
      throw createError(`Invalid role: ${role}`, 400, 'VALIDATION_ERROR');
    }

    const updatedUser = await prisma.user.update({
      where: { userId },
      data: {
        firstName: firstName !== undefined ? firstName : undefined,
        lastName: lastName !== undefined ? lastName : undefined,
        role: role !== undefined ? role : undefined,
        isActive: isActive !== undefined ? isActive : (status ? status === 'active' : undefined),
      },
      select: {
        userId: true,
        workspaceId: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        updatedAt: true,
      },
    });

    res.json({
      success: true,
      data: {
        user: updatedUser,
      },
    });
  })
);

// Delete user / employee
router.delete(
  '/users/:userId',
  requireFeature('users', 'delete'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const workspaceId = req.workspace_id!;
    const { userId } = req.params;

    // Self-deletion protection
    if (req.user?.id === userId) {
      throw createError('You cannot delete your own account', 400, 'SELF_DELETE');
    }

    const targetUser = await prisma.user.findFirst({
      where: { userId, workspaceId },
    });

    if (!targetUser) {
      throw createError('User not found', 404, 'NOT_FOUND');
    }

    // Privilege guard
    if (req.user?.role !== 'SUPER_ADMIN' && targetUser.role === 'SUPER_ADMIN') {
      throw createError('Only a SUPER_ADMIN can delete another SUPER_ADMIN', 403, 'FORBIDDEN');
    }

    await prisma.user.delete({
      where: { userId },
    });

    res.json({
      success: true,
      message: 'User deleted successfully',
    });
  })
);

export default router;