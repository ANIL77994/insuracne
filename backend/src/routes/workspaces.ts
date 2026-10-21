import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcrypt';
import { db } from '../database/connection';
import { prisma } from '../lib/prisma';
import { requireRole } from '../middleware/auth';
import { asyncHandler, createError } from '../middleware/errorHandler';

const router = Router();

// Get workspace details
router.get('/', asyncHandler(async (req: any, res: Response) => {
  const workspaceQuery = await db.query(`
    SELECT 
      w.workspace_id, w.name, w.domain, w.plan_type, w.status, w.settings,
      w.api_key, w.created_at, w.updated_at,
      COUNT(u.user_id) as user_count,
      COUNT(CASE WHEN u.last_login_at >= NOW() - INTERVAL '30 days' THEN 1 END) as active_users_30d
    FROM workspaces w
    LEFT JOIN users u ON w.workspace_id = u.workspace_id
    WHERE w.workspace_id = $1
    GROUP BY w.workspace_id, w.name, w.domain, w.plan_type, w.status, w.settings, w.api_key, w.created_at, w.updated_at
  `, [req.workspace_id]);

  if (workspaceQuery.rows.length === 0) {
    throw createError('Workspace not found', 404, 'WORKSPACE_NOT_FOUND');
  }

  const workspace = workspaceQuery.rows[0];

  res.json({
    success: true,
    data: {
      workspace: {
        id: workspace.workspace_id,
        name: workspace.name,
        domain: workspace.domain,
        planType: workspace.plan_type,
        status: workspace.status,
        settings: workspace.settings || {},
        userCount: parseInt(workspace.user_count),
        activeUsers30d: parseInt(workspace.active_users_30d),
        createdAt: workspace.created_at
      }
    }
  });
}));

// Update workspace settings
router.put('/settings', requireRole(['admin']), asyncHandler(async (req: any, res: Response) => {
  const { name, domain, settings } = req.body;

  const updates: string[] = [];
  const values: any[] = [req.workspace_id];
  let paramCount = 1;

  if (name) {
    paramCount++;
    updates.push(`name = $${paramCount}`);
    values.push(name);
  }

  if (domain !== undefined) {
    paramCount++;
    updates.push(`domain = $${paramCount}`);
    values.push(domain);
  }

  if (settings) {
    paramCount++;
    updates.push(`settings = $${paramCount}`);
    values.push(JSON.stringify(settings));
  }

  if (updates.length === 0) {
    throw createError('No valid fields to update', 400, 'VALIDATION_ERROR');
  }

  paramCount++;
  updates.push(`updated_at = NOW()`);

  const updateQuery = await db.query(
    `UPDATE workspaces SET ${updates.join(', ')} WHERE workspace_id = $1`,
    values
  );

  if (updateQuery.rowCount === 0) {
    throw createError('Workspace not found', 404, 'WORKSPACE_NOT_FOUND');
  }

  res.json({
    success: true,
    message: 'Workspace settings updated successfully'
  });
}));

// Get workspace users
router.get('/users', requireRole(['admin', 'manager']), asyncHandler(async (req: any, res: Response) => {
  const { page = 1, limit = 20, search, role } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  let whereClause = 'WHERE workspace_id = $1';
  const queryParams = [req.workspace_id];
  let paramCount = 1;

  if (search) {
    paramCount++;
    whereClause += ` AND (first_name ILIKE $${paramCount} OR last_name ILIKE $${paramCount} OR email ILIKE $${paramCount})`;
    queryParams.push(`%${search}%`);
  }

  if (role) {
    paramCount++;
    whereClause += ` AND role = $${paramCount}`;
    queryParams.push(role);
  }

  const usersQuery = await db.query(`
    SELECT 
      user_id, email, first_name, last_name, role, permissions,
      is_active, last_login_at, created_at
    FROM users 
    ${whereClause}
    ORDER BY created_at DESC
    LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}
  `, [...queryParams, parseInt(limit), offset]);

  const countQuery = await db.query(
    `SELECT COUNT(*) as total FROM users ${whereClause}`,
    queryParams
  );

  res.json({
    success: true,
    data: {
      users: usersQuery.rows.map(user => ({
        id: user.user_id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role,
        permissions: user.permissions || [],
        isActive: user.is_active,
        lastLoginAt: user.last_login_at,
        createdAt: user.created_at
      })),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(countQuery.rows[0].total),
        pages: Math.ceil(parseInt(countQuery.rows[0].total) / parseInt(limit))
      }
    }
  });
}));

// Invite user to workspace
router.post('/users/invite', requireRole(['admin']), asyncHandler(async (req: any, res: Response) => {
  const { email, role, permissions } = req.body;

  if (!email || !role) {
    throw createError('Email and role are required', 400, 'VALIDATION_ERROR');
  }

  // Check if user already exists in workspace
  const existingUser = await prisma.user.findFirst({
    where: {
      email: email.toLowerCase(),
      workspaceId: req.workspace_id,
    },
  });

  if (existingUser) {
    throw createError('User already exists in this workspace', 409, 'USER_EXISTS');
  }

  const temporaryPassword = uuidv4().substring(0, 8);
  const saltRounds = 12;
  const passwordHash = await bcrypt.hash(temporaryPassword, saltRounds);

  const newUser = await prisma.user.create({
    data: {
      workspaceId: req.workspace_id,
      email: email.toLowerCase(),
      passwordHash,
      firstName: '',
      lastName: '',
      role,
      isActive: false,
    },
  });

  res.status(201).json({
    success: true,
    data: {
      userId: newUser.userId,
      email: newUser.email,
      role: newUser.role,
      temporaryPassword, // In production, send via email
    },
  });
}));

// Update user
router.put('/users/:userId', requireRole(['admin']), asyncHandler(async (req: any, res: Response) => {
  const { userId } = req.params;
  const { firstName, lastName, role, isActive } = req.body;

  const targetUser = await prisma.user.findFirst({
    where: { userId, workspaceId: req.workspace_id },
  });

  if (!targetUser) {
    throw createError('User not found', 404, 'USER_NOT_FOUND');
  }

  const updatedUser = await prisma.user.update({
    where: { userId },
    data: {
      firstName: firstName !== undefined ? firstName : undefined,
      lastName: lastName !== undefined ? lastName : undefined,
      role: role !== undefined ? role : undefined,
      isActive: isActive !== undefined ? isActive : undefined,
    },
  });

  res.json({
    success: true,
    data: {
      user: updatedUser,
    },
  });
}));

// Deactivate user
router.delete('/users/:userId', requireRole(['admin']), asyncHandler(async (req: any, res: Response) => {
  const { userId } = req.params;

  // Prevent self-deactivation
  if (userId === req.user.id) {
    throw createError('Cannot deactivate your own account', 400, 'SELF_DEACTIVATION_NOT_ALLOWED');
  }

  const updateQuery = await db.query(
    'UPDATE users SET is_active = false, updated_at = NOW() WHERE user_id = $1 AND workspace_id = $2',
    [userId, req.workspace_id]
  );

  if (updateQuery.rowCount === 0) {
    throw createError('User not found', 404, 'USER_NOT_FOUND');
  }

  res.json({
    success: true,
    message: 'User deactivated successfully'
  });
}));

// Get workspace statistics
router.get('/stats', requireRole(['admin', 'manager']), asyncHandler(async (req: any, res: Response) => {
  const statsQuery = await db.query(`
    SELECT 
      -- User statistics
      COUNT(u.user_id) as total_users,
      COUNT(CASE WHEN u.is_active = true THEN 1 END) as active_users,
      COUNT(CASE WHEN u.last_login_at >= NOW() - INTERVAL '30 days' THEN 1 END) as active_users_30d,
      
      -- Policy statistics
      COUNT(p.policy_id) as total_policies,
      COUNT(CASE WHEN p.status = 'active' THEN 1 END) as active_policies,
      
      -- Claims statistics
      COUNT(c.claim_id) as total_claims,
      COUNT(CASE WHEN c.status = 'open' THEN 1 END) as open_claims,
      
      -- Revenue statistics
      COALESCE(SUM(CASE WHEN p.status = 'active' THEN p.premium_amount ELSE 0 END), 0) as total_premium,
      COALESCE(SUM(CASE WHEN br.status = 'paid' THEN br.amount ELSE 0 END), 0) as collected_premium
    FROM workspaces w
    LEFT JOIN users u ON w.workspace_id = u.workspace_id
    LEFT JOIN policies p ON w.workspace_id = p.workspace_id
    LEFT JOIN claims c ON w.workspace_id = c.workspace_id
    LEFT JOIN billing_records br ON w.workspace_id = br.workspace_id
    WHERE w.workspace_id = $1
    GROUP BY w.workspace_id
  `, [req.workspace_id]);

  const stats = statsQuery.rows[0];

  res.json({
    success: true,
    data: {
      users: {
        total: parseInt(stats.total_users),
        active: parseInt(stats.active_users),
        active30d: parseInt(stats.active_users_30d)
      },
      policies: {
        total: parseInt(stats.total_policies),
        active: parseInt(stats.active_policies)
      },
      claims: {
        total: parseInt(stats.total_claims),
        open: parseInt(stats.open_claims)
      },
      revenue: {
        totalPremium: parseFloat(stats.total_premium),
        collectedPremium: parseFloat(stats.collected_premium),
        collectionRate: stats.total_premium > 0 ? 
          ((parseFloat(stats.collected_premium) / parseFloat(stats.total_premium)) * 100).toFixed(2) : '0.00'
      }
    }
  });
}));

export default router;