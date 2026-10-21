import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma';
import { authenticateToken, generateTokens, verifyRefreshToken, AuthenticatedRequest } from '../middleware/auth';
import { asyncHandler, createError } from '../middleware/errorHandler';
import { seedDefaultPermissions, getUserPermissionsList } from '../services/permissions';
import { RoleName } from '../constants/access';

const router = Router();

// Register new workspace and super-admin user
router.post('/register', asyncHandler(async (req: Request, res: Response) => {
  const { email, password, firstName, lastName, workspaceName } = req.body;

  // Validate required fields
  if (!email || !password || !firstName || !lastName || !workspaceName) {
    throw createError('All fields are required', 400, 'VALIDATION_ERROR');
  }

  // Check if user already exists
  const existingUser = await prisma.user.findFirst({
    where: { email: email.toLowerCase() },
  });

  if (existingUser) {
    throw createError('User already exists with this email', 409, 'USER_EXISTS');
  }

  // Hash password
  const saltRounds = 12;
  const passwordHash = await bcrypt.hash(password, saltRounds);

  // Generate API keys for workspace
  const apiKey = `iap_${uuidv4().replace(/-/g, '').substring(0, 32)}`;
  const apiSecret = `ias_${uuidv4().replace(/-/g, '').substring(0, 32)}`;

  // Create workspace and user in transaction
  const result = await prisma.$transaction(async (tx) => {
    const workspace = await tx.workspace.create({
      data: {
        name: workspaceName,
        apiKey,
        apiSecret,
        planType: 'starter',
        status: 'active',
      },
    });

    const user = await tx.user.create({
      data: {
        workspaceId: workspace.workspaceId,
        email: email.toLowerCase(),
        passwordHash,
        firstName,
        lastName,
        role: 'SUPER_ADMIN',
        isActive: true,
      },
    });

    return { workspace, user };
  });

  // Seed default permissions for all operational roles in the new workspace
  await seedDefaultPermissions(result.workspace.workspaceId);

  // Generate tokens
  const tokens = generateTokens(result.user.userId, result.workspace.workspaceId);

  res.status(201).json({
    success: true,
    data: {
      user: {
        id: result.user.userId,
        email: result.user.email,
        firstName: result.user.firstName,
        lastName: result.user.lastName,
        first_name: result.user.firstName,
        last_name: result.user.lastName,
        role: result.user.role,
        permissions: ['*'],
      },
      workspace: {
        id: result.workspace.workspaceId,
        name: result.workspace.name,
        slug: result.workspace.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        apiKey: result.workspace.apiKey,
        planType: result.workspace.planType,
      },
      tokens,
      token: tokens.accessToken,
    },
  });
}));

// Login user
router.post('/login', asyncHandler(async (req: Request, res: Response) => {
  const { email, password } = req.body;

  if (!email || !password) {
    throw createError('Email and password are required', 400, 'VALIDATION_ERROR');
  }

  // Find user by email
  const user = await prisma.user.findFirst({
    where: { email: email.toLowerCase() },
  });

  if (!user) {
    throw createError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
  }

  if (!user.isActive) {
    throw createError('Account is inactive', 401, 'ACCOUNT_INACTIVE');
  }

  // Verify workspace
  let workspace = null;
  if (user.workspaceId) {
    workspace = await prisma.workspace.findUnique({
      where: { workspaceId: user.workspaceId },
    });
    if (workspace && workspace.status !== 'active') {
      throw createError('Workspace is inactive or suspended', 403, 'WORKSPACE_INACTIVE');
    }
  }

  // Verify password
  const isValidPassword = await bcrypt.compare(password, user.passwordHash);
  if (!isValidPassword) {
    throw createError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
  }

  // Generate tokens
  const workspaceId = user.workspaceId || '';
  const tokens = generateTokens(user.userId, workspaceId);
  const permissions = workspaceId
    ? await getUserPermissionsList(workspaceId, user.role as RoleName)
    : [];

  res.json({
    success: true,
    data: {
      user: {
        id: user.userId,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        first_name: user.firstName,
        last_name: user.lastName,
        role: user.role,
        permissions,
      },
      workspace: workspace ? {
        id: workspace.workspaceId,
        name: workspace.name,
        slug: workspace.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      } : null,
      tokens,
      token: tokens.accessToken,
    },
  });
}));

// Refresh token
router.post('/refresh', asyncHandler(async (req: Request, res: Response) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    throw createError('Refresh token is required', 400, 'VALIDATION_ERROR');
  }

  try {
    const decoded = verifyRefreshToken(refreshToken);
    const userId = decoded.userId;

    const user = await prisma.user.findUnique({
      where: { userId },
    });

    if (!user || !user.isActive) {
      throw createError('User not found or inactive', 401, 'USER_NOT_FOUND');
    }

    const tokens = generateTokens(user.userId, user.workspaceId || '');

    res.json({
      success: true,
      data: { tokens, token: tokens.accessToken }
    });
  } catch (error) {
    throw createError('Invalid or expired refresh token', 401, 'INVALID_REFRESH_TOKEN');
  }
}));

// Logout
router.post('/logout', asyncHandler(async (req: Request, res: Response) => {
  res.json({
    success: true,
    message: 'Logged out successfully'
  });
}));

// Get current user profile / me / validate-token handler
const handleCurrentUser = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    throw createError('Authentication required', 401, 'UNAUTHORIZED');
  }

  const user = await prisma.user.findUnique({
    where: { userId },
  });

  if (!user) {
    throw createError('User not found', 404, 'USER_NOT_FOUND');
  }

  const workspace = user.workspaceId
    ? await prisma.workspace.findUnique({ where: { workspaceId: user.workspaceId } })
    : null;

  const permissions = user.workspaceId
    ? await getUserPermissionsList(user.workspaceId, user.role as RoleName)
    : [];

  res.json({
    success: true,
    data: {
      valid: true,
      user: {
        id: user.userId,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        first_name: user.firstName,
        last_name: user.lastName,
        role: user.role,
        permissions,
        isActive: user.isActive,
        lastLoginAt: user.lastLoginAt,
      },
      workspace: workspace ? {
        id: workspace.workspaceId,
        name: workspace.name,
        slug: workspace.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        planType: workspace.planType,
        apiKey: workspace.apiKey,
      } : null,
    },
  });
});

router.get('/profile', authenticateToken, handleCurrentUser);
router.get('/me', authenticateToken, handleCurrentUser);
router.get('/validate-token', authenticateToken, handleCurrentUser);

// Change password
router.put('/change-password', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    throw createError('Current password and new password are required', 400, 'VALIDATION_ERROR');
  }

  if (newPassword.length < 8) {
    throw createError('New password must be at least 8 characters long', 400, 'WEAK_PASSWORD');
  }

  const user = await prisma.user.findUnique({
    where: { userId: req.user!.id },
  });

  if (!user) {
    throw createError('User not found', 404, 'USER_NOT_FOUND');
  }

  // Verify current password
  const isValidPassword = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!isValidPassword) {
    throw createError('Current password is incorrect', 401, 'INVALID_CURRENT_PASSWORD');
  }

  // Hash new password
  const saltRounds = 12;
  const newPasswordHash = await bcrypt.hash(newPassword, saltRounds);

  // Update password
  await prisma.user.update({
    where: { userId: req.user!.id },
    data: { passwordHash: newPasswordHash },
  });

  res.json({
    success: true,
    message: 'Password changed successfully'
  });
}));

export default router;
