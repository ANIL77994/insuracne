-- CreateTable
CREATE TABLE "workspaces" (
    "workspace_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(255) NOT NULL,
    "domain" VARCHAR(255),
    "plan_type" VARCHAR(50) DEFAULT 'starter',
    "api_key" VARCHAR(255) NOT NULL,
    "api_secret" VARCHAR(255) NOT NULL,
    "status" VARCHAR(50) DEFAULT 'active',
    "settings" JSONB DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("workspace_id")
);

-- CreateTable
CREATE TABLE "users" (
    "user_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID,
    "email" VARCHAR(255) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "first_name" VARCHAR(100) NOT NULL,
    "last_name" VARCHAR(100) NOT NULL,
    "role" VARCHAR(50) NOT NULL DEFAULT 'user',
    "permissions" JSONB DEFAULT '[]',
    "last_login_at" TIMESTAMPTZ(6),
    "is_active" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "customers" (
    "customer_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID,
    "first_name" VARCHAR(100) NOT NULL,
    "last_name" VARCHAR(100) NOT NULL,
    "email" VARCHAR(255),
    "phone" VARCHAR(50),
    "date_of_birth" DATE,
    "address" TEXT,
    "city" VARCHAR(100),
    "state" VARCHAR(100),
    "zip_code" VARCHAR(20),
    "status" VARCHAR(50) DEFAULT 'ACTIVE',
    "customer_type" VARCHAR(50) DEFAULT 'individual',
    "lifetime_value" DECIMAL(15,2) DEFAULT 0,
    "last_contact_date" TIMESTAMPTZ(6),
    "notes" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("customer_id")
);

-- CreateTable
CREATE TABLE "products" (
    "product_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "category" VARCHAR(100),
    "coverage_types" JSONB DEFAULT '[]',
    "pricing_model" VARCHAR(100),
    "is_active" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "products_pkey" PRIMARY KEY ("product_id")
);

-- CreateTable
CREATE TABLE "policies" (
    "policy_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID,
    "policy_number" VARCHAR(100) NOT NULL,
    "customer_id" UUID,
    "product_id" UUID,
    "policy_type" VARCHAR(100) NOT NULL,
    "status" VARCHAR(50) DEFAULT 'draft',
    "effective_date" DATE NOT NULL,
    "expiration_date" DATE NOT NULL,
    "premium_amount" DECIMAL(15,2) NOT NULL,
    "coverage_amount" DECIMAL(15,2) NOT NULL,
    "deductible" DECIMAL(15,2) DEFAULT 0,
    "policy_data" JSONB DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "policies_pkey" PRIMARY KEY ("policy_id")
);

-- CreateTable
CREATE TABLE "policy_endorsements" (
    "endorsement_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID,
    "policy_id" UUID,
    "endorsement_type" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "premium_adjustment" DECIMAL(15,2) DEFAULT 0,
    "effective_date" DATE NOT NULL,
    "status" VARCHAR(50) DEFAULT 'pending',
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "policy_endorsements_pkey" PRIMARY KEY ("endorsement_id")
);

-- CreateTable
CREATE TABLE "claims" (
    "claim_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID,
    "claim_number" VARCHAR(100) NOT NULL,
    "policy_id" UUID,
    "customer_id" UUID,
    "claimant_name" VARCHAR(255) NOT NULL,
    "claim_type" VARCHAR(100) NOT NULL,
    "status" VARCHAR(50) DEFAULT 'open',
    "priority" VARCHAR(20) DEFAULT 'normal',
    "incident_date" DATE NOT NULL,
    "reported_date" DATE NOT NULL,
    "claimed_amount" DECIMAL(15,2) NOT NULL,
    "approved_amount" DECIMAL(15,2) DEFAULT 0,
    "settlement_amount" DECIMAL(15,2) DEFAULT 0,
    "assigned_adjuster" UUID,
    "fraud_flags" JSONB DEFAULT '{}',
    "risk_level" VARCHAR(20) DEFAULT 'low',
    "requires_investigation" BOOLEAN DEFAULT false,
    "claim_data" JSONB DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "claims_pkey" PRIMARY KEY ("claim_id")
);

-- CreateTable
CREATE TABLE "risk_scoring_models" (
    "model_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID,
    "name" VARCHAR(255) NOT NULL,
    "version" VARCHAR(50) NOT NULL,
    "description" TEXT,
    "model_type" VARCHAR(100) NOT NULL,
    "risk_factors" JSONB NOT NULL,
    "thresholds" JSONB NOT NULL,
    "model_config" JSONB DEFAULT '{}',
    "accuracy_score" DECIMAL(5,4),
    "is_active" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "risk_scoring_models_pkey" PRIMARY KEY ("model_id")
);

-- CreateTable
CREATE TABLE "risk_scores" (
    "scoring_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID,
    "applicant_id" UUID,
    "policy_type" VARCHAR(100),
    "base_score" DECIMAL(5,2),
    "final_score" DECIMAL(5,2) NOT NULL,
    "risk_category" VARCHAR(50) NOT NULL,
    "factor_scores" JSONB DEFAULT '{}',
    "recommendations" JSONB DEFAULT '[]',
    "model_used" UUID,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "risk_scores_pkey" PRIMARY KEY ("scoring_id")
);

-- CreateTable
CREATE TABLE "communications" (
    "communication_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID,
    "customer_id" UUID,
    "communication_type" VARCHAR(50) NOT NULL,
    "subject" VARCHAR(255),
    "message" TEXT,
    "direction" VARCHAR(20) NOT NULL,
    "priority" VARCHAR(20) DEFAULT 'normal',
    "status" VARCHAR(50) DEFAULT 'PENDING',
    "sent_at" TIMESTAMPTZ(6),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "communications_pkey" PRIMARY KEY ("communication_id")
);

-- CreateTable
CREATE TABLE "fraud_investigations" (
    "investigation_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID,
    "analysis_id" UUID,
    "investigator_id" UUID,
    "status" VARCHAR(50) DEFAULT 'OPEN',
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fraud_investigations_pkey" PRIMARY KEY ("investigation_id")
);

-- CreateTable
CREATE TABLE "telematics_devices" (
    "device_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID,
    "device_name" VARCHAR(255) NOT NULL,
    "device_type" VARCHAR(100) NOT NULL,
    "serial_number" VARCHAR(255) NOT NULL,
    "firmware_version" VARCHAR(50),
    "policy_id" UUID,
    "installation_location" TEXT,
    "installation_date" DATE,
    "status" VARCHAR(50) DEFAULT 'ACTIVE',
    "last_seen" TIMESTAMPTZ(6),
    "battery_level" INTEGER,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telematics_devices_pkey" PRIMARY KEY ("device_id")
);

-- CreateTable
CREATE TABLE "telematics_data" (
    "data_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID,
    "device_id" UUID,
    "policy_id" UUID,
    "timestamp" TIMESTAMPTZ(6) NOT NULL,
    "location" JSONB,
    "speed" INTEGER,
    "acceleration" DECIMAL(5,2),
    "braking_events" INTEGER DEFAULT 0,
    "acceleration_events" INTEGER DEFAULT 0,
    "night_driving" DECIMAL(5,2) DEFAULT 0,
    "distance_travelled" DECIMAL(10,2) DEFAULT 0,
    "fuel_consumption" DECIMAL(8,2) DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telematics_data_pkey" PRIMARY KEY ("data_id")
);

-- CreateTable
CREATE TABLE "premium_adjustments" (
    "adjustment_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID,
    "policy_id" UUID,
    "adjustment_type" VARCHAR(50) NOT NULL,
    "original_premium" DECIMAL(15,2) NOT NULL,
    "adjusted_premium" DECIMAL(15,2) NOT NULL,
    "adjustment_percentage" DECIMAL(5,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "driving_score" DECIMAL(5,2),
    "analysis_points" INTEGER,
    "period_days" INTEGER,
    "effective_date" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "premium_adjustments_pkey" PRIMARY KEY ("adjustment_id")
);

-- CreateTable
CREATE TABLE "workflow_definitions" (
    "workflow_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "category" VARCHAR(100),
    "version" VARCHAR(50) NOT NULL,
    "workflow_steps" JSONB NOT NULL,
    "approval_rules" JSONB DEFAULT '{}',
    "escalation_rules" JSONB DEFAULT '{}',
    "sla_config" JSONB DEFAULT '{}',
    "status" VARCHAR(50) DEFAULT 'DRAFT',
    "is_active" BOOLEAN DEFAULT true,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_definitions_pkey" PRIMARY KEY ("workflow_id")
);

-- CreateTable
CREATE TABLE "workflow_instances" (
    "instance_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID,
    "workflow_id" UUID,
    "entity_type" VARCHAR(100) NOT NULL,
    "entity_id" UUID,
    "status" VARCHAR(50) DEFAULT 'PENDING',
    "priority" VARCHAR(20) DEFAULT 'normal',
    "current_step" VARCHAR(255),
    "current_assignee" UUID,
    "context_data" JSONB DEFAULT '{}',
    "initiated_by" UUID,
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_instances_pkey" PRIMARY KEY ("instance_id")
);

-- CreateTable
CREATE TABLE "compliance_requirements" (
    "requirement_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID,
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "jurisdiction" VARCHAR(100) NOT NULL,
    "category" VARCHAR(100) NOT NULL,
    "regulatory_body" VARCHAR(255),
    "effective_date" DATE NOT NULL,
    "due_date" DATE NOT NULL,
    "frequency" VARCHAR(50),
    "compliance_level" VARCHAR(50) NOT NULL,
    "submission_format" VARCHAR(100),
    "status" VARCHAR(50) DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compliance_requirements_pkey" PRIMARY KEY ("requirement_id")
);

-- CreateTable
CREATE TABLE "reinsurance_treaties" (
    "treaty_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID,
    "treaty_name" VARCHAR(255) NOT NULL,
    "treaty_type" VARCHAR(100) NOT NULL,
    "reinsurer_name" VARCHAR(255) NOT NULL,
    "reinsurer_contact" JSONB DEFAULT '{}',
    "quota_share" DECIMAL(5,2) DEFAULT 0,
    "surplus_share" DECIMAL(5,2) DEFAULT 0,
    "attachment_point" DECIMAL(15,2) DEFAULT 0,
    "capacity" DECIMAL(15,2) NOT NULL,
    "premium_rate" DECIMAL(5,4),
    "commission_rate" DECIMAL(5,4),
    "coverage_lines" JSONB DEFAULT '[]',
    "terms_conditions" TEXT,
    "status" VARCHAR(50) DEFAULT 'ACTIVE',
    "effective_date" DATE NOT NULL,
    "expiration_date" DATE NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reinsurance_treaties_pkey" PRIMARY KEY ("treaty_id")
);

-- CreateTable
CREATE TABLE "api_endpoints" (
    "endpoint_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID,
    "endpoint_path" VARCHAR(255) NOT NULL,
    "http_method" VARCHAR(10) NOT NULL,
    "category" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "parameters" JSONB DEFAULT '[]',
    "request_schema" JSONB,
    "response_schema" JSONB,
    "examples" JSONB DEFAULT '{}',
    "rate_limits" JSONB DEFAULT '{}',
    "version" VARCHAR(20) DEFAULT 'v1',
    "is_public" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_endpoints_pkey" PRIMARY KEY ("endpoint_id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "key_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID,
    "key_name" VARCHAR(255) NOT NULL,
    "api_key" VARCHAR(255) NOT NULL,
    "secret_key" VARCHAR(255) NOT NULL,
    "permissions" JSONB DEFAULT '[]',
    "rate_limit" INTEGER DEFAULT 1000,
    "expires_at" TIMESTAMPTZ(6),
    "allowed_ips" JSONB DEFAULT '[]',
    "description" TEXT,
    "status" VARCHAR(50) DEFAULT 'ACTIVE',
    "last_used_at" TIMESTAMPTZ(6),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("key_id")
);

-- CreateTable
CREATE TABLE "security_events" (
    "event_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID,
    "event_type" VARCHAR(100) NOT NULL,
    "severity" VARCHAR(20) DEFAULT 'LOW',
    "source_ip" INET,
    "user_id" UUID,
    "description" TEXT,
    "metadata" JSONB DEFAULT '{}',
    "success" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_events_pkey" PRIMARY KEY ("event_id")
);

-- CreateTable
CREATE TABLE "sandbox_environments" (
    "environment_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID,
    "environment_name" VARCHAR(255) NOT NULL,
    "environment_type" VARCHAR(100) NOT NULL,
    "configuration" JSONB NOT NULL,
    "resources" JSONB NOT NULL,
    "access_urls" JSONB DEFAULT '{}',
    "status" VARCHAR(50) DEFAULT 'CREATING',
    "template_id" UUID,
    "expires_at" TIMESTAMPTZ(6),
    "last_used" TIMESTAMPTZ(6),
    "deleted_at" TIMESTAMPTZ(6),
    "error_message" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sandbox_environments_pkey" PRIMARY KEY ("environment_id")
);

-- CreateTable
CREATE TABLE "test_suites" (
    "suite_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID,
    "suite_name" VARCHAR(255) NOT NULL,
    "test_type" VARCHAR(100) NOT NULL,
    "category" VARCHAR(100),
    "description" TEXT,
    "test_cases" JSONB NOT NULL,
    "configuration" JSONB DEFAULT '{}',
    "environment_id" UUID,
    "status" VARCHAR(50) DEFAULT 'DRAFT',
    "total_tests" INTEGER DEFAULT 0,
    "passed_tests" INTEGER DEFAULT 0,
    "failed_tests" INTEGER DEFAULT 0,
    "skipped_tests" INTEGER DEFAULT 0,
    "execution_time" DECIMAL(10,3),
    "last_run_at" TIMESTAMPTZ(6),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "test_suites_pkey" PRIMARY KEY ("suite_id")
);

-- CreateTable
CREATE TABLE "billing_records" (
    "record_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID,
    "policy_id" UUID,
    "customer_id" UUID,
    "billing_type" VARCHAR(50) NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "due_date" DATE NOT NULL,
    "paid_date" DATE,
    "status" VARCHAR(50) DEFAULT 'pending',
    "payment_method" VARCHAR(50),
    "transaction_id" VARCHAR(255),
    "late_fees" DECIMAL(15,2) DEFAULT 0,
    "adjustments" JSONB DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_records_pkey" PRIMARY KEY ("record_id")
);

-- CreateTable
CREATE TABLE "documents" (
    "document_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID,
    "file_name" VARCHAR(255) NOT NULL,
    "original_name" VARCHAR(255) NOT NULL,
    "file_type" VARCHAR(100) NOT NULL,
    "file_size" INTEGER NOT NULL,
    "file_url" TEXT NOT NULL,
    "document_type" VARCHAR(100),
    "category" VARCHAR(100),
    "associated_entity_type" VARCHAR(100),
    "associated_entity_id" UUID,
    "ocr_text" TEXT,
    "metadata" JSONB DEFAULT '{}',
    "uploaded_by" UUID,
    "uploaded_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(6),

    CONSTRAINT "documents_pkey" PRIMARY KEY ("document_id")
);

-- CreateTable
CREATE TABLE "quotes" (
    "quote_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID,
    "quote_number" VARCHAR(100) NOT NULL,
    "customer_id" UUID,
    "product_id" UUID,
    "applicant_data" JSONB NOT NULL,
    "risk_data" JSONB DEFAULT '{}',
    "quoted_premium" DECIMAL(15,2) NOT NULL,
    "coverage_amount" DECIMAL(15,2) NOT NULL,
    "deductible" DECIMAL(15,2) DEFAULT 0,
    "effective_date" DATE,
    "expiration_date" DATE,
    "status" VARCHAR(50) DEFAULT 'draft',
    "pricing_factors" JSONB DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quotes_pkey" PRIMARY KEY ("quote_id")
);

-- CreateTable
CREATE TABLE "underwriting_cases" (
    "case_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID,
    "customer_id" UUID,
    "policy_type" VARCHAR(100) NOT NULL,
    "application_data" JSONB NOT NULL,
    "risk_score" DECIMAL(5,2),
    "risk_category" VARCHAR(50),
    "status" VARCHAR(50) DEFAULT 'pending',
    "decision" VARCHAR(50),
    "decision_reason" TEXT,
    "underwriter_id" UUID,
    "reviewed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "underwriting_cases_pkey" PRIMARY KEY ("case_id")
);

-- CreateTable
CREATE TABLE "access_control_logs" (
    "log_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID,
    "resource_type" VARCHAR(100) NOT NULL,
    "resource_id" UUID,
    "action" VARCHAR(100) NOT NULL,
    "user_id" UUID,
    "permissions_requested" JSONB DEFAULT '[]',
    "permissions_granted" JSONB DEFAULT '[]',
    "granted" BOOLEAN NOT NULL,
    "source_ip" INET,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "access_control_logs_pkey" PRIMARY KEY ("log_id")
);

-- CreateTable
CREATE TABLE "analytics_data" (
    "data_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID,
    "metric_name" VARCHAR(100) NOT NULL,
    "metric_value" DECIMAL(15,4),
    "dimensions" JSONB DEFAULT '{}',
    "recorded_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_data_pkey" PRIMARY KEY ("data_id")
);

-- CreateTable
CREATE TABLE "api_requests" (
    "request_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID,
    "endpoint" VARCHAR(255) NOT NULL,
    "http_method" VARCHAR(10) NOT NULL,
    "client_id" VARCHAR(255),
    "user_id" UUID,
    "ip_address" INET,
    "user_agent" TEXT,
    "status_code" INTEGER,
    "response_time_ms" INTEGER,
    "request_size" INTEGER,
    "response_size" INTEGER,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_requests_pkey" PRIMARY KEY ("request_id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "log_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID,
    "table_name" VARCHAR(100) NOT NULL,
    "action_type" VARCHAR(50) NOT NULL,
    "record_id" VARCHAR(255),
    "old_values" JSONB,
    "new_values" JSONB,
    "performed_by" UUID,
    "ip_address" INET,
    "user_agent" TEXT,
    "timestamp" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("log_id")
);

-- CreateTable
CREATE TABLE "claim_documents" (
    "document_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID,
    "claim_id" UUID,
    "document_type" VARCHAR(100) NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "file_size" INTEGER,
    "file_url" TEXT,
    "uploaded_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "uploaded_by" UUID,

    CONSTRAINT "claim_documents_pkey" PRIMARY KEY ("document_id")
);

-- CreateTable
CREATE TABLE "compliance_assessments" (
    "assessment_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID,
    "framework" VARCHAR(100) NOT NULL,
    "assessment_type" VARCHAR(100) NOT NULL,
    "overall_score" DECIMAL(5,2),
    "assessment_date" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "assessor_name" VARCHAR(255),
    "key_findings" TEXT,
    "recommendations" TEXT,
    "next_assessment_date" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compliance_assessments_pkey" PRIMARY KEY ("assessment_id")
);

-- CreateTable
CREATE TABLE "compliance_controls" (
    "control_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID,
    "framework" VARCHAR(100) NOT NULL,
    "control_name" VARCHAR(255) NOT NULL,
    "control_category" VARCHAR(100) NOT NULL,
    "implementation_status" VARCHAR(50) DEFAULT 'NOT_IMPLEMENTED',
    "last_assessed" TIMESTAMPTZ(6),
    "assessed_by" UUID,
    "evidence_location" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compliance_controls_pkey" PRIMARY KEY ("control_id")
);

-- CreateTable
CREATE TABLE "compliance_reports" (
    "report_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID,
    "requirement_id" UUID,
    "report_period" VARCHAR(100) NOT NULL,
    "submission_data" JSONB NOT NULL,
    "attachments" JSONB DEFAULT '[]',
    "submission_status" VARCHAR(50) NOT NULL,
    "is_compliant" BOOLEAN NOT NULL,
    "overdue" BOOLEAN DEFAULT false,
    "submitted_by" UUID,
    "notes" TEXT,
    "submitted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compliance_reports_pkey" PRIMARY KEY ("report_id")
);

-- CreateTable
CREATE TABLE "compliance_tasks" (
    "task_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID,
    "requirement_id" UUID,
    "report_id" UUID,
    "task_type" VARCHAR(100) NOT NULL,
    "priority" VARCHAR(20) DEFAULT 'normal',
    "status" VARCHAR(50) DEFAULT 'PENDING',
    "assigned_to" UUID,
    "due_date" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "notes" TEXT,
    "completion_notes" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compliance_tasks_pkey" PRIMARY KEY ("task_id")
);

-- CreateTable
CREATE TABLE "data_clone_jobs" (
    "job_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID,
    "environment_id" UUID,
    "data_types" JSONB NOT NULL,
    "status" VARCHAR(50) DEFAULT 'PENDING',
    "records_copied" JSONB DEFAULT '{}',
    "error_message" TEXT,
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_clone_jobs_pkey" PRIMARY KEY ("job_id")
);

-- CreateTable
CREATE TABLE "document_processing_jobs" (
    "job_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID,
    "document_id" UUID,
    "job_type" VARCHAR(100) NOT NULL,
    "status" VARCHAR(50) DEFAULT 'pending',
    "progress" INTEGER DEFAULT 0,
    "result" JSONB DEFAULT '{}',
    "error_message" TEXT,
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_processing_jobs_pkey" PRIMARY KEY ("job_id")
);

-- CreateTable
CREATE TABLE "driving_behavior" (
    "analysis_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID,
    "device_id" UUID,
    "policy_id" UUID,
    "analysis_date" TIMESTAMPTZ(6) NOT NULL,
    "speed_score" INTEGER,
    "acceleration_score" INTEGER,
    "braking_score" INTEGER,
    "night_driving_score" INTEGER,
    "overall_score" INTEGER NOT NULL,
    "risk_level" VARCHAR(20) NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "driving_behavior_pkey" PRIMARY KEY ("analysis_id")
);

-- CreateTable
CREATE TABLE "facultative_quotes" (
    "quote_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID,
    "policy_type" VARCHAR(100) NOT NULL,
    "coverage_amount" DECIMAL(15,2) NOT NULL,
    "quoted_rate" DECIMAL(5,4) NOT NULL,
    "quoted_amount" DECIMAL(15,2) NOT NULL,
    "commission_rate" DECIMAL(5,4) NOT NULL,
    "commission_amount" DECIMAL(15,2) NOT NULL,
    "net_cost" DECIMAL(15,2) NOT NULL,
    "risk_details" JSONB NOT NULL,
    "special_conditions" JSONB DEFAULT '{}',
    "validity_period" VARCHAR(50),
    "status" VARCHAR(50) DEFAULT 'QUOTED',
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6),

    CONSTRAINT "facultative_quotes_pkey" PRIMARY KEY ("quote_id")
);

-- CreateTable
CREATE TABLE "fraud_analysis" (
    "analysis_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID,
    "claim_id" UUID,
    "fraud_score" INTEGER NOT NULL,
    "risk_level" VARCHAR(20) NOT NULL,
    "risk_factors" JSONB DEFAULT '[]',
    "alerts" JSONB DEFAULT '[]',
    "recommendations" JSONB DEFAULT '[]',
    "investigation_id" UUID,
    "investigation_status" VARCHAR(50),
    "investigator_assigned" UUID,
    "analysis_date" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fraud_analysis_pkey" PRIMARY KEY ("analysis_id")
);

-- CreateTable
CREATE TABLE "generated_reports" (
    "report_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID,
    "report_type" VARCHAR(100) NOT NULL,
    "report_data" JSONB NOT NULL,
    "jurisdiction" VARCHAR(100),
    "date_range" JSONB,
    "include_attachments" BOOLEAN DEFAULT false,
    "generated_by" UUID,
    "generated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "generated_reports_pkey" PRIMARY KEY ("report_id")
);

-- CreateTable
CREATE TABLE "integration_tests" (
    "test_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID,
    "partner_id" UUID,
    "test_type" VARCHAR(100) NOT NULL,
    "test_results" JSONB NOT NULL,
    "status" VARCHAR(50) NOT NULL,
    "tested_by" UUID,
    "tested_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integration_tests_pkey" PRIMARY KEY ("test_id")
);

-- CreateTable
CREATE TABLE "kpi_tracking" (
    "kpi_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID,
    "kpi_name" VARCHAR(100) NOT NULL,
    "current_value" DECIMAL(15,4),
    "target_value" DECIMAL(15,4),
    "unit" VARCHAR(50),
    "category" VARCHAR(100),
    "last_calculated" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "trend" VARCHAR(20),
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kpi_tracking_pkey" PRIMARY KEY ("kpi_id")
);

-- CreateTable
CREATE TABLE "marketplace_partners" (
    "partner_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID,
    "partner_name" VARCHAR(255) NOT NULL,
    "category" VARCHAR(100) NOT NULL,
    "integration_type" VARCHAR(100) NOT NULL,
    "api_endpoint" TEXT,
    "webhook_url" TEXT,
    "authentication_config" JSONB DEFAULT '{}',
    "api_quota" JSONB DEFAULT '{}',
    "commission_structure" JSONB DEFAULT '{}',
    "contract_terms" JSONB DEFAULT '{}',
    "contact_info" JSONB DEFAULT '{}',
    "status" VARCHAR(50) DEFAULT 'PENDING',
    "rating" DECIMAL(3,2) DEFAULT 0,
    "monthly_volume" DECIMAL(15,2) DEFAULT 0,
    "contract_start" DATE,
    "contract_end" DATE,
    "last_tested_at" TIMESTAMPTZ(6),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marketplace_partners_pkey" PRIMARY KEY ("partner_id")
);

-- CreateTable
CREATE TABLE "partner_api_keys" (
    "key_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID,
    "partner_id" UUID,
    "key_name" VARCHAR(255) NOT NULL,
    "api_key" VARCHAR(255) NOT NULL,
    "secret_key" VARCHAR(255) NOT NULL,
    "permissions" JSONB DEFAULT '[]',
    "expiration_date" TIMESTAMPTZ(6),
    "status" VARCHAR(50) DEFAULT 'ACTIVE',
    "last_used_at" TIMESTAMPTZ(6),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_api_keys_pkey" PRIMARY KEY ("key_id")
);

-- CreateTable
CREATE TABLE "partner_transactions" (
    "transaction_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID,
    "partner_id" UUID,
    "transaction_type" VARCHAR(100) NOT NULL,
    "reference_id" VARCHAR(255),
    "amount" DECIMAL(15,2) NOT NULL,
    "currency" VARCHAR(10) DEFAULT 'USD',
    "commission_amount" DECIMAL(15,2) DEFAULT 0,
    "net_amount" DECIMAL(15,2) NOT NULL,
    "status" VARCHAR(50) DEFAULT 'PENDING',
    "metadata" JSONB DEFAULT '{}',
    "partner_response" JSONB DEFAULT '{}',
    "error_message" TEXT,
    "callback_url" TEXT,
    "processed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_transactions_pkey" PRIMARY KEY ("transaction_id")
);

-- CreateTable
CREATE TABLE "payment_methods" (
    "method_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID,
    "customer_id" UUID,
    "method_type" VARCHAR(50) NOT NULL,
    "provider" VARCHAR(100),
    "last_four" VARCHAR(4),
    "is_default" BOOLEAN DEFAULT false,
    "expires_at" DATE,
    "status" VARCHAR(50) DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_methods_pkey" PRIMARY KEY ("method_id")
);

-- CreateTable
CREATE TABLE "performance_tests" (
    "test_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID,
    "test_name" VARCHAR(255) NOT NULL,
    "target_endpoint" TEXT NOT NULL,
    "load_profile" JSONB NOT NULL,
    "ramp_up_time" INTEGER NOT NULL,
    "peak_load" INTEGER NOT NULL,
    "duration" INTEGER NOT NULL,
    "environment_id" UUID,
    "status" VARCHAR(50) DEFAULT 'SCHEDULED',
    "results" JSONB DEFAULT '{}',
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "performance_tests_pkey" PRIMARY KEY ("test_id")
);

-- CreateTable
CREATE TABLE "quote_comparisons" (
    "comparison_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID,
    "customer_id" UUID,
    "quotes" JSONB NOT NULL,
    "comparison_data" JSONB DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quote_comparisons_pkey" PRIMARY KEY ("comparison_id")
);

-- CreateTable
CREATE TABLE "rate_limits" (
    "limit_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID,
    "client_id" VARCHAR(255),
    "endpoint" VARCHAR(255),
    "rate_limit" INTEGER NOT NULL,
    "window_size" INTEGER NOT NULL,
    "current_usage" INTEGER DEFAULT 0,
    "remaining_requests" INTEGER,
    "reset_time" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rate_limits_pkey" PRIMARY KEY ("limit_id")
);

-- CreateTable
CREATE TABLE "reinsurance_cessions" (
    "cession_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID,
    "policy_id" UUID,
    "treaty_id" UUID,
    "cession_type" VARCHAR(50) NOT NULL,
    "ceded_amount" DECIMAL(15,2) NOT NULL,
    "ceded_premium" DECIMAL(15,2) NOT NULL,
    "commission_rate" DECIMAL(5,4),
    "commission_amount" DECIMAL(15,2) DEFAULT 0,
    "net_ceded_premium" DECIMAL(15,2) NOT NULL,
    "attachment_point" DECIMAL(15,2),
    "calculated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reinsurance_cessions_pkey" PRIMARY KEY ("cession_id")
);

-- CreateTable
CREATE TABLE "reinsurance_recoveries" (
    "recovery_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID,
    "original_claim_id" UUID,
    "treaty_id" UUID,
    "claim_amount" DECIMAL(15,2) NOT NULL,
    "recovery_amount" DECIMAL(15,2) NOT NULL,
    "recovery_percentage" DECIMAL(5,2),
    "recovery_rate" DECIMAL(5,4) NOT NULL,
    "status" VARCHAR(50) DEFAULT 'PENDING',
    "notes" TEXT,
    "processed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reinsurance_recoveries_pkey" PRIMARY KEY ("recovery_id")
);

-- CreateTable
CREATE TABLE "resource_usage" (
    "usage_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID,
    "environment_id" UUID,
    "resource_type" VARCHAR(100) NOT NULL,
    "allocated_amount" DECIMAL(15,2) NOT NULL,
    "used_amount" DECIMAL(15,2) DEFAULT 0,
    "date_recorded" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resource_usage_pkey" PRIMARY KEY ("usage_id")
);

-- CreateTable
CREATE TABLE "risk_factors" (
    "factor_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID,
    "case_id" UUID,
    "factor_name" VARCHAR(100) NOT NULL,
    "factor_value" JSONB NOT NULL,
    "weight" DECIMAL(5,2) DEFAULT 1.0,
    "score" DECIMAL(5,2),
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "risk_factors_pkey" PRIMARY KEY ("factor_id")
);

-- CreateTable
CREATE TABLE "sandbox_activity_logs" (
    "log_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID,
    "environment_id" UUID,
    "activity_type" VARCHAR(100) NOT NULL,
    "description" TEXT NOT NULL,
    "status" VARCHAR(50),
    "metadata" JSONB DEFAULT '{}',
    "performed_by" UUID,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sandbox_activity_logs_pkey" PRIMARY KEY ("log_id")
);

-- CreateTable
CREATE TABLE "sandbox_data_snapshots" (
    "snapshot_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID,
    "environment_id" UUID,
    "data_type" VARCHAR(100) NOT NULL,
    "record_count" JSONB NOT NULL,
    "snapshot_date" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sandbox_data_snapshots_pkey" PRIMARY KEY ("snapshot_id")
);

-- CreateTable
CREATE TABLE "sandbox_metrics" (
    "metric_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID,
    "environment_id" UUID,
    "metric_type" VARCHAR(100) NOT NULL,
    "metric_value" DECIMAL(15,4) NOT NULL,
    "unit" VARCHAR(50),
    "recorded_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sandbox_metrics_pkey" PRIMARY KEY ("metric_id")
);

-- CreateTable
CREATE TABLE "sandbox_templates" (
    "template_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID,
    "template_name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "environment_type" VARCHAR(100) NOT NULL,
    "configuration" JSONB NOT NULL,
    "resources" JSONB NOT NULL,
    "estimated_cost" DECIMAL(10,2),
    "popularity_score" INTEGER DEFAULT 0,
    "is_public" BOOLEAN DEFAULT false,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sandbox_templates_pkey" PRIMARY KEY ("template_id")
);

-- CreateTable
CREATE TABLE "sdk_generations" (
    "sdk_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID,
    "language" VARCHAR(50) NOT NULL,
    "version" VARCHAR(20) DEFAULT 'v1',
    "code" TEXT NOT NULL,
    "include_examples" BOOLEAN DEFAULT true,
    "generated_by" UUID,
    "generated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sdk_generations_pkey" PRIMARY KEY ("sdk_id")
);

-- CreateTable
CREATE TABLE "security_alerts" (
    "alert_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID,
    "alert_type" VARCHAR(100) NOT NULL,
    "severity" VARCHAR(20) NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "affected_resources" JSONB DEFAULT '[]',
    "source_ip" INET,
    "user_id" UUID,
    "status" VARCHAR(50) DEFAULT 'OPEN',
    "assigned_to" UUID,
    "resolved_at" TIMESTAMPTZ(6),
    "resolution_notes" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_alerts_pkey" PRIMARY KEY ("alert_id")
);

-- CreateTable
CREATE TABLE "security_scans" (
    "scan_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID,
    "scan_type" VARCHAR(100) NOT NULL,
    "target_areas" JSONB DEFAULT '[]',
    "status" VARCHAR(50) NOT NULL,
    "results" JSONB DEFAULT '{}',
    "security_score" INTEGER,
    "error_message" TEXT,
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "duration_seconds" INTEGER,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_scans_pkey" PRIMARY KEY ("scan_id")
);

-- CreateTable
CREATE TABLE "system_health_checks" (
    "check_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID,
    "component" VARCHAR(100) NOT NULL,
    "status" VARCHAR(50) NOT NULL,
    "last_check" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "response_time_ms" INTEGER,
    "uptime_percentage" DECIMAL(5,2),
    "details" JSONB DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_health_checks_pkey" PRIMARY KEY ("check_id")
);

-- CreateTable
CREATE TABLE "test_executions" (
    "execution_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID,
    "suite_id" UUID,
    "environment_id" UUID,
    "status" VARCHAR(50) NOT NULL,
    "execution_config" JSONB DEFAULT '{}',
    "execution_time" DECIMAL(10,3),
    "error_message" TEXT,
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "test_executions_pkey" PRIMARY KEY ("execution_id")
);

-- CreateTable
CREATE TABLE "test_reports" (
    "report_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID,
    "report_type" VARCHAR(100) NOT NULL,
    "report_data" JSONB NOT NULL,
    "date_range" JSONB,
    "include_details" BOOLEAN DEFAULT false,
    "format" VARCHAR(20) DEFAULT 'json',
    "generated_by" UUID,
    "generated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "test_reports_pkey" PRIMARY KEY ("report_id")
);

-- CreateTable
CREATE TABLE "test_results" (
    "result_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID,
    "execution_id" UUID,
    "test_case_name" VARCHAR(255) NOT NULL,
    "test_case_id" VARCHAR(255),
    "status" VARCHAR(50) NOT NULL,
    "execution_time" DECIMAL(10,3),
    "error_message" TEXT,
    "screenshots" JSONB DEFAULT '[]',
    "logs" JSONB DEFAULT '{}',
    "metadata" JSONB DEFAULT '{}',
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "test_results_pkey" PRIMARY KEY ("result_id")
);

-- CreateTable
CREATE TABLE "user_sessions" (
    "session_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID,
    "workspace_id" UUID,
    "token_hash" VARCHAR(255) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "ip_address" INET,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("session_id")
);

-- CreateTable
CREATE TABLE "webhook_configurations" (
    "webhook_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID,
    "webhook_url" TEXT NOT NULL,
    "event_type" VARCHAR(100) NOT NULL,
    "secret_key" VARCHAR(255),
    "retry_attempts" INTEGER DEFAULT 3,
    "timeout_seconds" INTEGER DEFAULT 30,
    "filters" JSONB DEFAULT '{}',
    "headers" JSONB DEFAULT '{}',
    "status" VARCHAR(50) DEFAULT 'ACTIVE',
    "last_triggered_at" TIMESTAMPTZ(6),
    "failure_count" INTEGER DEFAULT 0,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_configurations_pkey" PRIMARY KEY ("webhook_id")
);

-- CreateTable
CREATE TABLE "workflow_history" (
    "history_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID,
    "instance_id" UUID,
    "step_name" VARCHAR(255),
    "action_type" VARCHAR(50) NOT NULL,
    "performed_by" UUID,
    "timestamp" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "details" JSONB DEFAULT '{}',
    "comments" TEXT,

    CONSTRAINT "workflow_history_pkey" PRIMARY KEY ("history_id")
);

-- CreateTable
CREATE TABLE "workflow_step_instances" (
    "step_instance_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID,
    "instance_id" UUID,
    "step_id" VARCHAR(255) NOT NULL,
    "step_name" VARCHAR(255) NOT NULL,
    "step_order" INTEGER NOT NULL,
    "status" VARCHAR(50) DEFAULT 'PENDING',
    "assigned_to" UUID,
    "due_date" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "comments" TEXT,
    "step_data" JSONB DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_step_instances_pkey" PRIMARY KEY ("step_instance_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workspaces_api_key_key" ON "workspaces"("api_key");

-- CreateIndex
CREATE UNIQUE INDEX "users_workspace_id_email_key" ON "users"("workspace_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "customers_email_key" ON "customers"("email");

-- CreateIndex
CREATE UNIQUE INDEX "policies_policy_number_key" ON "policies"("policy_number");

-- CreateIndex
CREATE UNIQUE INDEX "claims_claim_number_key" ON "claims"("claim_number");

-- CreateIndex
CREATE UNIQUE INDEX "telematics_devices_serial_number_key" ON "telematics_devices"("serial_number");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_api_key_key" ON "api_keys"("api_key");

-- CreateIndex
CREATE UNIQUE INDEX "quotes_quote_number_key" ON "quotes"("quote_number");

-- CreateIndex
CREATE UNIQUE INDEX "partner_api_keys_api_key_key" ON "partner_api_keys"("api_key");
