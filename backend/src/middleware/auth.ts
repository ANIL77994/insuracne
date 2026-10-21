import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma';
import { getUserPermissionsList } from '../services/permissions';
import { RoleName } from '../constants/access';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: string;
    workspace_id: string;
    permissions: string[];
  };
  workspace_id?: string;
  workspace?: {
    id: string;
    slug?: string;
    name?: string;
  };
}

export const authenticateToken = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Access token required'
      });
    }

    const jwtSecret = process.env.JWT_SECRET || 'your-secret-key';
    
    const decoded = jwt.verify(token, jwtSecret) as any;
    const userId = decoded.userId || decoded.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Invalid token payload'
      });
    }
    
    // Verify user exists and is active via Prisma
    const user = await prisma.user.findUnique({
      where: { userId },
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Invalid token - user not found'
      });
    }

    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        error: 'Account is inactive'
      });
    }

    if (!user.workspaceId) {
      return res.status(401).json({
        success: false,
        error: 'User has no associated workspace'
      });
    }

    // Load effective permissions dynamically from database / cache
    const permissions = await getUserPermissionsList(
      user.workspaceId,
      user.role as RoleName
    );

    // Update last login timestamp asynchronously
    prisma.user.update({
      where: { userId: user.userId },
      data: { lastLoginAt: new Date() }
    }).catch((err) => console.error('Failed to update last login:', err));

    req.user = {
      id: user.userId,
      email: user.email,
      role: user.role,
      workspace_id: user.workspaceId,
      permissions
    };

    req.workspace_id = user.workspaceId;
    req.workspace = {
      id: user.workspaceId,
    };

    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      return res.status(401).json({
        success: false,
        error: 'Invalid token'
      });
    }

    if (error instanceof jwt.TokenExpiredError) {
      return res.status(401).json({
        success: false,
        error: 'Token expired'
      });
    }

    console.error('Authentication error:', error);
    return res.status(500).json({
      success: false,
      error: 'Authentication failed'
    });
  }
};

export const requireRole = (roles: string[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    // SUPER_ADMIN has full access across all role-based checks
    if (req.user.role === 'SUPER_ADMIN') {
      return next();
    }

    const matchesRole = roles.some((r) => {
      if (r === 'admin' && (req.user!.role === 'SUPER_ADMIN' || req.user!.role === 'POLICY_ADMINISTRATOR')) return true;
      return r.toLowerCase() === req.user!.role.toLowerCase();
    });

    if (!matchesRole) {
      return res.status(403).json({
        success: false,
        error: `Insufficient permissions. Required roles: ${roles.join(', ')}`
      });
    }

    next();
  };
};

export const requirePermission = (permission: string) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    if (!req.user.permissions.includes(permission)) {
      return res.status(403).json({
        success: false,
        error: `Permission required: ${permission}`
      });
    }

    next();
  };
};

export const generateTokens = (userId: string, workspaceId: string) => {
  const jwtSecret = process.env.JWT_SECRET || 'your-secret-key';
  const jwtRefreshSecret = process.env.JWT_REFRESH_SECRET || 'your-refresh-secret';

  const accessToken = jwt.sign(
    { 
      userId, 
      workspaceId,
      type: 'access'
    },
    jwtSecret,
    { expiresIn: '15m' }
  );

  const refreshToken = jwt.sign(
    { 
      userId, 
      workspaceId,
      type: 'refresh'
    },
    jwtRefreshSecret,
    { expiresIn: '7d' }
  );

  return { accessToken, refreshToken };
};

export const verifyRefreshToken = (token: string) => {
  const jwtRefreshSecret = process.env.JWT_REFRESH_SECRET || 'your-refresh-secret';
  
  try {
    const decoded = jwt.verify(token, jwtRefreshSecret) as any;
    
    if (decoded.type !== 'refresh') {
      throw new Error('Invalid token type');
    }

    return decoded;
  } catch (error) {
    throw new Error('Invalid refresh token');
  }
};