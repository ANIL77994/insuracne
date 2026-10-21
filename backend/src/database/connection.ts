import { Pool, PoolConfig } from 'pg';
import { config } from 'dotenv';

config();

const dbConfig: PoolConfig = {
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/insurance_platform',
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
};

export const pool = new Pool(dbConfig);

// Legacy raw query interface (deprecated in favor of Prisma)
export const db = {
  query: (text: string, params?: any[]) => pool.query(text, params),
  pool
};

// Re-export Prisma client for ORM access without raw db.query
export { prisma, connectPrisma, disconnectPrisma } from '../lib/prisma';


// Initialize database schema
export async function initializeDatabase() {
  try {
    console.log('🔄 Initializing database schema...');

    // Create tables in correct dependency order
    await createCoreTables();
    await createUserTables();
    await createPolicyTables();
    await createClaimsTables();
    await createUnderwritingTables();
    await createQuoteTables();
    await createBillingTables();
    await createDocumentTables();
    await createAnalyticsTables();

    // Additional engine tables
    await createRiskScoringTables();
    await createFraudDetectionTables();
    await createCrmTables();
    await createTelematicsTables();
    await createWorkflowTables();
    await createComplianceTables();
    await createReinsuranceTables();
    await createPartnerMarketplaceTables();
    await createApisSdksTables();
    await createSecurityTables();
    await createSandboxTables();
    await createTestingTables();

    console.log('✅ Database schema initialized successfully');
  } catch (error) {
    console.error('❌ Failed to initialize database schema:', error);
    throw error;
  }
}

async function createCoreTables() {
  // Workspaces table
  await db.query(`
    CREATE TABLE IF NOT EXISTS workspaces (
      workspace_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(255) NOT NULL,
      domain VARCHAR(255),
      plan_type VARCHAR(50) DEFAULT 'starter',
      api_key VARCHAR(255) UNIQUE NOT NULL,
      api_secret VARCHAR(255) NOT NULL,
      status VARCHAR(50) DEFAULT 'active',
      settings JSONB DEFAULT '{}',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  // Users table
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
      email VARCHAR(255) NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      first_name VARCHAR(100) NOT NULL,
      last_name VARCHAR(100) NOT NULL,
      role VARCHAR(50) NOT NULL DEFAULT 'user',
      permissions JSONB DEFAULT '[]',
      last_login_at TIMESTAMP WITH TIME ZONE,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      UNIQUE(workspace_id, email)
    );
  `);

  // Products table
  await db.query(`
    CREATE TABLE IF NOT EXISTS products (
      product_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      category VARCHAR(100),
      coverage_types JSONB DEFAULT '[]',
      pricing_model VARCHAR(100),
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  // Audit logs table
  await db.query(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      log_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
      table_name VARCHAR(100) NOT NULL,
      action_type VARCHAR(50) NOT NULL,
      record_id VARCHAR(255),
      old_values JSONB,
      new_values JSONB,
      performed_by UUID REFERENCES users(user_id),
      ip_address INET,
      user_agent TEXT,
      timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);
}

async function createUserTables() {
  // Additional user-related tables if needed
  await db.query(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      session_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(user_id) ON DELETE CASCADE,
      workspace_id UUID REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
      token_hash VARCHAR(255) NOT NULL,
      expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
      ip_address INET,
      user_agent TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);
}

async function createPolicyTables() {
  // Policies table
  await db.query(`
    CREATE TABLE IF NOT EXISTS policies (
      policy_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
      policy_number VARCHAR(100) UNIQUE NOT NULL,
      customer_id UUID,
      product_id UUID REFERENCES products(product_id),
      policy_type VARCHAR(100) NOT NULL,
      status VARCHAR(50) DEFAULT 'draft',
      effective_date DATE NOT NULL,
      expiration_date DATE NOT NULL,
      premium_amount DECIMAL(15,2) NOT NULL,
      coverage_amount DECIMAL(15,2) NOT NULL,
      deductible DECIMAL(15,2) DEFAULT 0,
      policy_data JSONB DEFAULT '{}',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  // Policy endorsements table
  await db.query(`
    CREATE TABLE IF NOT EXISTS policy_endorsements (
      endorsement_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
      policy_id UUID REFERENCES policies(policy_id) ON DELETE CASCADE,
      endorsement_type VARCHAR(100) NOT NULL,
      description TEXT,
      premium_adjustment DECIMAL(15,2) DEFAULT 0,
      effective_date DATE NOT NULL,
      status VARCHAR(50) DEFAULT 'pending',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      created_by UUID REFERENCES users(user_id)
    );
  `);
}

async function createClaimsTables() {
  // Claims table
  await db.query(`
    CREATE TABLE IF NOT EXISTS claims (
      claim_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
      claim_number VARCHAR(100) UNIQUE NOT NULL,
      policy_id UUID REFERENCES policies(policy_id),
      customer_id UUID,
      claimant_name VARCHAR(255) NOT NULL,
      claim_type VARCHAR(100) NOT NULL,
      status VARCHAR(50) DEFAULT 'open',
      priority VARCHAR(20) DEFAULT 'normal',
      incident_date DATE NOT NULL,
      reported_date DATE NOT NULL,
      claimed_amount DECIMAL(15,2) NOT NULL,
      approved_amount DECIMAL(15,2) DEFAULT 0,
      settlement_amount DECIMAL(15,2) DEFAULT 0,
      assigned_adjuster UUID REFERENCES users(user_id),
      fraud_flags JSONB DEFAULT '{}',
      risk_level VARCHAR(20) DEFAULT 'low',
      requires_investigation BOOLEAN DEFAULT false,
      claim_data JSONB DEFAULT '{}',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  // Claim documents table
  await db.query(`
    CREATE TABLE IF NOT EXISTS claim_documents (
      document_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
      claim_id UUID REFERENCES claims(claim_id) ON DELETE CASCADE,
      document_type VARCHAR(100) NOT NULL,
      file_name VARCHAR(255) NOT NULL,
      file_size INTEGER,
      file_url TEXT,
      uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      uploaded_by UUID REFERENCES users(user_id)
    );
  `);
}

async function createUnderwritingTables() {
  // Underwriting cases table
  await db.query(`
    CREATE TABLE IF NOT EXISTS underwriting_cases (
      case_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
      customer_id UUID,
      policy_type VARCHAR(100) NOT NULL,
      application_data JSONB NOT NULL,
      risk_score DECIMAL(5,2),
      risk_category VARCHAR(50),
      status VARCHAR(50) DEFAULT 'pending',
      decision VARCHAR(50),
      decision_reason TEXT,
      underwriter_id UUID REFERENCES users(user_id),
      reviewed_at TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  // Risk factors table
  await db.query(`
    CREATE TABLE IF NOT EXISTS risk_factors (
      factor_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
      case_id UUID REFERENCES underwriting_cases(case_id) ON DELETE CASCADE,
      factor_name VARCHAR(100) NOT NULL,
      factor_value JSONB NOT NULL,
      weight DECIMAL(5,2) DEFAULT 1.0,
      score DECIMAL(5,2),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);
}

async function createQuoteTables() {
  // Quotes table
  await db.query(`
    CREATE TABLE IF NOT EXISTS quotes (
      quote_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
      quote_number VARCHAR(100) UNIQUE NOT NULL,
      customer_id UUID,
      product_id UUID REFERENCES products(product_id),
      applicant_data JSONB NOT NULL,
      risk_data JSONB DEFAULT '{}',
      quoted_premium DECIMAL(15,2) NOT NULL,
      coverage_amount DECIMAL(15,2) NOT NULL,
      deductible DECIMAL(15,2) DEFAULT 0,
      effective_date DATE,
      expiration_date DATE,
      status VARCHAR(50) DEFAULT 'draft',
      pricing_factors JSONB DEFAULT '{}',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  // Quote comparisons table
  await db.query(`
    CREATE TABLE IF NOT EXISTS quote_comparisons (
      comparison_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
      customer_id UUID,
      quotes JSONB NOT NULL,
      comparison_data JSONB DEFAULT '{}',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);
}

async function createBillingTables() {
  // Billing records table
  await db.query(`
    CREATE TABLE IF NOT EXISTS billing_records (
      record_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
      policy_id UUID REFERENCES policies(policy_id),
      customer_id UUID,
      billing_type VARCHAR(50) NOT NULL,
      amount DECIMAL(15,2) NOT NULL,
      due_date DATE NOT NULL,
      paid_date DATE,
      status VARCHAR(50) DEFAULT 'pending',
      payment_method VARCHAR(50),
      transaction_id VARCHAR(255),
      late_fees DECIMAL(15,2) DEFAULT 0,
      adjustments JSONB DEFAULT '{}',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  // Payment methods table
  await db.query(`
    CREATE TABLE IF NOT EXISTS payment_methods (
      method_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
      customer_id UUID,
      method_type VARCHAR(50) NOT NULL,
      provider VARCHAR(100),
      last_four VARCHAR(4),
      is_default BOOLEAN DEFAULT false,
      expires_at DATE,
      status VARCHAR(50) DEFAULT 'active',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);
}

async function createDocumentTables() {
  // Documents table
  await db.query(`
    CREATE TABLE IF NOT EXISTS documents (
      document_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
      file_name VARCHAR(255) NOT NULL,
      original_name VARCHAR(255) NOT NULL,
      file_type VARCHAR(100) NOT NULL,
      file_size INTEGER NOT NULL,
      file_url TEXT NOT NULL,
      document_type VARCHAR(100),
      category VARCHAR(100),
      associated_entity_type VARCHAR(100),
      associated_entity_id UUID,
      ocr_text TEXT,
      metadata JSONB DEFAULT '{}',
      uploaded_by UUID REFERENCES users(user_id),
      uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      processed_at TIMESTAMP WITH TIME ZONE
    );
  `);

  // Document processing jobs table
  await db.query(`
    CREATE TABLE IF NOT EXISTS document_processing_jobs (
      job_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
      document_id UUID REFERENCES documents(document_id) ON DELETE CASCADE,
      job_type VARCHAR(100) NOT NULL,
      status VARCHAR(50) DEFAULT 'pending',
      progress INTEGER DEFAULT 0,
      result JSONB DEFAULT '{}',
      error_message TEXT,
      started_at TIMESTAMP WITH TIME ZONE,
      completed_at TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);
}

async function createAnalyticsTables() {
  // Analytics data table
  await db.query(`
    CREATE TABLE IF NOT EXISTS analytics_data (
      data_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
      metric_name VARCHAR(100) NOT NULL,
      metric_value DECIMAL(15,4),
      dimensions JSONB DEFAULT '{}',
      recorded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  // KPI tracking table
  await db.query(`
    CREATE TABLE IF NOT EXISTS kpi_tracking (
      kpi_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
      kpi_name VARCHAR(100) NOT NULL,
      current_value DECIMAL(15,4),
      target_value DECIMAL(15,4),
      unit VARCHAR(50),
      category VARCHAR(100),
      last_calculated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      trend VARCHAR(20),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);
}

async function createRiskScoringTables() {
  // Risk scoring models table
  await db.query(`
    CREATE TABLE IF NOT EXISTS risk_scoring_models (
      model_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      version VARCHAR(50) NOT NULL,
      description TEXT,
      model_type VARCHAR(100) NOT NULL,
      risk_factors JSONB NOT NULL,
      thresholds JSONB NOT NULL,
      model_config JSONB DEFAULT '{}',
      accuracy_score DECIMAL(5,4),
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      created_by UUID REFERENCES users(user_id)
    );
  `);

  // Risk scores table
  await db.query(`
    CREATE TABLE IF NOT EXISTS risk_scores (
      scoring_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
      applicant_id UUID,
      policy_type VARCHAR(100),
      base_score DECIMAL(5,2),
      final_score DECIMAL(5,2) NOT NULL,
      risk_category VARCHAR(50) NOT NULL,
      factor_scores JSONB DEFAULT '{}',
      recommendations JSONB DEFAULT '[]',
      model_used UUID REFERENCES risk_scoring_models(model_id),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);
}

async function createFraudDetectionTables() {
  // Fraud analysis table
  await db.query(`
    CREATE TABLE IF NOT EXISTS fraud_analysis (
      analysis_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
      claim_id UUID REFERENCES claims(claim_id) ON DELETE CASCADE,
      fraud_score INTEGER NOT NULL,
      risk_level VARCHAR(20) NOT NULL,
      risk_factors JSONB DEFAULT '[]',
      alerts JSONB DEFAULT '[]',
      recommendations JSONB DEFAULT '[]',
      investigation_id UUID,
      investigation_status VARCHAR(50),
      investigator_assigned UUID REFERENCES users(user_id),
      analysis_date TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  // Fraud investigations table
  await db.query(`
    CREATE TABLE IF NOT EXISTS fraud_investigations (
      investigation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
      analysis_id UUID REFERENCES fraud_analysis(analysis_id) ON DELETE CASCADE,
      investigator_id UUID REFERENCES users(user_id),
      status VARCHAR(50) DEFAULT 'OPEN',
      notes TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);
}

async function createCrmTables() {
  // Customers table
  await db.query(`
    CREATE TABLE IF NOT EXISTS customers (
      customer_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
      first_name VARCHAR(100) NOT NULL,
      last_name VARCHAR(100) NOT NULL,
      email VARCHAR(255) UNIQUE,
      phone VARCHAR(50),
      date_of_birth DATE,
      address TEXT,
      city VARCHAR(100),
      state VARCHAR(100),
      zip_code VARCHAR(20),
      status VARCHAR(50) DEFAULT 'ACTIVE',
      customer_type VARCHAR(50) DEFAULT 'individual',
      lifetime_value DECIMAL(15,2) DEFAULT 0,
      last_contact_date TIMESTAMP WITH TIME ZONE,
      notes TEXT,
      created_by UUID REFERENCES users(user_id),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_by UUID REFERENCES users(user_id)
    );
  `);

  // Communications table
  await db.query(`
    CREATE TABLE IF NOT EXISTS communications (
      communication_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
      customer_id UUID REFERENCES customers(customer_id) ON DELETE CASCADE,
      communication_type VARCHAR(50) NOT NULL,
      subject VARCHAR(255),
      message TEXT,
      direction VARCHAR(20) NOT NULL,
      priority VARCHAR(20) DEFAULT 'normal',
      status VARCHAR(50) DEFAULT 'PENDING',
      sent_at TIMESTAMP WITH TIME ZONE,
      created_by UUID REFERENCES users(user_id),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);
}

async function createTelematicsTables() {
  // Telematics devices table
  await db.query(`
    CREATE TABLE IF NOT EXISTS telematics_devices (
      device_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
      device_name VARCHAR(255) NOT NULL,
      device_type VARCHAR(100) NOT NULL,
      serial_number VARCHAR(255) UNIQUE NOT NULL,
      firmware_version VARCHAR(50),
      policy_id UUID REFERENCES policies(policy_id),
      installation_location TEXT,
      installation_date DATE,
      status VARCHAR(50) DEFAULT 'ACTIVE',
      last_seen TIMESTAMP WITH TIME ZONE,
      battery_level INTEGER,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  // Telematics data table
  await db.query(`
    CREATE TABLE IF NOT EXISTS telematics_data (
      data_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
      device_id UUID REFERENCES telematics_devices(device_id) ON DELETE CASCADE,
      policy_id UUID REFERENCES policies(policy_id),
      timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
      location JSONB,
      speed INTEGER,
      acceleration DECIMAL(5,2),
      braking_events INTEGER DEFAULT 0,
      acceleration_events INTEGER DEFAULT 0,
      night_driving DECIMAL(5,2) DEFAULT 0,
      distance_travelled DECIMAL(10,2) DEFAULT 0,
      fuel_consumption DECIMAL(8,2) DEFAULT 0,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  // Driving behavior table
  await db.query(`
    CREATE TABLE IF NOT EXISTS driving_behavior (
      analysis_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
      device_id UUID REFERENCES telematics_devices(device_id) ON DELETE CASCADE,
      policy_id UUID REFERENCES policies(policy_id),
      analysis_date TIMESTAMP WITH TIME ZONE NOT NULL,
      speed_score INTEGER,
      acceleration_score INTEGER,
      braking_score INTEGER,
      night_driving_score INTEGER,
      overall_score INTEGER NOT NULL,
      risk_level VARCHAR(20) NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  // Premium adjustments table
  await db.query(`
    CREATE TABLE IF NOT EXISTS premium_adjustments (
      adjustment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
      policy_id UUID REFERENCES policies(policy_id),
      adjustment_type VARCHAR(50) NOT NULL,
      original_premium DECIMAL(15,2) NOT NULL,
      adjusted_premium DECIMAL(15,2) NOT NULL,
      adjustment_percentage DECIMAL(5,2) NOT NULL,
      reason TEXT NOT NULL,
      driving_score DECIMAL(5,2),
      analysis_points INTEGER,
      period_days INTEGER,
      effective_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      created_by UUID REFERENCES users(user_id)
    );
  `);
}

async function createWorkflowTables() {
  // Workflow definitions table
  await db.query(`
    CREATE TABLE IF NOT EXISTS workflow_definitions (
      workflow_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      category VARCHAR(100),
      version VARCHAR(50) NOT NULL,
      workflow_steps JSONB NOT NULL,
      approval_rules JSONB DEFAULT '{}',
      escalation_rules JSONB DEFAULT '{}',
      sla_config JSONB DEFAULT '{}',
      status VARCHAR(50) DEFAULT 'DRAFT',
      is_active BOOLEAN DEFAULT true,
      created_by UUID REFERENCES users(user_id),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  // Workflow instances table
  await db.query(`
    CREATE TABLE IF NOT EXISTS workflow_instances (
      instance_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
      workflow_id UUID REFERENCES workflow_definitions(workflow_id),
      entity_type VARCHAR(100) NOT NULL,
      entity_id UUID,
      status VARCHAR(50) DEFAULT 'PENDING',
      priority VARCHAR(20) DEFAULT 'normal',
      current_step VARCHAR(255),
      current_assignee UUID REFERENCES users(user_id),
      context_data JSONB DEFAULT '{}',
      initiated_by UUID REFERENCES users(user_id),
      completed_at TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  // Workflow step instances table
  await db.query(`
    CREATE TABLE IF NOT EXISTS workflow_step_instances (
      step_instance_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
      instance_id UUID REFERENCES workflow_instances(instance_id) ON DELETE CASCADE,
      step_id VARCHAR(255) NOT NULL,
      step_name VARCHAR(255) NOT NULL,
      step_order INTEGER NOT NULL,
      status VARCHAR(50) DEFAULT 'PENDING',
      assigned_to UUID REFERENCES users(user_id),
      due_date TIMESTAMP WITH TIME ZONE,
      completed_at TIMESTAMP WITH TIME ZONE,
      comments TEXT,
      step_data JSONB DEFAULT '{}',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  // Workflow history table
  await db.query(`
    CREATE TABLE IF NOT EXISTS workflow_history (
      history_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
      instance_id UUID REFERENCES workflow_instances(instance_id) ON DELETE CASCADE,
      step_name VARCHAR(255),
      action_type VARCHAR(50) NOT NULL,
      performed_by UUID REFERENCES users(user_id),
      timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      details JSONB DEFAULT '{}',
      comments TEXT
    );
  `);
}

async function createComplianceTables() {
  // Compliance requirements table
  await db.query(`
    CREATE TABLE IF NOT EXISTS compliance_requirements (
      requirement_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
      title VARCHAR(255) NOT NULL,
      description TEXT,
      jurisdiction VARCHAR(100) NOT NULL,
      category VARCHAR(100) NOT NULL,
      regulatory_body VARCHAR(255),
      effective_date DATE NOT NULL,
      due_date DATE NOT NULL,
      frequency VARCHAR(50),
      compliance_level VARCHAR(50) NOT NULL,
      submission_format VARCHAR(100),
      status VARCHAR(50) DEFAULT 'ACTIVE',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  // Compliance reports table
  await db.query(`
    CREATE TABLE IF NOT EXISTS compliance_reports (
      report_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
      requirement_id UUID REFERENCES compliance_requirements(requirement_id),
      report_period VARCHAR(100) NOT NULL,
      submission_data JSONB NOT NULL,
      attachments JSONB DEFAULT '[]',
      submission_status VARCHAR(50) NOT NULL,
      is_compliant BOOLEAN NOT NULL,
      overdue BOOLEAN DEFAULT false,
      submitted_by UUID REFERENCES users(user_id),
      notes TEXT,
      submitted_at TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  // Compliance tasks table
  await db.query(`
    CREATE TABLE IF NOT EXISTS compliance_tasks (
      task_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
      requirement_id UUID REFERENCES compliance_requirements(requirement_id),
      report_id UUID REFERENCES compliance_reports(report_id),
      task_type VARCHAR(100) NOT NULL,
      priority VARCHAR(20) DEFAULT 'normal',
      status VARCHAR(50) DEFAULT 'PENDING',
      assigned_to UUID REFERENCES users(user_id),
      due_date TIMESTAMP WITH TIME ZONE,
      completed_at TIMESTAMP WITH TIME ZONE,
      notes TEXT,
      completion_notes TEXT,
      created_by UUID REFERENCES users(user_id),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  // Generated reports table
  await db.query(`
    CREATE TABLE IF NOT EXISTS generated_reports (
      report_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
      report_type VARCHAR(100) NOT NULL,
      report_data JSONB NOT NULL,
      jurisdiction VARCHAR(100),
      date_range JSONB,
      include_attachments BOOLEAN DEFAULT false,
      generated_by UUID REFERENCES users(user_id),
      generated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);
}

async function createReinsuranceTables() {
  // Reinsurance treaties table
  await db.query(`
    CREATE TABLE IF NOT EXISTS reinsurance_treaties (
      treaty_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
      treaty_name VARCHAR(255) NOT NULL,
      treaty_type VARCHAR(100) NOT NULL,
      reinsurer_name VARCHAR(255) NOT NULL,
      reinsurer_contact JSONB DEFAULT '{}',
      quota_share DECIMAL(5,2) DEFAULT 0,
      surplus_share DECIMAL(5,2) DEFAULT 0,
      attachment_point DECIMAL(15,2) DEFAULT 0,
      capacity DECIMAL(15,2) NOT NULL,
      premium_rate DECIMAL(5,4),
      commission_rate DECIMAL(5,4),
      coverage_lines JSONB DEFAULT '[]',
      terms_conditions TEXT,
      status VARCHAR(50) DEFAULT 'ACTIVE',
      effective_date DATE NOT NULL,
      expiration_date DATE NOT NULL,
      created_by UUID REFERENCES users(user_id),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  // Reinsurance cessions table
  await db.query(`
    CREATE TABLE IF NOT EXISTS reinsurance_cessions (
      cession_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
      policy_id UUID REFERENCES policies(policy_id),
      treaty_id UUID REFERENCES reinsurance_treaties(treaty_id),
      cession_type VARCHAR(50) NOT NULL,
      ceded_amount DECIMAL(15,2) NOT NULL,
      ceded_premium DECIMAL(15,2) NOT NULL,
      commission_rate DECIMAL(5,4),
      commission_amount DECIMAL(15,2) DEFAULT 0,
      net_ceded_premium DECIMAL(15,2) NOT NULL,
      attachment_point DECIMAL(15,2),
      calculated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  // Reinsurance recoveries table
  await db.query(`
    CREATE TABLE IF NOT EXISTS reinsurance_recoveries (
      recovery_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
      original_claim_id UUID REFERENCES claims(claim_id),
      treaty_id UUID REFERENCES reinsurance_treaties(treaty_id),
      claim_amount DECIMAL(15,2) NOT NULL,
      recovery_amount DECIMAL(15,2) NOT NULL,
      recovery_percentage DECIMAL(5,2),
      recovery_rate DECIMAL(5,4) NOT NULL,
      status VARCHAR(50) DEFAULT 'PENDING',
      notes TEXT,
      processed_at TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  // Facultative quotes table
  await db.query(`
    CREATE TABLE IF NOT EXISTS facultative_quotes (
      quote_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
      policy_type VARCHAR(100) NOT NULL,
      coverage_amount DECIMAL(15,2) NOT NULL,
      quoted_rate DECIMAL(5,4) NOT NULL,
      quoted_amount DECIMAL(15,2) NOT NULL,
      commission_rate DECIMAL(5,4) NOT NULL,
      commission_amount DECIMAL(15,2) NOT NULL,
      net_cost DECIMAL(15,2) NOT NULL,
      risk_details JSONB NOT NULL,
      special_conditions JSONB DEFAULT '{}',
      validity_period VARCHAR(50),
      status VARCHAR(50) DEFAULT 'QUOTED',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      expires_at TIMESTAMP WITH TIME ZONE
    );
  `);
}

async function createPartnerMarketplaceTables() {
  // Marketplace partners table
  await db.query(`
    CREATE TABLE IF NOT EXISTS marketplace_partners (
      partner_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
      partner_name VARCHAR(255) NOT NULL,
      category VARCHAR(100) NOT NULL,
      integration_type VARCHAR(100) NOT NULL,
      api_endpoint TEXT,
      webhook_url TEXT,
      authentication_config JSONB DEFAULT '{}',
      api_quota JSONB DEFAULT '{}',
      commission_structure JSONB DEFAULT '{}',
      contract_terms JSONB DEFAULT '{}',
      contact_info JSONB DEFAULT '{}',
      status VARCHAR(50) DEFAULT 'PENDING',
      rating DECIMAL(3,2) DEFAULT 0,
      monthly_volume DECIMAL(15,2) DEFAULT 0,
      contract_start DATE,
      contract_end DATE,
      last_tested_at TIMESTAMP WITH TIME ZONE,
      created_by UUID REFERENCES users(user_id),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  // Partner transactions table
  await db.query(`
    CREATE TABLE IF NOT EXISTS partner_transactions (
      transaction_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
      partner_id UUID REFERENCES marketplace_partners(partner_id),
      transaction_type VARCHAR(100) NOT NULL,
      reference_id VARCHAR(255),
      amount DECIMAL(15,2) NOT NULL,
      currency VARCHAR(10) DEFAULT 'USD',
      commission_amount DECIMAL(15,2) DEFAULT 0,
      net_amount DECIMAL(15,2) NOT NULL,
      status VARCHAR(50) DEFAULT 'PENDING',
      metadata JSONB DEFAULT '{}',
      partner_response JSONB DEFAULT '{}',
      error_message TEXT,
      callback_url TEXT,
      processed_at TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  // Integration tests table
  await db.query(`
    CREATE TABLE IF NOT EXISTS integration_tests (
      test_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
      partner_id UUID REFERENCES marketplace_partners(partner_id),
      test_type VARCHAR(100) NOT NULL,
      test_results JSONB NOT NULL,
      status VARCHAR(50) NOT NULL,
      tested_by UUID REFERENCES users(user_id),
      tested_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  // Partner API keys table
  await db.query(`
    CREATE TABLE IF NOT EXISTS partner_api_keys (
      key_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
      partner_id UUID REFERENCES marketplace_partners(partner_id),
      key_name VARCHAR(255) NOT NULL,
      api_key VARCHAR(255) UNIQUE NOT NULL,
      secret_key VARCHAR(255) NOT NULL,
      permissions JSONB DEFAULT '[]',
      expiration_date TIMESTAMP WITH TIME ZONE,
      status VARCHAR(50) DEFAULT 'ACTIVE',
      last_used_at TIMESTAMP WITH TIME ZONE,
      created_by UUID REFERENCES users(user_id),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);
}

async function createApisSdksTables() {
  // API endpoints table
  await db.query(`
    CREATE TABLE IF NOT EXISTS api_endpoints (
      endpoint_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
      endpoint_path VARCHAR(255) NOT NULL,
      http_method VARCHAR(10) NOT NULL,
      category VARCHAR(100) NOT NULL,
      description TEXT,
      parameters JSONB DEFAULT '[]',
      request_schema JSONB,
      response_schema JSONB,
      examples JSONB DEFAULT '{}',
      rate_limits JSONB DEFAULT '{}',
      version VARCHAR(20) DEFAULT 'v1',
      is_public BOOLEAN DEFAULT true,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  // API requests table
  await db.query(`
    CREATE TABLE IF NOT EXISTS api_requests (
      request_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
      endpoint VARCHAR(255) NOT NULL,
      http_method VARCHAR(10) NOT NULL,
      client_id VARCHAR(255),
      user_id UUID REFERENCES users(user_id),
      ip_address INET,
      user_agent TEXT,
      status_code INTEGER,
      response_time_ms INTEGER,
      request_size INTEGER,
      response_size INTEGER,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  // API keys table
  await db.query(`
    CREATE TABLE IF NOT EXISTS api_keys (
      key_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
      key_name VARCHAR(255) NOT NULL,
      api_key VARCHAR(255) UNIQUE NOT NULL,
      secret_key VARCHAR(255) NOT NULL,
      permissions JSONB DEFAULT '[]',
      rate_limit INTEGER DEFAULT 1000,
      expires_at TIMESTAMP WITH TIME ZONE,
      allowed_ips JSONB DEFAULT '[]',
      description TEXT,
      status VARCHAR(50) DEFAULT 'ACTIVE',
      last_used_at TIMESTAMP WITH TIME ZONE,
      created_by UUID REFERENCES users(user_id),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  // SDK generations table
  await db.query(`
    CREATE TABLE IF NOT EXISTS sdk_generations (
      sdk_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
      language VARCHAR(50) NOT NULL,
      version VARCHAR(20) DEFAULT 'v1',
      code TEXT NOT NULL,
      include_examples BOOLEAN DEFAULT true,
      generated_by UUID REFERENCES users(user_id),
      generated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  // Webhook configurations table
  await db.query(`
    CREATE TABLE IF NOT EXISTS webhook_configurations (
      webhook_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
      webhook_url TEXT NOT NULL,
      event_type VARCHAR(100) NOT NULL,
      secret_key VARCHAR(255),
      retry_attempts INTEGER DEFAULT 3,
      timeout_seconds INTEGER DEFAULT 30,
      filters JSONB DEFAULT '{}',
      headers JSONB DEFAULT '{}',
      status VARCHAR(50) DEFAULT 'ACTIVE',
      last_triggered_at TIMESTAMP WITH TIME ZONE,
      failure_count INTEGER DEFAULT 0,
      created_by UUID REFERENCES users(user_id),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  // Rate limits table
  await db.query(`
    CREATE TABLE IF NOT EXISTS rate_limits (
      limit_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
      client_id VARCHAR(255),
      endpoint VARCHAR(255),
      rate_limit INTEGER NOT NULL,
      window_size INTEGER NOT NULL,
      current_usage INTEGER DEFAULT 0,
      remaining_requests INTEGER,
      reset_time TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);
}

async function createSecurityTables() {
  // Security alerts table
  await db.query(`
    CREATE TABLE IF NOT EXISTS security_alerts (
      alert_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
      alert_type VARCHAR(100) NOT NULL,
      severity VARCHAR(20) NOT NULL,
      title VARCHAR(255) NOT NULL,
      description TEXT,
      affected_resources JSONB DEFAULT '[]',
      source_ip INET,
      user_id UUID REFERENCES users(user_id),
      status VARCHAR(50) DEFAULT 'OPEN',
      assigned_to UUID REFERENCES users(user_id),
      resolved_at TIMESTAMP WITH TIME ZONE,
      resolution_notes TEXT,
      created_by UUID REFERENCES users(user_id),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  // Security events table
  await db.query(`
    CREATE TABLE IF NOT EXISTS security_events (
      event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
      event_type VARCHAR(100) NOT NULL,
      severity VARCHAR(20) DEFAULT 'LOW',
      source_ip INET,
      user_id UUID REFERENCES users(user_id),
      description TEXT,
      metadata JSONB DEFAULT '{}',
      success BOOLEAN NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  // Access control logs table
  await db.query(`
    CREATE TABLE IF NOT EXISTS access_control_logs (
      log_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
      resource_type VARCHAR(100) NOT NULL,
      resource_id UUID,
      action VARCHAR(100) NOT NULL,
      user_id UUID REFERENCES users(user_id),
      permissions_requested JSONB DEFAULT '[]',
      permissions_granted JSONB DEFAULT '[]',
      granted BOOLEAN NOT NULL,
      source_ip INET,
      user_agent TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  // Security scans table
  await db.query(`
    CREATE TABLE IF NOT EXISTS security_scans (
      scan_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
      scan_type VARCHAR(100) NOT NULL,
      target_areas JSONB DEFAULT '[]',
      status VARCHAR(50) NOT NULL,
      results JSONB DEFAULT '{}',
      security_score INTEGER,
      error_message TEXT,
      started_at TIMESTAMP WITH TIME ZONE,
      completed_at TIMESTAMP WITH TIME ZONE,
      duration_seconds INTEGER,
      created_by UUID REFERENCES users(user_id),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  // Compliance controls table
  await db.query(`
    CREATE TABLE IF NOT EXISTS compliance_controls (
      control_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
      framework VARCHAR(100) NOT NULL,
      control_name VARCHAR(255) NOT NULL,
      control_category VARCHAR(100) NOT NULL,
      implementation_status VARCHAR(50) DEFAULT 'NOT_IMPLEMENTED',
      last_assessed TIMESTAMP WITH TIME ZONE,
      assessed_by UUID REFERENCES users(user_id),
      evidence_location TEXT,
      notes TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  // Compliance assessments table
  await db.query(`
    CREATE TABLE IF NOT EXISTS compliance_assessments (
      assessment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
      framework VARCHAR(100) NOT NULL,
      assessment_type VARCHAR(100) NOT NULL,
      overall_score DECIMAL(5,2),
      assessment_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      assessor_name VARCHAR(255),
      key_findings TEXT,
      recommendations TEXT,
      next_assessment_date TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  // System health checks table
  await db.query(`
    CREATE TABLE IF NOT EXISTS system_health_checks (
      check_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
      component VARCHAR(100) NOT NULL,
      status VARCHAR(50) NOT NULL,
      last_check TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      response_time_ms INTEGER,
      uptime_percentage DECIMAL(5,2),
      details JSONB DEFAULT '{}',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);
}

async function createSandboxTables() {
  // Sandbox environments table
  await db.query(`
    CREATE TABLE IF NOT EXISTS sandbox_environments (
      environment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
      environment_name VARCHAR(255) NOT NULL,
      environment_type VARCHAR(100) NOT NULL,
      configuration JSONB NOT NULL,
      resources JSONB NOT NULL,
      access_urls JSONB DEFAULT '{}',
      status VARCHAR(50) DEFAULT 'CREATING',
      template_id UUID,
      expires_at TIMESTAMP WITH TIME ZONE,
      last_used TIMESTAMP WITH TIME ZONE,
      deleted_at TIMESTAMP WITH TIME ZONE,
      error_message TEXT,
      created_by UUID REFERENCES users(user_id),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  // Sandbox activity logs table
  await db.query(`
    CREATE TABLE IF NOT EXISTS sandbox_activity_logs (
      log_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
      environment_id UUID REFERENCES sandbox_environments(environment_id) ON DELETE CASCADE,
      activity_type VARCHAR(100) NOT NULL,
      description TEXT NOT NULL,
      status VARCHAR(50),
      metadata JSONB DEFAULT '{}',
      performed_by UUID REFERENCES users(user_id),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  // Sandbox metrics table
  await db.query(`
    CREATE TABLE IF NOT EXISTS sandbox_metrics (
      metric_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
      environment_id UUID REFERENCES sandbox_environments(environment_id) ON DELETE CASCADE,
      metric_type VARCHAR(100) NOT NULL,
      metric_value DECIMAL(15,4) NOT NULL,
      unit VARCHAR(50),
      recorded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  // Data clone jobs table
  await db.query(`
    CREATE TABLE IF NOT EXISTS data_clone_jobs (
      job_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
      environment_id UUID REFERENCES sandbox_environments(environment_id) ON DELETE CASCADE,
      data_types JSONB NOT NULL,
      status VARCHAR(50) DEFAULT 'PENDING',
      records_copied JSONB DEFAULT '{}',
      error_message TEXT,
      started_at TIMESTAMP WITH TIME ZONE,
      completed_at TIMESTAMP WITH TIME ZONE,
      created_by UUID REFERENCES users(user_id),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  // Sandbox templates table
  await db.query(`
    CREATE TABLE IF NOT EXISTS sandbox_templates (
      template_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
      template_name VARCHAR(255) NOT NULL,
      description TEXT,
      environment_type VARCHAR(100) NOT NULL,
      configuration JSONB NOT NULL,
      resources JSONB NOT NULL,
      estimated_cost DECIMAL(10,2),
      popularity_score INTEGER DEFAULT 0,
      is_public BOOLEAN DEFAULT false,
      created_by UUID REFERENCES users(user_id),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  // Resource usage table
  await db.query(`
    CREATE TABLE IF NOT EXISTS resource_usage (
      usage_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
      environment_id UUID REFERENCES sandbox_environments(environment_id) ON DELETE CASCADE,
      resource_type VARCHAR(100) NOT NULL,
      allocated_amount DECIMAL(15,2) NOT NULL,
      used_amount DECIMAL(15,2) DEFAULT 0,
      date_recorded TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  // Sandbox data snapshots table
  await db.query(`
    CREATE TABLE IF NOT EXISTS sandbox_data_snapshots (
      snapshot_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
      environment_id UUID REFERENCES sandbox_environments(environment_id) ON DELETE CASCADE,
      data_type VARCHAR(100) NOT NULL,
      record_count JSONB NOT NULL,
      snapshot_date TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);
}

async function createTestingTables() {
  // Test suites table
  await db.query(`
    CREATE TABLE IF NOT EXISTS test_suites (
      suite_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
      suite_name VARCHAR(255) NOT NULL,
      test_type VARCHAR(100) NOT NULL,
      category VARCHAR(100),
      description TEXT,
      test_cases JSONB NOT NULL,
      configuration JSONB DEFAULT '{}',
      environment_id UUID,
      status VARCHAR(50) DEFAULT 'DRAFT',
      total_tests INTEGER DEFAULT 0,
      passed_tests INTEGER DEFAULT 0,
      failed_tests INTEGER DEFAULT 0,
      skipped_tests INTEGER DEFAULT 0,
      execution_time DECIMAL(10,3),
      last_run_at TIMESTAMP WITH TIME ZONE,
      created_by UUID REFERENCES users(user_id),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  // Test executions table
  await db.query(`
    CREATE TABLE IF NOT EXISTS test_executions (
      execution_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
      suite_id UUID REFERENCES test_suites(suite_id) ON DELETE CASCADE,
      environment_id UUID,
      status VARCHAR(50) NOT NULL,
      execution_config JSONB DEFAULT '{}',
      execution_time DECIMAL(10,3),
      error_message TEXT,
      started_at TIMESTAMP WITH TIME ZONE,
      completed_at TIMESTAMP WITH TIME ZONE,
      created_by UUID REFERENCES users(user_id),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  // Test results table
  await db.query(`
    CREATE TABLE IF NOT EXISTS test_results (
      result_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
      execution_id UUID REFERENCES test_executions(execution_id) ON DELETE CASCADE,
      test_case_name VARCHAR(255) NOT NULL,
      test_case_id VARCHAR(255),
      status VARCHAR(50) NOT NULL,
      execution_time DECIMAL(10,3),
      error_message TEXT,
      screenshots JSONB DEFAULT '[]',
      logs JSONB DEFAULT '{}',
      metadata JSONB DEFAULT '{}',
      started_at TIMESTAMP WITH TIME ZONE,
      completed_at TIMESTAMP WITH TIME ZONE
    );
  `);

  // Test reports table
  await db.query(`
    CREATE TABLE IF NOT EXISTS test_reports (
      report_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
      report_type VARCHAR(100) NOT NULL,
      report_data JSONB NOT NULL,
      date_range JSONB,
      include_details BOOLEAN DEFAULT false,
      format VARCHAR(20) DEFAULT 'json',
      generated_by UUID REFERENCES users(user_id),
      generated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  // Performance tests table
  await db.query(`
    CREATE TABLE IF NOT EXISTS performance_tests (
      test_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
      test_name VARCHAR(255) NOT NULL,
      target_endpoint TEXT NOT NULL,
      load_profile JSONB NOT NULL,
      ramp_up_time INTEGER NOT NULL,
      peak_load INTEGER NOT NULL,
      duration INTEGER NOT NULL,
      environment_id UUID,
      status VARCHAR(50) DEFAULT 'SCHEDULED',
      results JSONB DEFAULT '{}',
      created_by UUID REFERENCES users(user_id),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      started_at TIMESTAMP WITH TIME ZONE,
      completed_at TIMESTAMP WITH TIME ZONE
    );
  `);
}

// Export database utilities
