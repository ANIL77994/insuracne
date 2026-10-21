// Single source of truth for roles, features and claim actions.
// Add a new feature here (no migration needed), then protect its routes with requireFeature().

export const ROLES = [
    'AGENT',
    'POLICY_ADMINISTRATOR',
    'CLAIM_ASSESSOR',
    'CLAIM_SUPERVISOR',
    'CLAIM_MANAGER',
    'INSURER',
    'DEVELOPER',
    'SUPER_ADMIN',
] as const;
export type RoleName = (typeof ROLES)[number];

// Only a SUPER_ADMIN may assign these roles or touch users who have them.
export const PROTECTED_ROLES: readonly RoleName[] = ['SUPER_ADMIN', 'DEVELOPER'];

export const FEATURES = [
    // administration
    'users',
    'access_levels',
    'settings',
    // core insurance
    'customers',        // routes/crm.ts
    'products',
    'policies',         // routes/policies.ts
    'quotes',           // routes/quotes.ts
    'underwriting',
    'claims',           // routes/claims.ts
    'billing',          // routes/billing.ts
    'documents',        // routes/documents.ts
    'communications',
    // risk and compliance
    'compliance',       // routes/compliance.ts
    'fraud_detection',  // routes/fraud-detection.ts
    'risk_scoring',     // routes/risk-scoring.ts
    'reinsurance',      // routes/reinsurance.ts
    'telematics',       // routes/telematics.ts
    'security',         // routes/security.ts
    // platform
    'analytics',        // routes/analytics.ts
    'partner_marketplace', // routes/partner-marketplace.ts
    'api_sdks',         // routes/apis-sdks.ts
    'sandbox',          // routes/sandbox.ts
    'workflows',
] as const;
export type Feature = (typeof FEATURES)[number];

export const CLAIM_ACTIONS = [
    'approve',
    'reject',
    'repudiate',
    'assign_adjuster',
    'upload_invoice',
    'payout_processed',
    'payout_blocked',
] as const;
export type ClaimAction = (typeof CLAIM_ACTIONS)[number];

export type Op = 'view' | 'create' | 'update' | 'delete';

export const isRole = (v: unknown): v is RoleName =>
    typeof v === 'string' && (ROLES as readonly string[]).includes(v);
export const isFeature = (v: unknown): v is Feature =>
    typeof v === 'string' && (FEATURES as readonly string[]).includes(v);
export const isClaimAction = (v: unknown): v is ClaimAction =>
    typeof v === 'string' && (CLAIM_ACTIONS as readonly string[]).includes(v);

export const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
