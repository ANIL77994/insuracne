import { Router, Response } from 'express';
import { prisma } from '../lib/prisma';
import { requireFeature } from '../middleware/access';
import { asyncHandler, createError } from '../middleware/errorHandler';
import { AuthenticatedRequest } from '../middleware/auth';
import { FEATURES, CLAIM_ACTIONS, isFeature, UUID_RE } from '../constants/access';
import { getRoleMatrix, invalidateWorkspace } from '../services/permissions';

const router = Router();

// GET /admin/users/:userId/permissions
router.get(
  '/:userId/permissions',
  requireFeature('users', 'view'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const workspaceId = req.workspace_id!;
    const { userId } = req.params;

    if (!UUID_RE.test(userId)) throw createError('Invalid user id', 400, 'VALIDATION_ERROR');

    const user = await prisma.user.findFirst({
      where: { userId, workspaceId },
      select: {
        userId: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
      },
    });
    if (!user) throw createError('User not found', 404, 'NOT_FOUND');

    const roleMatrix = await getRoleMatrix(workspaceId, user.role as any);

    const overrides = await prisma.userPermissionOverride.findMany({
      where: { workspaceId, userId },
    });

    const overrideMap: Record<
      string,
      { canView: boolean; canCreate: boolean; canUpdate: boolean; canDelete: boolean }
    > = {};
    for (const o of overrides) {
      overrideMap[o.feature] = {
        canView: o.canView,
        canCreate: o.canCreate,
        canUpdate: o.canUpdate,
        canDelete: o.canDelete,
      };
    }

    // Merge: user override takes priority over role matrix
    const mergedFeatures: Record<
      string,
      { view: boolean; create: boolean; update: boolean; delete: boolean; isOverride: boolean }
    > = {};
    for (const feature of FEATURES) {
      const roleRow = roleMatrix.features[feature] ?? {
        view: false,
        create: false,
        update: false,
        delete: false,
      };
      if (overrideMap[feature] !== undefined) {
        const ov = overrideMap[feature];
        mergedFeatures[feature] = {
          view: ov.canView,
          create: ov.canCreate,
          update: ov.canUpdate,
          delete: ov.canDelete,
          isOverride: true,
        };
      } else {
        mergedFeatures[feature] = { ...roleRow, isOverride: false };
      }
    }

    res.json({
      success: true,
      data: {
        user,
        roleMatrix: roleMatrix.features,
        overrides: overrideMap,
        mergedFeatures,
        claimActions: roleMatrix.claimActions,
        availableFeatures: FEATURES,
        availableClaimActions: CLAIM_ACTIONS,
      },
    });
  })
);

// PUT /admin/users/:userId/permissions
// Any user with 'users:update' permission can set per-user overrides.
// SUPER_ADMIN users are protected — only another SUPER_ADMIN can modify them.
router.put(
  '/:userId/permissions',
  requireFeature('users', 'update'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const workspaceId = req.workspace_id!;
    const { userId } = req.params;

    if (!UUID_RE.test(userId)) throw createError('Invalid user id', 400, 'VALIDATION_ERROR');

    if (req.user?.id === userId) {
      throw createError('You cannot modify your own permission overrides', 400, 'SELF_UPDATE');
    }

    const targetUser = await prisma.user.findFirst({
      where: { userId, workspaceId },
      select: { userId: true, role: true, email: true, firstName: true, lastName: true },
    });
    if (!targetUser) throw createError('User not found', 404, 'NOT_FOUND');

    if (targetUser.role === 'SUPER_ADMIN' && req.user?.role !== 'SUPER_ADMIN') {
      throw createError('Cannot modify permission overrides for a SUPER_ADMIN user', 403, 'FORBIDDEN');
    }

    const { features } = req.body as {
      features: Record<
        string,
        { canView: boolean; canCreate: boolean; canUpdate: boolean; canDelete: boolean } | null
      >;
    };

    if (!features || typeof features !== 'object') {
      throw createError('features object is required', 400, 'VALIDATION_ERROR');
    }

    await prisma.$transaction(async (tx) => {
      for (const [feature, value] of Object.entries(features)) {
        if (!isFeature(feature as any)) continue;
        if (value === null) {
          // null = reset this feature override back to role default
          await tx.userPermissionOverride.deleteMany({ where: { workspaceId, userId, feature } });
        } else {
          await tx.userPermissionOverride.upsert({
            where: { workspaceId_userId_feature: { workspaceId, userId, feature } },
            update: {
              canView: Boolean(value.canView),
              canCreate: Boolean(value.canCreate),
              canUpdate: Boolean(value.canUpdate),
              canDelete: Boolean(value.canDelete),
              updatedBy: req.user?.id,
            },
            create: {
              workspaceId,
              userId,
              feature,
              canView: Boolean(value.canView),
              canCreate: Boolean(value.canCreate),
              canUpdate: Boolean(value.canUpdate),
              canDelete: Boolean(value.canDelete),
              updatedBy: req.user?.id,
            },
          });
        }
      }
    });

    invalidateWorkspace(workspaceId);

    // Return updated merged view
    const roleMatrix = await getRoleMatrix(workspaceId, targetUser.role as any);
    const updatedOverrides = await prisma.userPermissionOverride.findMany({
      where: { workspaceId, userId },
    });
    const overrideMap: Record<
      string,
      { canView: boolean; canCreate: boolean; canUpdate: boolean; canDelete: boolean }
    > = {};
    for (const o of updatedOverrides) {
      overrideMap[o.feature] = {
        canView: o.canView,
        canCreate: o.canCreate,
        canUpdate: o.canUpdate,
        canDelete: o.canDelete,
      };
    }

    res.json({
      success: true,
      message: `Permissions for ${targetUser.firstName} ${targetUser.lastName} updated successfully`,
      data: {
        user: targetUser,
        overrides: overrideMap,
        roleMatrix: roleMatrix.features,
      },
    });
  })
);

// DELETE /admin/users/:userId/permissions
// Reset ALL per-user overrides — reverts the user entirely to their role defaults.
router.delete(
  '/:userId/permissions',
  requireFeature('users', 'update'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const workspaceId = req.workspace_id!;
    const { userId } = req.params;

    if (!UUID_RE.test(userId)) throw createError('Invalid user id', 400, 'VALIDATION_ERROR');

    const targetUser = await prisma.user.findFirst({
      where: { userId, workspaceId },
      select: { userId: true, role: true, firstName: true, lastName: true },
    });
    if (!targetUser) throw createError('User not found', 404, 'NOT_FOUND');

    if (targetUser.role === 'SUPER_ADMIN' && req.user?.role !== 'SUPER_ADMIN') {
      throw createError('Cannot reset permissions for a SUPER_ADMIN user', 403, 'FORBIDDEN');
    }

    await prisma.userPermissionOverride.deleteMany({ where: { workspaceId, userId } });
    invalidateWorkspace(workspaceId);

    res.json({
      success: true,
      message: `All custom overrides for ${targetUser.firstName} ${targetUser.lastName} have been reset to role defaults`,
    });
  })
);

export default router;
