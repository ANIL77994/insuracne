import { prisma } from '../lib/prisma';
import {
  FEATURES,
  CLAIM_ACTIONS,
  ROLES,
  Op,
  RoleName,
  Feature,
  ClaimAction,
} from '../constants/access';

export type Row = {
  canView: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
};

const NONE: Row = { canView: false, canCreate: false, canUpdate: false, canDelete: false };
const ALL: Row = { canView: true, canCreate: true, canUpdate: true, canDelete: true };

type Snapshot = {
  at: number;
  features: Map<string, Row>;
  claims: Set<string>;
  // user-level overrides: key = "userId:feature"
  userOverrides: Map<string, Row>;
};

// Cache is per server instance. With several instances (Auto Scaling), a change
// can take up to TTL to reach the others. Set PERMISSION_CACHE_TTL_MS=0 to disable.
const TTL_MS = Number(process.env.PERMISSION_CACHE_TTL_MS ?? 30_000);
const cache = new Map<string, Snapshot>();

async function load(workspaceId: string): Promise<Snapshot> {
  const hit = cache.get(workspaceId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit;

  let [perms, claimRows, userOverrideRows] = await Promise.all([
    prisma.rolePermission.findMany({ where: { workspaceId } }),
    prisma.roleClaimAction.findMany({ where: { workspaceId } }),
    prisma.userPermissionOverride.findMany({ where: { workspaceId } }),
  ]);

  if (perms.length === 0) {
    await seedDefaultPermissions(workspaceId);
    [perms, claimRows, userOverrideRows] = await Promise.all([
      prisma.rolePermission.findMany({ where: { workspaceId } }),
      prisma.roleClaimAction.findMany({ where: { workspaceId } }),
      prisma.userPermissionOverride.findMany({ where: { workspaceId } }),
    ]);
  }

  const snap: Snapshot = {
    at: Date.now(),
    features: new Map(perms.map((p) => [`${p.role}:${p.feature}`, p])),
    claims: new Set(claimRows.map((c) => `${c.role}:${c.claimType}:${c.action}`)),
    userOverrides: new Map(
      userOverrideRows.map((o) => [
        `${o.userId}:${o.feature}`,
        { canView: o.canView, canCreate: o.canCreate, canUpdate: o.canUpdate, canDelete: o.canDelete },
      ])
    ),
  };
  cache.set(workspaceId, snap);
  return snap;
}

export function invalidateWorkspace(workspaceId: string) {
  cache.delete(workspaceId);
}

async function getRow(workspaceId: string, role: RoleName, feature: string): Promise<Row> {
  // SUPER_ADMIN is always allowed: lockout protection even if the tables are empty.
  if (role === 'SUPER_ADMIN') return ALL;
  const { features } = await load(workspaceId);
  return features.get(`${role}:${feature}`) ?? NONE;
}

/**
 * Resolves the effective permission for a specific user.
 * Priority: user-level override (set per-user by admin) → role matrix → NONE.
 */
async function getRowForUser(
  workspaceId: string,
  userId: string,
  role: RoleName,
  feature: string,
): Promise<Row> {
  if (role === 'SUPER_ADMIN') return ALL;
  const snap = await load(workspaceId);
  // 1. Check user-level override first
  const userRow = snap.userOverrides.get(`${userId}:${feature}`);
  if (userRow !== undefined) return userRow;
  // 2. Fall back to role matrix
  return snap.features.get(`${role}:${feature}`) ?? NONE;
}

export async function can(
  workspaceId: string,
  role: RoleName,
  feature: string,
  op: Op,
): Promise<boolean> {
  const r = await getRow(workspaceId, role, feature);
  switch (op) {
    case 'view': return r.canView;
    case 'create': return r.canCreate;
    case 'update': return r.canUpdate;
    case 'delete': return r.canDelete;
  }
}

/**
 * Like `can()` but also respects per-user permission overrides.
 * Use this when a userId is available (e.g., in requireFeature middleware).
 */
export async function canForUser(
  workspaceId: string,
  userId: string,
  role: RoleName,
  feature: string,
  op: Op,
): Promise<boolean> {
  const r = await getRowForUser(workspaceId, userId, role, feature);
  switch (op) {
    case 'view': return r.canView;
    case 'create': return r.canCreate;
    case 'update': return r.canUpdate;
    case 'delete': return r.canDelete;
  }
}

export async function canClaimAction(
  workspaceId: string,
  role: RoleName,
  claimType: string,
  action: string,
): Promise<boolean> {
  if (role === 'SUPER_ADMIN') return true;
  const { claims } = await load(workspaceId);
  return claims.has(`${role}:${claimType}:${action}`) || claims.has(`${role}:*:${action}`);
}

export type RoleMatrix = {
  features: Record<string, { view: boolean; create: boolean; update: boolean; delete: boolean }>;
  claimActions: { claimType: string; action: string }[];
};

export async function getRoleMatrix(workspaceId: string, role: RoleName): Promise<RoleMatrix> {
  const { features, claims } = await load(workspaceId);
  const out: RoleMatrix = { features: {}, claimActions: [] };

  for (const f of FEATURES) {
    const r = role === 'SUPER_ADMIN' ? ALL : features.get(`${role}:${f}`) ?? NONE;
    out.features[f] = {
      view: r.canView,
      create: r.canCreate,
      update: r.canUpdate,
      delete: r.canDelete,
    };
  }

  if (role === 'SUPER_ADMIN') {
    out.claimActions = CLAIM_ACTIONS.map((action) => ({ claimType: '*', action }));
  } else {
    for (const key of claims) {
      const [r, claimType, action] = key.split(':');
      if (r === role) out.claimActions.push({ claimType, action });
    }
  }
  return out;
}

export async function getAllMatrices(workspaceId: string) {
  const entries = await Promise.all(
    ROLES.map(async (r) => [r, await getRoleMatrix(workspaceId, r)] as const),
  );
  return Object.fromEntries(entries) as Record<RoleName, RoleMatrix>;
}

/**
 * Returns a flat permission strings array for JWT payload and frontend AuthContext.
 * E.g., ['*', 'policies:view', 'policies:create', 'claims:approve']
 */
export async function getUserPermissionsList(workspaceId: string, role: RoleName): Promise<string[]> {
  if (role === 'SUPER_ADMIN') {
    return ['*'];
  }

  const matrix = await getRoleMatrix(workspaceId, role);
  const permissions: string[] = [];

  for (const [feature, ops] of Object.entries(matrix.features)) {
    if (ops.view) {
      permissions.push(`${feature}:view`);
      permissions.push(`${feature}:read`);
    }
    if (ops.create) {
      permissions.push(`${feature}:create`);
      permissions.push(`${feature}:write`);
    }
    if (ops.update) {
      permissions.push(`${feature}:update`);
      permissions.push(`${feature}:edit`);
      if (!ops.create) permissions.push(`${feature}:write`);
    }
    if (ops.delete) {
      permissions.push(`${feature}:delete`);
    }
  }

  for (const ca of matrix.claimActions) {
    permissions.push(`claims:${ca.action}`);
  }

  return [...new Set(permissions)];
}

// Default role permissions configuration as per Telkom Insurance CMS requirements
export const DEFAULT_ROLE_PERMISSIONS: Record<RoleName, { features: Record<string, Row>; claimActions: ClaimAction[] }> = {
  SUPER_ADMIN: {
    features: Object.fromEntries(FEATURES.map((f) => [f, ALL])),
    claimActions: [...CLAIM_ACTIONS],
  },
  AGENT: {
    features: {
      customers: { canView: true, canCreate: true, canUpdate: true, canDelete: false },
      products: { canView: true, canCreate: false, canUpdate: false, canDelete: false },
      policies: { canView: true, canCreate: false, canUpdate: false, canDelete: false },
      quotes: { canView: true, canCreate: true, canUpdate: true, canDelete: false },
      claims: { canView: true, canCreate: false, canUpdate: false, canDelete: false },
      communications: { canView: true, canCreate: true, canUpdate: false, canDelete: false },
    },
    claimActions: [],
  },
  POLICY_ADMINISTRATOR: {
    features: {
      customers: { canView: true, canCreate: true, canUpdate: true, canDelete: false },
      products: { canView: true, canCreate: false, canUpdate: false, canDelete: false },
      policies: { canView: true, canCreate: true, canUpdate: true, canDelete: false },
      quotes: { canView: true, canCreate: true, canUpdate: true, canDelete: false },
      underwriting: { canView: true, canCreate: false, canUpdate: false, canDelete: false },
      claims: { canView: true, canCreate: false, canUpdate: false, canDelete: false },
      billing: { canView: true, canCreate: false, canUpdate: false, canDelete: false },
      documents: { canView: true, canCreate: true, canUpdate: true, canDelete: false },
      communications: { canView: true, canCreate: true, canUpdate: false, canDelete: false },
    },
    claimActions: [],
  },
  CLAIM_ASSESSOR: {
    features: {
      policies: { canView: true, canCreate: false, canUpdate: false, canDelete: false },
      claims: { canView: true, canCreate: false, canUpdate: true, canDelete: false },
      documents: { canView: true, canCreate: true, canUpdate: false, canDelete: false },
    },
    claimActions: ['assign_adjuster', 'upload_invoice'],
  },
  CLAIM_SUPERVISOR: {
    features: {
      policies: { canView: true, canCreate: false, canUpdate: false, canDelete: false },
      claims: { canView: true, canCreate: false, canUpdate: true, canDelete: false },
      documents: { canView: true, canCreate: true, canUpdate: true, canDelete: false },
      compliance: { canView: true, canCreate: false, canUpdate: false, canDelete: false },
    },
    claimActions: ['assign_adjuster', 'upload_invoice', 'reject', 'repudiate'],
  },
  CLAIM_MANAGER: {
    features: {
      policies: { canView: true, canCreate: false, canUpdate: false, canDelete: false },
      claims: { canView: true, canCreate: true, canUpdate: true, canDelete: true },
      billing: { canView: true, canCreate: false, canUpdate: true, canDelete: false },
      documents: { canView: true, canCreate: true, canUpdate: true, canDelete: true },
      analytics: { canView: true, canCreate: false, canUpdate: false, canDelete: false },
    },
    claimActions: [
      'approve',
      'reject',
      'repudiate',
      'assign_adjuster',
      'upload_invoice',
      'payout_processed',
      'payout_blocked',
    ],
  },
  INSURER: {
    features: {
      policies: { canView: true, canCreate: false, canUpdate: false, canDelete: false },
      claims: { canView: true, canCreate: false, canUpdate: false, canDelete: false },
      underwriting: { canView: true, canCreate: false, canUpdate: false, canDelete: false },
      billing: { canView: true, canCreate: false, canUpdate: false, canDelete: false },
      reinsurance: { canView: true, canCreate: false, canUpdate: false, canDelete: false },
      compliance: { canView: true, canCreate: false, canUpdate: false, canDelete: false },
      analytics: { canView: true, canCreate: false, canUpdate: false, canDelete: false },
    },
    claimActions: [],
  },
  DEVELOPER: {
    features: {
      settings: { canView: true, canCreate: false, canUpdate: true, canDelete: false },
      analytics: { canView: true, canCreate: false, canUpdate: false, canDelete: false },
      partner_marketplace: { canView: true, canCreate: true, canUpdate: true, canDelete: false },
      api_sdks: { canView: true, canCreate: true, canUpdate: true, canDelete: false },
      sandbox: { canView: true, canCreate: true, canUpdate: true, canDelete: true },
      workflows: { canView: true, canCreate: true, canUpdate: true, canDelete: false },
      security: { canView: true, canCreate: false, canUpdate: false, canDelete: false },
      telematics: { canView: true, canCreate: false, canUpdate: false, canDelete: false },
    },
    claimActions: [],
  },
};

/**
 * Seeds default permissions and claim actions for a workspace.
 */
export async function seedDefaultPermissions(workspaceId: string): Promise<void> {
  const existingCount = await prisma.rolePermission.count({ where: { workspaceId } });
  if (existingCount > 0) return; // already seeded

  const permsToCreate: {
    workspaceId: string;
    role: RoleName;
    feature: string;
    canView: boolean;
    canCreate: boolean;
    canUpdate: boolean;
    canDelete: boolean;
  }[] = [];

  const claimActionsToCreate: {
    workspaceId: string;
    role: RoleName;
    claimType: string;
    action: string;
  }[] = [];

  for (const role of ROLES) {
    if (role === 'SUPER_ADMIN') continue; // SUPER_ADMIN permissions are dynamic / full by default
    const config = DEFAULT_ROLE_PERMISSIONS[role];
    if (!config) continue;

    for (const [feature, row] of Object.entries(config.features)) {
      permsToCreate.push({
        workspaceId,
        role,
        feature,
        ...row,
      });
    }

    for (const action of config.claimActions) {
      claimActionsToCreate.push({
        workspaceId,
        role,
        claimType: '*',
        action,
      });
    }
  }

  await prisma.$transaction([
    prisma.rolePermission.createMany({ data: permsToCreate }),
    prisma.roleClaimAction.createMany({ data: claimActionsToCreate }),
  ]);

  invalidateWorkspace(workspaceId);
}