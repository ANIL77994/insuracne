import { RequestHandler } from 'express';
import { prisma } from '../lib/prisma';
import { AuthenticatedRequest } from './auth';
import { createError } from './errorHandler';
import { can, canForUser, canClaimAction } from '../services/permissions';
import { Feature, Op, ClaimAction, RoleName, UUID_RE } from '../constants/access';

export interface AccessContext {
  userId: string;
  workspaceId: string;
  role: RoleName;
}
export type AccessRequest = AuthenticatedRequest & { access: AccessContext };

// Always read role / active flag from the DB, not from the JWT, so a demoted or
// deactivated user loses access immediately instead of when the token expires.
async function ensureContext(req: AuthenticatedRequest): Promise<AccessContext> {
  const existing = (req as AccessRequest).access;
  if (existing) return existing;

  const userId = req.user?.id;
  if (!userId) throw createError('Unauthorized', 401, 'UNAUTHORIZED');

  const user = await prisma.user.findUnique({
    where: { userId },
    select: { userId: true, workspaceId: true, role: true, isActive: true },
  });
  if (!user || user.isActive === false || !user.workspaceId) {
    throw createError('Account is inactive or has no workspace', 403, 'FORBIDDEN');
  }

  const ctx: AccessContext = {
    userId: user.userId,
    workspaceId: user.workspaceId,
    role: user.role as RoleName,
  };
  (req as AccessRequest).access = ctx;
  return ctx;
}

const wrap =
  (fn: (req: AuthenticatedRequest) => Promise<void>): RequestHandler =>
    (req, _res, next) => {
      fn(req as AuthenticatedRequest).then(() => next()).catch(next);
    };

/** Loads req.access without checking a feature (e.g. for /me/permissions). */
export const requireAccessContext: RequestHandler = wrap(async (req) => {
  await ensureContext(req);
});

/** requireFeature('policies', 'update') */
export const requireFeature = (feature: Feature, op: Op): RequestHandler =>
  wrap(async (req) => {
    const ctx = await ensureContext(req);
    // Use canForUser so per-user overrides take precedence over the role matrix
    if (!(await canForUser(ctx.workspaceId, ctx.userId, ctx.role, feature, op))) {
      throw createError(`Forbidden: ${feature}:${op}`, 403, 'FORBIDDEN');
    }
  });

/** requireClaimAction('approve') on a route like /claims/:id/approve */
export const requireClaimAction = (action: ClaimAction, idParam = 'id'): RequestHandler =>
  wrap(async (req) => {
    const ctx = await ensureContext(req);
    const claimId = req.params[idParam];
    if (!UUID_RE.test(claimId)) throw createError('Invalid claim id', 400, 'VALIDATION_ERROR');

    const claim = await prisma.claim.findFirst({
      where: { claimId, workspaceId: ctx.workspaceId },
      select: { claimType: true },
    });
    if (!claim) throw createError('Claim not found', 404, 'NOT_FOUND');

    if (!(await canClaimAction(ctx.workspaceId, ctx.role, claim.claimType, action))) {
      throw createError(`Forbidden: claim action "${action}"`, 403, 'FORBIDDEN');
    }
  });