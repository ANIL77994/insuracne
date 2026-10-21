export interface User {
  id: string;
  workspace_id: string;
  email: string;
  password_hash: string;
  first_name: string;
  last_name: string;
  role: UserRole;
  permissions: string[];
  is_active: boolean;
  last_login?: Date;
  created_at: Date;
  updated_at: Date;
}

export enum UserRole {
  ADMIN = 'admin',
  UNDERWRITER = 'underwriter',
  BROKER = 'broker',
  CUSTOMER = 'customer',
}

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  api_key: string;
  secret_key: string;
  settings: WorkspaceSettings;
  status: WorkspaceStatus;
  created_at: Date;
  updated_at: Date;
}

export enum WorkspaceStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  SUSPENDED = 'suspended',
}

export interface WorkspaceSettings {
  default_currency: string;
  default_timezone: string;
  business_hours: BusinessHours;
  notifications: NotificationSettings;
  integrations: Record<string, any>;
}

export interface BusinessHours {
  monday: { start: string; end: string; };
  tuesday: { start: string; end: string; };
  wednesday: { start: string; end: string; };
  thursday: { start: string; end: string; };
  friday: { start: string; end: string; };
  saturday: { start: string; end: string; };
  sunday: { start: string; end: string; };
}

export interface NotificationSettings {
  email_enabled: boolean;
  sms_enabled: boolean;
  webhook_enabled: boolean;
  slack_enabled: boolean;
}

export interface InsuranceProduct {
  id: string;
  workspace_id: string;
  name: string;
  type: ProductType;
  category: string;
  description?: string;
  coverage_details: CoverageDetails;
  pricing_rules: PricingRules;
  underwriting_rules: UnderwritingRules;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export enum ProductType {
  AUTO = 'auto',
  HOME = 'home',
  HEALTH = 'health',
  LIFE = 'life',
  TRAVEL = 'travel',
  LIABILITY = 'liability',
  COMMERCIAL = 'commercial',
}

export interface CoverageDetails {
  coverage_type: string;
  sum_insured: {
    min: number;
    max: number;
    default: number;
  };
  deductible: {
    min: number;
    max: number;
    default: number;
  };
  exclusions: string[];
  benefits: Benefit[];
}

export interface Benefit {
  name: string;
  description: string;
  coverage_amount: number;
  deductible?: number;
}

export interface PricingRules {
  base_premium: number;
  risk_factors: RiskFactor[];
  discounts: Discount[];
  loading_factors: LoadingFactor[];
}

export interface RiskFactor {
  name: string;
  field: string;
  type: 'categorical' | 'numerical' | 'boolean';
  weights: Record<string, number>;
}

export interface Discount {
  name: string;
  type: 'percentage' | 'fixed';
  value: number;
  conditions: Record<string, any>;
}

export interface LoadingFactor {
  name: string;
  type: 'percentage' | 'fixed';
  value: number;
  conditions: Record<string, any>;
}

export interface UnderwritingRules {
  auto_accept_threshold: number;
  auto_decline_threshold: number;
  referral_threshold: number;
  manual_review_required: string[];
  required_documents: string[];
  risk_checks: RiskCheck[];
}

export interface RiskCheck {
  name: string;
  type: 'internal' | 'external';
  conditions: Record<string, any>;
  action: 'accept' | 'decline' | 'refer';
}

export interface Quote {
  id: string;
  workspace_id: string;
  quote_number: string;
  product_id: string;
  customer_info: CustomerInfo;
  risk_data: Record<string, any>;
  coverage_amount: number;
  premium_amount: number;
  premium_currency: string;
  status: QuoteStatus;
  validity_period_days: number;
  expires_at?: Date;
  created_at: Date;
  updated_at: Date;
}

export enum QuoteStatus {
  PENDING = 'pending',
  UNDER_REVIEW = 'under_review',
  APPROVED = 'approved',
  DECLINED = 'declined',
  EXPIRED = 'expired',
  CONVERTED = 'converted',
}

export interface CustomerInfo {
  type: 'individual' | 'business';
  personal_details: PersonalDetails;
  contact_details: ContactDetails;
  address: Address;
  business_details?: BusinessDetails;
}

export interface PersonalDetails {
  first_name: string;
  last_name: string;
  date_of_birth: string;
  gender: string;
  nationality: string;
  id_number: string;
}

export interface ContactDetails {
  email: string;
  phone: string;
  alternate_phone?: string;
}

export interface Address {
  street: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
}

export interface BusinessDetails {
  business_name: string;
  business_type: string;
  registration_number: string;
  industry: string;
  employee_count: number;
  annual_revenue: number;
}

export interface Policy {
  id: string;
  workspace_id: string;
  policy_number: string;
  quote_id?: string;
  product_id: string;
  customer_info: CustomerInfo;
  coverage_amount: number;
  premium_amount: number;
  premium_currency: string;
  premium_payment_frequency: PaymentFrequency;
  effective_date: Date;
  expiry_date: Date;
  status: PolicyStatus;
  policy_data: Record<string, any>;
  created_at: Date;
  updated_at: Date;
}

export enum PolicyStatus {
  ACTIVE = 'active',
  EXPIRED = 'expired',
  CANCELLED = 'cancelled',
  SUSPENDED = 'suspended',
  RENEWAL_PENDING = 'renewal_pending',
}

export enum PaymentFrequency {
  ANNUAL = 'annual',
  SEMI_ANNUAL = 'semi_annual',
  QUARTERLY = 'quarterly',
  MONTHLY = 'monthly',
}

export interface Claim {
  id: string;
  workspace_id: string;
  claim_number: string;
  policy_id: string;
  customer_info: CustomerInfo;
  incident_date: Date;
  reported_date: Date;
  claim_type: string;
  description?: string;
  amount_claimed?: number;
  status: ClaimStatus;
  priority: ClaimPriority;
  assigned_to?: string;
  assessment_data: AssessmentData;
  created_at: Date;
  updated_at: Date;
}

export enum ClaimStatus {
  INTAKE = 'intake',
  UNDER_REVIEW = 'under_review',
  INVESTIGATION = 'investigation',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  SETTLED = 'settled',
  CLOSED = 'closed',
}

export enum ClaimPriority {
  LOW = 'low',
  NORMAL = 'normal',
  HIGH = 'high',
  CRITICAL = 'critical',
}

export interface AssessmentData {
  adjuster_notes: string[];
  documents_required: string[];
  investigation_findings: string;
  fraud_indicators: string[];
  settlement_amount?: number;
  reserve_amount?: number;
}

export interface UnderwritingDecision {
  id: string;
  workspace_id: string;
  quote_id?: string;
  policy_id?: string;
  user_id?: string;
  decision_type: 'quote' | 'policy' | 'renewal';
  risk_score?: number;
  decision: UnderwritingDecisionResult;
  reasons: string[];
  conditions: string[];
  notes?: string;
  created_at: Date;
}

export enum UnderwritingDecisionResult {
  ACCEPT = 'accept',
  DECLINE = 'decline',
  REFER = 'refer',
  MODIFY = 'modify',
}

export interface Document {
  id: string;
  workspace_id: string;
  entity_type: string;
  entity_id: string;
  document_type: string;
  filename: string;
  original_filename: string;
  file_path: string;
  file_size: number;
  mime_type: string;
  metadata: Record<string, any>;
  status: DocumentStatus;
  uploaded_by?: string;
  created_at: Date;
}

export enum DocumentStatus {
  UPLOADED = 'uploaded',
  PROCESSING = 'processing',
  PROCESSED = 'processed',
  ERROR = 'error',
}

export interface BillingRecord {
  id: string;
  workspace_id: string;
  policy_id: string;
  billing_type: BillingType;
  amount: number;
  currency: string;
  due_date: Date;
  paid_date?: Date;
  status: BillingStatus;
  payment_method?: string;
  transaction_id?: string;
  created_at: Date;
  updated_at: Date;
}

export enum BillingType {
  PREMIUM = 'premium',
  ENDORSEMENT = 'endorsement',
  FEE = 'fee',
  REFUND = 'refund',
}

export enum BillingStatus {
  PENDING = 'pending',
  PAID = 'paid',
  OVERDUE = 'overdue',
  CANCELLED = 'cancelled',
  REFUNDED = 'refunded',
}

export interface AuditLog {
  id: string;
  workspace_id: string;
  user_id?: string;
  action: string;
  entity_type: string;
  entity_id: string;
  changes?: Record<string, any>;
  ip_address?: string;
  user_agent?: string;
  created_at: Date;
}

// Advanced Engine Types
export interface RiskScore {
  id: string;
  workspace_id: string;
  entity_type: string;
  entity_id: string;
  score: number;
  score_band: string;
  risk_factors: Record<string, any>;
  model_version: string;
  confidence_level: number;
  created_at: Date;
}

export interface FraudAlert {
  id: string;
  workspace_id: string;
  entity_type: string;
  entity_id: string;
  alert_type: string;
  severity: string;
  description: string;
  risk_score: number;
  status: 'open' | 'investigating' | 'resolved' | 'false_positive';
  assigned_to?: string;
  created_at: Date;
  updated_at: Date;
}

export interface Customer {
  id: string;
  workspace_id: string;
  customer_type: 'individual' | 'business';
  personal_details: PersonalDetails;
  contact_details: ContactDetails;
  address: Address;
  business_details?: BusinessDetails;
  lifecycle_stage: string;
  total_policies: number;
  total_premium: number;
  last_activity: Date;
  created_at: Date;
  updated_at: Date;
}

export interface TelematicsDevice {
  id: string;
  workspace_id: string;
  device_id: string;
  device_type: string;
  policy_id: string;
  installation_date: Date;
  status: 'active' | 'inactive' | 'faulty';
  last_sync: Date;
  metadata: Record<string, any>;
  created_at: Date;
  updated_at: Date;
}

export interface WorkflowProcess {
  id: string;
  workspace_id: string;
  process_name: string;
  process_type: string;
  definition: Record<string, any>;
  status: 'draft' | 'active' | 'paused' | 'archived';
  version: number;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

export interface ComplianceRule {
  id: string;
  workspace_id: string;
  rule_name: string;
  rule_type: string;
  conditions: Record<string, any>;
  actions: Record<string, any>;
  priority: number;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface ReinsuranceTreaty {
  id: string;
  workspace_id: string;
  treaty_name: string;
  treaty_type: string;
  counterparty: string;
  capacity_amount: number;
  retention_amount: number;
  commission_rate: number;
  effective_date: Date;
  expiry_date: Date;
  status: 'active' | 'expired' | 'terminated';
  created_at: Date;
  updated_at: Date;
}

export interface MarketplacePartner {
  id: string;
  workspace_id: string;
  partner_name: string;
  partner_type: string;
  integration_type: string;
  api_endpoint: string;
  credentials: Record<string, any>;
  status: 'active' | 'inactive' | 'suspended';
  last_sync: Date;
  created_at: Date;
  updated_at: Date;
}

export interface APIEndpoint {
  id: string;
  workspace_id: string;
  endpoint_name: string;
  endpoint_path: string;
  method: string;
  description: string;
  parameters: Record<string, any>;
  response_schema: Record<string, any>;
  is_public: boolean;
  rate_limit: number;
  created_at: Date;
  updated_at: Date;
}

export interface SecurityThreat {
  id: string;
  workspace_id: string;
  threat_type: string;
  severity: string;
  description: string;
  source_ip: string;
  target_endpoint: string;
  status: 'open' | 'investigating' | 'resolved' | 'false_positive';
  assigned_to?: string;
  created_at: Date;
  updated_at: Date;
}

export interface SandboxEnvironment {
  id: string;
  workspace_id: string;
  environment_name: string;
  environment_type: string;
  data_snapshot_id: string;
  expiration_date: Date;
  status: 'active' | 'expired' | 'archived';
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

export interface TestSuite {
  id: string;
  workspace_id: string;
  suite_name: string;
  test_type: string;
  target_endpoint: string;
  test_cases: Record<string, any>;
  status: 'draft' | 'running' | 'completed' | 'failed';
  results: Record<string, any>;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

// API Response Types
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  pagination?: PaginationInfo;
}

export interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

// Request Types
export interface AuthRequest {
  email: string;
  password: string;
  workspace_slug?: string;
}

export interface CreateWorkspaceRequest {
  name: string;
  slug: string;
  settings?: Partial<WorkspaceSettings>;
}

export interface CreateQuoteRequest {
  product_id: string;
  customer_info: CustomerInfo;
  risk_data: Record<string, any>;
  coverage_amount?: number;
}

export interface CreateClaimRequest {
  policy_id: string;
  incident_date: string;
  claim_type: string;
  description?: string;
  amount_claimed?: number;
}

export interface UnderwritingRequest {
  quote_id?: string;
  policy_id?: string;
  risk_data: Record<string, any>;
  manual_decision?: UnderwritingDecisionResult;
  notes?: string;
}

// Utility Types
export interface FilterOptions {
  status?: string;
  date_from?: string;
  date_to?: string;
  search?: string;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

export interface SortOptions {
  column: string;
  direction: 'asc' | 'desc';
}