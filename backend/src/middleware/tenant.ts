import { Request, Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './auth';

export const tenantMiddleware = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void => {
  // Tenant can be specified in multiple ways:
  // 1. X-Tenant-ID header
  // 2. Subdomain (e.g., tenant.example.com)
  // 3. Query parameter (?tenant=slug)
  // 4. Path parameter (/tenant/api/...)

  let tenantId: string | undefined;
  let tenantSlug: string | undefined;

  // Check X-Tenant-ID header
  const headerTenantId = req.headers['x-tenant-id'] as string;
  if (headerTenantId) {
    tenantId = headerTenantId;
  }

  // Check subdomain
  const host = req.hostname;
  const subdomain = host.split('.')[0];
  if (subdomain && subdomain !== 'localhost' && subdomain !== 'api') {
    tenantSlug = subdomain;
  }

  // Check query parameter
  const queryTenant = req.query.tenant as string;
  if (queryTenant) {
    tenantSlug = queryTenant;
  }

  // Check path parameter
  const pathParts = req.path.split('/');
  if (pathParts.length > 2 && !pathParts[1].includes('api')) {
    tenantSlug = pathParts[1];
  }

  // If we have a workspace from auth middleware, use that
  if (req.workspace) {
    req.tenantId = req.workspace.id;
    req.tenantSlug = req.workspace.slug;
    next();
    return;
  }

  // If tenant was specified in other ways, validate it
  if (tenantId || tenantSlug) {
    req.tenantId = tenantId;
    req.tenantSlug = tenantSlug;
    next();
    return;
  }

  // For workspace management routes, tenant is not required
  if (req.path.startsWith('/api/workspaces')) {
    next();
    return;
  }

  // All other routes require tenant context
  res.status(400).json({
    success: false,
    error: {
      code: 'TENANT_REQUIRED',
      message: 'Tenant context is required for this operation',
    },
  });
};

export interface TenantRequest extends AuthenticatedRequest {
  tenantId?: string;
  tenantSlug?: string;
}