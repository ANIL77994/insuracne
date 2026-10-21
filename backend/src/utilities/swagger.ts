import { Request } from 'express';

export function getSwaggerSpec(serverUrl?: string) {
  const url = serverUrl || `http://localhost:${process.env.PORT || 3000}`;

  return {
    openapi: '3.0.3',
    info: {
      title: 'Insurance Automation Platform API',
      version: '1.0.0',
      description:
        'Enterprise Insurance Automation Platform API covering 21 core engines: Policy Management, Claims Processing, Underwriting, Quotes & Pricing, Billing, Documents, Analytics, Risk Scoring, Fraud Detection, CRM, Telematics, Workflows, Compliance, Reinsurance, Partner Marketplace, APIs/SDKs, Security, Sandbox, and Testing.',
      contact: {
        name: 'API Support',
        email: 'support@insuranceplatform.com',
      },
    },
    servers: [
      {
        url,
        description: 'Current Server',
      },
      {
        url: 'http://localhost:3000',
        description: 'Localhost (Port 3000)',
      },
    ],
    security: [
      {
        bearerAuth: [],
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Enter your JWT access token obtained from /api/auth/login',
        },
        apiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-Key',
          description: 'API key for developer integrations',
        },
      },
      schemas: {
        StandardSuccess: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            data: { type: 'object' },
            message: { type: 'string', example: 'Operation completed successfully' },
          },
        },
        StandardError: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            error: { type: 'string', example: 'Error description' },
            code: { type: 'string', example: 'VALIDATION_ERROR' },
          },
        },
        RegisterRequest: {
          type: 'object',
          required: ['email', 'password', 'firstName', 'lastName'],
          properties: {
            email: { type: 'string', format: 'email', example: 'admin@insurance.com' },
            password: { type: 'string', format: 'password', example: 'SecurePassword123!' },
            firstName: { type: 'string', example: 'John' },
            lastName: { type: 'string', example: 'Doe' },
            role: { type: 'string', enum: ['admin', 'manager', 'underwriter', 'adjuster', 'customer'], example: 'admin' },
            workspaceName: { type: 'string', example: 'Acme Insurance Corp' },
          },
        },
        LoginRequest: {
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: { type: 'string', format: 'email', example: 'admin@insurance.com' },
            password: { type: 'string', format: 'password', example: 'SecurePassword123!' },
          },
        },
        PolicyCreate: {
          type: 'object',
          required: ['policyType', 'premiumAmount', 'coverageAmount', 'effectiveDate', 'expirationDate'],
          properties: {
            customerId: { type: 'string', format: 'uuid', example: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' },
            productId: { type: 'string', format: 'uuid' },
            policyType: { type: 'string', example: 'Auto' },
            premiumAmount: { type: 'number', example: 1250.0 },
            coverageAmount: { type: 'number', example: 50000.0 },
            deductible: { type: 'number', example: 500.0 },
            effectiveDate: { type: 'string', format: 'date', example: '2026-10-01' },
            expirationDate: { type: 'string', format: 'date', example: '2027-10-01' },
            paymentFrequency: { type: 'string', example: 'monthly' },
            policyData: { type: 'object', example: { vehicleVin: '1HGCR2F83HA000000' } },
          },
        },
        ClaimCreate: {
          type: 'object',
          required: ['claimantName', 'claimType', 'claimedAmount', 'incidentDate'],
          properties: {
            policyId: { type: 'string', format: 'uuid' },
            customerId: { type: 'string', format: 'uuid' },
            claimantName: { type: 'string', example: 'Jane Smith' },
            claimType: { type: 'string', example: 'collision' },
            claimedAmount: { type: 'number', example: 4500.0 },
            incidentDate: { type: 'string', format: 'date', example: '2026-10-10' },
            priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'], example: 'normal' },
            claimData: { type: 'object', example: { description: 'Fender bender on highway' } },
          },
        },
        QuoteCreate: {
          type: 'object',
          required: ['coverageAmount'],
          properties: {
            customerId: { type: 'string', format: 'uuid' },
            productId: { type: 'string', format: 'uuid' },
            coverageAmount: { type: 'number', example: 100000.0 },
            deductible: { type: 'number', example: 1000.0 },
            applicant_data: { type: 'object', example: { age: 35, creditTier: 'good' } },
            risk_data: { type: 'object', example: { violations: 0 } },
          },
        },
        UnderwritingEvaluate: {
          type: 'object',
          properties: {
            customerId: { type: 'string', format: 'uuid' },
            policyType: { type: 'string', example: 'auto' },
            application_data: { type: 'object', example: { creditScore: 740, priorClaims: 0 } },
          },
        },
        BillingCreate: {
          type: 'object',
          required: ['amount', 'dueDate'],
          properties: {
            policyId: { type: 'string', format: 'uuid' },
            customerId: { type: 'string', format: 'uuid' },
            billing_type: { type: 'string', example: 'premium' },
            amount: { type: 'number', example: 125.0 },
            dueDate: { type: 'string', format: 'date', example: '2026-11-01' },
            paymentMethod: { type: 'string', example: 'credit_card' },
          },
        },
        DocumentUpload: {
          type: 'object',
          required: ['file_name'],
          properties: {
            file_name: { type: 'string', example: 'incident_report.pdf' },
            file_type: { type: 'string', example: 'application/pdf' },
            file_size: { type: 'number', example: 204850 },
            file_url: { type: 'string', example: 'https://storage.example.com/docs/incident.pdf' },
            document_type: { type: 'string', example: 'police_report' },
            category: { type: 'string', example: 'claims' },
          },
        },
        RiskScoreRequest: {
          type: 'object',
          properties: {
            customer_id: { type: 'string', format: 'uuid' },
            policy_id: { type: 'string', format: 'uuid' },
            model_type: { type: 'string', example: 'AUTO_RISK_V2' },
            input_data: { type: 'object', example: { drivingHistoryYears: 10, vehicleAge: 3 } },
          },
        },
        FraudAnalysisRequest: {
          type: 'object',
          properties: {
            claim_id: { type: 'string', format: 'uuid' },
            claimant_data: { type: 'object', example: { claimant_id: 'cus_1', coverage_limit: 50000 } },
            incident_data: { type: 'object', example: { claim_type: 'theft', claimed_amount: 15000, incident_date: '2026-10-10' } },
          },
        },
        TelematicsIngest: {
          type: 'object',
          required: ['device_id'],
          properties: {
            device_id: { type: 'string', format: 'uuid' },
            speed: { type: 'number', example: 62.5 },
            acceleration: { type: 'number', example: 2.1 },
            braking_events: { type: 'number', example: 1 },
            night_driving: { type: 'number', example: 0.1 },
            timestamp: { type: 'string', format: 'date-time' },
          },
        },
        WorkflowCreate: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string', example: 'Claims Approval Pipeline' },
            category: { type: 'string', example: 'CLAIMS' },
            version: { type: 'string', example: '1.0' },
            workflow_steps: { type: 'array', items: { type: 'object' }, example: [{ step: 1, name: 'Triage' }, { step: 2, name: 'Adjuster Review' }, { step: 3, name: 'Disbursement' }] },
          },
        },
        ComplianceReqCreate: {
          type: 'object',
          required: ['title'],
          properties: {
            title: { type: 'string', example: 'NAIC Annual Statutory Financial Filing' },
            jurisdiction: { type: 'string', example: 'US-FED' },
            category: { type: 'string', example: 'FINANCIAL' },
            due_date: { type: 'string', format: 'date', example: '2026-12-31' },
            frequency: { type: 'string', example: 'ANNUAL' },
          },
        },
        ReinsuranceTreatyCreate: {
          type: 'object',
          required: ['treaty_name', 'treaty_type', 'reinsurer_name', 'effective_date'],
          properties: {
            treaty_name: { type: 'string', example: 'Property Quota Share 2026' },
            treaty_type: { type: 'string', example: 'QUOTA_SHARE' },
            reinsurer_name: { type: 'string', example: 'Swiss Re' },
            effective_date: { type: 'string', format: 'date', example: '2026-01-01' },
            capacity: { type: 'number', example: 10000000.0 },
            attachment_point: { type: 'number', example: 100000.0 },
          },
        },
        SandboxEnvCreate: {
          type: 'object',
          properties: {
            environment_name: { type: 'string', example: 'Dev Testing Sandbox' },
            environment_type: { type: 'string', enum: ['development', 'testing', 'staging'], example: 'development' },
            expiration_hours: { type: 'number', example: 48 },
            clone_from_production: { type: 'boolean', example: false },
          },
        },
        TestSuiteCreate: {
          type: 'object',
          required: ['suite_name'],
          properties: {
            suite_name: { type: 'string', example: 'Policy Quoting Integration Suite' },
            test_type: { type: 'string', example: 'INTEGRATION' },
            category: { type: 'string', example: 'API' },
            test_cases: { type: 'array', items: { type: 'object' }, example: [{ name: 'Validate Premium Calculation' }] },
          },
        },
        SecurityAlertCreate: {
          type: 'object',
          required: ['title', 'alert_type'],
          properties: {
            title: { type: 'string', example: 'Multiple Failed Login Attempts' },
            alert_type: { type: 'string', example: 'BRUTE_FORCE' },
            severity: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'], example: 'HIGH' },
            description: { type: 'string', example: 'IP 192.168.1.100 failed login 10 times' },
          },
        },
      },
    },
    tags: [
      { name: 'System & Health', description: 'Platform health check and system information' },
      { name: 'Authentication', description: 'User login, registration, token refresh, and profiles' },
      { name: 'Workspaces', description: 'Multi-tenant workspace settings and membership' },
      { name: 'Policies', description: 'Policy lifecycle, endorsements, and renewals' },
      { name: 'Claims', description: 'Claims adjudication, status updates, and settlement' },
      { name: 'Underwriting', description: 'Risk assessment, automated rules, and decision logging' },
      { name: 'Quotes & Pricing', description: 'Rating engines, quote generation, and comparison' },
      { name: 'Billing & Payments', description: 'Invoices, premiums, and payment transactions' },
      { name: 'Documents', description: 'Document upload, metadata indexing, and OCR jobs' },
      { name: 'Analytics & Reports', description: 'KPI dashboards and regulatory reporting' },
      { name: 'Risk Scoring', description: 'Actuarial risk models and score calculation' },
      { name: 'Fraud Detection', description: 'Suspicious claim detection and SIU investigations' },
      { name: 'CRM & Communications', description: 'Customer profiles, communications, and support' },
      { name: 'Telematics', description: 'IoT device tracking, driving behavior, and dynamic pricing' },
      { name: 'Workflow Orchestration', description: 'Multi-step business processes and instance state' },
      { name: 'Compliance', description: 'Regulatory requirements, audit tasks, and statutory reporting' },
      { name: 'Reinsurance', description: 'Treaties, treaty cessions, and claim recoveries' },
      { name: 'Partner Marketplace', description: 'Third-party integrations, apps, and credentials' },
      { name: 'APIs & SDKs', description: 'API endpoints catalog, API keys, and SDK downloads' },
      { name: 'Security & Audits', description: 'Security alerts, audit logs, and automated vulnerability scans' },
      { name: 'Sandbox Environments', description: 'Isolated test environments and production cloning' },
      { name: 'Testing & QA', description: 'Automated test suites, execution runs, and performance tests' },
      { name: 'Admin', description: 'User administration and system health' },
    ],
    paths: {
      '/health': {
        get: {
          tags: ['System & Health'],
          summary: 'Service health check',
          responses: {
            200: {
              description: 'Service is healthy',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/StandardSuccess' } } },
            },
          },
        },
      },
      '/api': {
        get: {
          tags: ['System & Health'],
          summary: 'List available platform engines',
          responses: {
            200: { description: 'Engine catalog' },
          },
        },
      },
      '/api/auth/register': {
        post: {
          tags: ['Authentication'],
          summary: 'Register a new user and workspace',
          security: [],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/RegisterRequest' } } },
          },
          responses: {
            201: { description: 'User registered successfully' },
            400: { description: 'Validation error' },
          },
        },
      },
      '/api/auth/login': {
        post: {
          tags: ['Authentication'],
          summary: 'Authenticate user with email and password',
          security: [],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/LoginRequest' } } },
          },
          responses: {
            200: { description: 'Login successful, returns JWT token' },
            401: { description: 'Invalid credentials' },
          },
        },
      },
      '/api/auth/me': {
        get: {
          tags: ['Authentication'],
          summary: 'Get current authenticated user info',
          responses: { 200: { description: 'Authenticated user profile' }, 401: { description: 'Unauthorized' } },
        },
      },
      '/api/auth/profile': {
        get: {
          tags: ['Authentication'],
          summary: 'Get detailed authenticated user profile with workspace details',
          responses: { 200: { description: 'Detailed profile' } },
        },
      },
      '/api/auth/validate-token': {
        get: {
          tags: ['Authentication'],
          summary: 'Validate the current token',
          responses: { 200: { description: 'Token is valid' } },
        },
      },
      '/api/auth/logout': {
        post: {
          tags: ['Authentication'],
          summary: 'Log out current user',
          responses: { 200: { description: 'Logged out successfully' } },
        },
      },
      '/api/workspaces': {
        get: {
          tags: ['Workspaces'],
          summary: 'Get current workspace details and user counts',
          responses: { 200: { description: 'Workspace data' } },
        },
      },
      '/api/workspaces/settings': {
        put: {
          tags: ['Workspaces'],
          summary: 'Update workspace settings',
          requestBody: {
            content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' }, settings: { type: 'object' } } } } },
          },
          responses: { 200: { description: 'Workspace updated' } },
        },
      },
      '/api/workspaces/members': {
        get: {
          tags: ['Workspaces'],
          summary: 'List users in the workspace',
          responses: { 200: { description: 'Workspace members list' } },
        },
      },
      '/api/policies': {
        get: {
          tags: ['Policies'],
          summary: 'List policies with pagination and filtering',
          parameters: [
            { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
            { name: 'status', in: 'query', schema: { type: 'string' } },
            { name: 'policyType', in: 'query', schema: { type: 'string' } },
            { name: 'search', in: 'query', schema: { type: 'string' } },
          ],
          responses: { 200: { description: 'List of policies' } },
        },
        post: {
          tags: ['Policies'],
          summary: 'Create a new insurance policy',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/PolicyCreate' } } },
          },
          responses: { 201: { description: 'Policy created successfully' } },
        },
      },
      '/api/policies/{policyId}': {
        get: {
          tags: ['Policies'],
          summary: 'Get single policy details',
          parameters: [{ name: 'policyId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'Policy details' }, 404: { description: 'Policy not found' } },
        },
        put: {
          tags: ['Policies'],
          summary: 'Update policy details',
          parameters: [{ name: 'policyId', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { premiumAmount: { type: 'number' }, coverageAmount: { type: 'number' } } } } } },
          responses: { 200: { description: 'Policy updated' } },
        },
      },
      '/api/policies/{policyId}/status': {
        put: {
          tags: ['Policies'],
          summary: 'Change policy status (e.g., active, cancelled, expired)',
          parameters: [{ name: 'policyId', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object', required: ['status'], properties: { status: { type: 'string' }, reason: { type: 'string' } } } } },
          },
          responses: { 200: { description: 'Status updated' } },
        },
      },
      '/api/policies/{policyId}/endorsements': {
        post: {
          tags: ['Policies'],
          summary: 'Add an endorsement / policy modification',
          parameters: [{ name: 'policyId', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object', required: ['endorsementType'], properties: { endorsementType: { type: 'string' }, description: { type: 'string' } } } } },
          },
          responses: { 201: { description: 'Endorsement added' } },
        },
      },
      '/api/claims': {
        get: {
          tags: ['Claims'],
          summary: 'List claims with status & adjuster filters',
          parameters: [
            { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
            { name: 'status', in: 'query', schema: { type: 'string' } },
            { name: 'priority', in: 'query', schema: { type: 'string' } },
            { name: 'search', in: 'query', schema: { type: 'string' } },
          ],
          responses: { 200: { description: 'Claims list' } },
        },
        post: {
          tags: ['Claims'],
          summary: 'File a new insurance claim',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ClaimCreate' } } },
          },
          responses: { 201: { description: 'Claim filed successfully' } },
        },
      },
      '/api/claims/{claimId}': {
        get: {
          tags: ['Claims'],
          summary: 'Get single claim with incident details',
          parameters: [{ name: 'claimId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'Claim details' }, 404: { description: 'Claim not found' } },
        },
      },
      '/api/claims/{claimId}/status': {
        put: {
          tags: ['Claims'],
          summary: 'Update claim adjudication status',
          parameters: [{ name: 'claimId', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object', required: ['status'], properties: { status: { type: 'string' }, approvedAmount: { type: 'number' }, settlementAmount: { type: 'number' }, notes: { type: 'string' } } } } },
          },
          responses: { 200: { description: 'Claim status updated' } },
        },
      },
      '/api/claims/analytics/summary': {
        get: {
          tags: ['Claims'],
          summary: 'Get claims statistics summary',
          responses: { 200: { description: 'Claims summary statistics' } },
        },
      },
      '/api/underwriting/cases': {
        get: {
          tags: ['Underwriting'],
          summary: 'List underwriting cases',
          parameters: [
            { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
            { name: 'status', in: 'query', schema: { type: 'string' } },
            { name: 'riskCategory', in: 'query', schema: { type: 'string' } },
          ],
          responses: { 200: { description: 'Underwriting cases' } },
        },
      },
      '/api/underwriting/evaluate': {
        post: {
          tags: ['Underwriting'],
          summary: 'Run automated risk evaluation on application',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/UnderwritingEvaluate' } } },
          },
          responses: { 201: { description: 'Evaluation completed with risk score and recommendation' } },
        },
      },
      '/api/underwriting/cases/{id}': {
        get: {
          tags: ['Underwriting'],
          summary: 'Get single underwriting case details',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'Case details with risk factors' } },
        },
      },
      '/api/underwriting/cases/{id}/decision': {
        post: {
          tags: ['Underwriting'],
          summary: 'Record underwriter decision (APPROVE / REJECT / REFER)',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object', required: ['decision'], properties: { decision: { type: 'string', enum: ['APPROVED', 'REJECTED', 'REFERRED'] }, decision_reason: { type: 'string' } } } } },
          },
          responses: { 200: { description: 'Decision recorded' } },
        },
      },
      '/api/quotes': {
        get: {
          tags: ['Quotes & Pricing'],
          summary: 'List generated quotes',
          parameters: [
            { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
            { name: 'status', in: 'query', schema: { type: 'string' } },
          ],
          responses: { 200: { description: 'List of quotes' } },
        },
        post: {
          tags: ['Quotes & Pricing'],
          summary: 'Generate a new quote with premium calculation',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/QuoteCreate' } } },
          },
          responses: { 201: { description: 'Quote generated' } },
        },
      },
      '/api/quotes/{id}': {
        get: {
          tags: ['Quotes & Pricing'],
          summary: 'Get single quote details',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'Quote details' } },
        },
        put: {
          tags: ['Quotes & Pricing'],
          summary: 'Update quote status or terms',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { status: { type: 'string' }, coverageAmount: { type: 'number' } } } } } },
          responses: { 200: { description: 'Quote updated' } },
        },
        delete: {
          tags: ['Quotes & Pricing'],
          summary: 'Delete quote',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'Quote deleted' } },
        },
      },
      '/api/quotes/compare': {
        post: {
          tags: ['Quotes & Pricing'],
          summary: 'Compare multiple quotes',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object', required: ['quoteIds'], properties: { quoteIds: { type: 'array', items: { type: 'string' } }, customerId: { type: 'string' } } } } },
          },
          responses: { 200: { description: 'Quote comparison result' } },
        },
      },
      '/api/billing/records': {
        get: {
          tags: ['Billing & Payments'],
          summary: 'List billing records and invoices',
          parameters: [
            { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
            { name: 'status', in: 'query', schema: { type: 'string' } },
          ],
          responses: { 200: { description: 'Billing records' } },
        },
        post: {
          tags: ['Billing & Payments'],
          summary: 'Create a new invoice / billing record',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/BillingCreate' } } },
          },
          responses: { 201: { description: 'Invoice created' } },
        },
      },
      '/api/billing/summary': {
        get: {
          tags: ['Billing & Payments'],
          summary: 'Get billing financial overview (total billed, paid, pending, overdue)',
          responses: { 200: { description: 'Billing overview statistics' } },
        },
      },
      '/api/billing/records/{id}/pay': {
        post: {
          tags: ['Billing & Payments'],
          summary: 'Process payment for a billing record',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            content: { 'application/json': { schema: { type: 'object', properties: { paymentMethod: { type: 'string' }, transactionId: { type: 'string' } } } } },
          },
          responses: { 200: { description: 'Payment recorded' } },
        },
      },
      '/api/documents': {
        get: {
          tags: ['Documents'],
          summary: 'List uploaded documents',
          parameters: [
            { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
            { name: 'category', in: 'query', schema: { type: 'string' } },
            { name: 'search', in: 'query', schema: { type: 'string' } },
          ],
          responses: { 200: { description: 'Documents list' } },
        },
      },
      '/api/documents/upload': {
        post: {
          tags: ['Documents'],
          summary: 'Upload & index document metadata',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/DocumentUpload' } } },
          },
          responses: { 201: { description: 'Document uploaded and processing job queued' } },
        },
      },
      '/api/documents/{id}': {
        get: {
          tags: ['Documents'],
          summary: 'Get single document details & processing history',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'Document details' } },
        },
        delete: {
          tags: ['Documents'],
          summary: 'Delete document',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'Document deleted' } },
        },
      },
      '/api/analytics/dashboard': {
        get: {
          tags: ['Analytics & Reports'],
          summary: 'Get real-time system business KPI dashboard',
          responses: { 200: { description: 'Analytics KPIs' } },
        },
      },
      '/api/analytics/reports': {
        get: {
          tags: ['Analytics & Reports'],
          summary: 'List generated reports',
          responses: { 200: { description: 'Reports list' } },
        },
        post: {
          tags: ['Analytics & Reports'],
          summary: 'Generate a new business report',
          requestBody: {
            content: { 'application/json': { schema: { type: 'object', properties: { report_type: { type: 'string' }, jurisdiction: { type: 'string' } } } } },
          },
          responses: { 201: { description: 'Report generated' } },
        },
      },
      '/api/risk-scoring/score': {
        post: {
          tags: ['Risk Scoring'],
          summary: 'Calculate actuarial risk score',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/RiskScoreRequest' } } },
          },
          responses: { 200: { description: 'Risk score calculated' } },
        },
      },
      '/api/risk-scoring/models': {
        get: {
          tags: ['Risk Scoring'],
          summary: 'List available risk scoring models',
          responses: { 200: { description: 'Risk models list' } },
        },
      },
      '/api/fraud-detection/analyze-claim': {
        post: {
          tags: ['Fraud Detection'],
          summary: 'Analyze claim for fraudulent signals',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/FraudAnalysisRequest' } } },
          },
          responses: { 200: { description: 'Fraud assessment score and risk factors' } },
        },
      },
      '/api/fraud-detection/dashboard': {
        get: {
          tags: ['Fraud Detection'],
          summary: 'Get fraud detection metrics and high-risk claims summary',
          responses: { 200: { description: 'Fraud metrics dashboard' } },
        },
      },
      '/api/crm/customers': {
        get: {
          tags: ['CRM & Communications'],
          summary: 'List customers',
          parameters: [
            { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
            { name: 'search', in: 'query', schema: { type: 'string' } },
          ],
          responses: { 200: { description: 'Customers list' } },
        },
        post: {
          tags: ['CRM & Communications'],
          summary: 'Create a new customer profile',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object', required: ['firstName', 'lastName', 'email'], properties: { firstName: { type: 'string' }, lastName: { type: 'string' }, email: { type: 'string' }, phone: { type: 'string' } } } } },
          },
          responses: { 201: { description: 'Customer created' } },
        },
      },
      '/api/telematics/devices': {
        get: {
          tags: ['Telematics'],
          summary: 'List connected telematics IoT devices',
          responses: { 200: { description: 'Devices list' } },
        },
        post: {
          tags: ['Telematics'],
          summary: 'Register a new telematics device',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object', required: ['serialNumber', 'deviceName'], properties: { serialNumber: { type: 'string' }, deviceName: { type: 'string' }, deviceType: { type: 'string' }, policyId: { type: 'string' } } } } },
          },
          responses: { 201: { description: 'Device registered' } },
        },
      },
      '/api/telematics/data': {
        post: {
          tags: ['Telematics'],
          summary: 'Ingest telematics sensor packet',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/TelematicsIngest' } } },
          },
          responses: { 200: { description: 'Packet ingested and driving score updated' } },
        },
      },
      '/api/telematics/dashboard': {
        get: {
          tags: ['Telematics'],
          summary: 'Get telematics fleet dashboard',
          responses: { 200: { description: 'Fleet telematics status' } },
        },
      },
      '/api/workflow/workflows': {
        get: {
          tags: ['Workflow Orchestration'],
          summary: 'List workflow definitions',
          responses: { 200: { description: 'Workflows list' } },
        },
        post: {
          tags: ['Workflow Orchestration'],
          summary: 'Create a new workflow definition',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/WorkflowCreate' } } },
          },
          responses: { 201: { description: 'Workflow definition created' } },
        },
      },
      '/api/workflow/instances': {
        get: {
          tags: ['Workflow Orchestration'],
          summary: 'List active workflow instances',
          responses: { 200: { description: 'Workflow instances' } },
        },
        post: {
          tags: ['Workflow Orchestration'],
          summary: 'Start a workflow instance',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object', required: ['workflow_id'], properties: { workflow_id: { type: 'string' }, entity_type: { type: 'string' }, entity_id: { type: 'string' } } } } },
          },
          responses: { 201: { description: 'Instance started' } },
        },
      },
      '/api/compliance/requirements': {
        get: {
          tags: ['Compliance'],
          summary: 'List regulatory compliance requirements',
          responses: { 200: { description: 'Requirements list' } },
        },
        post: {
          tags: ['Compliance'],
          summary: 'Add a new compliance requirement',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ComplianceReqCreate' } } },
          },
          responses: { 201: { description: 'Requirement created' } },
        },
      },
      '/api/compliance/dashboard': {
        get: {
          tags: ['Compliance'],
          summary: 'Get regulatory compliance dashboard overview',
          responses: { 200: { description: 'Compliance dashboard' } },
        },
      },
      '/api/reinsurance/treaties': {
        get: {
          tags: ['Reinsurance'],
          summary: 'List active reinsurance treaties',
          responses: { 200: { description: 'Treaties list' } },
        },
        post: {
          tags: ['Reinsurance'],
          summary: 'Establish a new reinsurance treaty',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ReinsuranceTreatyCreate' } } },
          },
          responses: { 201: { description: 'Treaty established' } },
        },
      },
      '/api/reinsurance/cessions': {
        get: {
          tags: ['Reinsurance'],
          summary: 'List reinsurance claim recoveries and cessions',
          responses: { 200: { description: 'Cessions list' } },
        },
        post: {
          tags: ['Reinsurance'],
          summary: 'Submit a reinsurance cession / recovery request',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object', required: ['treaty_id', 'ceded_amount'], properties: { treaty_id: { type: 'string' }, ceded_amount: { type: 'number' }, original_claim_id: { type: 'string' } } } } },
          },
          responses: { 201: { description: 'Recovery request filed' } },
        },
      },
      '/api/reinsurance/dashboard': {
        get: {
          tags: ['Reinsurance'],
          summary: 'Get reinsurance capacity and recovery dashboard',
          responses: { 200: { description: 'Reinsurance statistics' } },
        },
      },
      '/api/partner-marketplace/apps': {
        get: {
          tags: ['Partner Marketplace'],
          summary: 'List available third-party apps and partner integrations',
          responses: { 200: { description: 'Partner apps catalog' } },
        },
        post: {
          tags: ['Partner Marketplace'],
          summary: 'Register partner integration application',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, category: { type: 'string' }, integration_type: { type: 'string' }, api_endpoint: { type: 'string' } } } } },
          },
          responses: { 201: { description: 'Partner app registered' } },
        },
      },
      '/api/partner-marketplace/dashboard': {
        get: {
          tags: ['Partner Marketplace'],
          summary: 'Get partner marketplace activity dashboard',
          responses: { 200: { description: 'Marketplace dashboard' } },
        },
      },
      '/api/apis-sdks/endpoints': {
        get: {
          tags: ['APIs & SDKs'],
          summary: 'List registered API endpoints',
          responses: { 200: { description: 'Endpoints catalog' } },
        },
      },
      '/api/apis-sdks/keys': {
        get: {
          tags: ['APIs & SDKs'],
          summary: 'List developer API keys',
          responses: { 200: { description: 'API keys list' } },
        },
        post: {
          tags: ['APIs & SDKs'],
          summary: 'Generate a new developer API key',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, permissions: { type: 'array', items: { type: 'string' } }, rate_limit: { type: 'integer' } } } } },
          },
          responses: { 201: { description: 'API key generated' } },
        },
      },
      '/api/apis-sdks/sdks': {
        get: {
          tags: ['APIs & SDKs'],
          summary: 'Get supported SDK packages (JS, Python, Go, Java)',
          responses: { 200: { description: 'SDKs list' } },
        },
      },
      '/api/apis-sdks/dashboard': {
        get: {
          tags: ['APIs & SDKs'],
          summary: 'Get developer portal dashboard metrics',
          responses: { 200: { description: 'Developer portal metrics' } },
        },
      },
      '/api/security/dashboard': {
        get: {
          tags: ['Security & Audits'],
          summary: 'Get security dashboard with alerts, auth events, and system health',
          responses: { 200: { description: 'Security dashboard' } },
        },
      },
      '/api/security/alerts': {
        get: {
          tags: ['Security & Audits'],
          summary: 'List security alerts',
          responses: { 200: { description: 'Security alerts' } },
        },
        post: {
          tags: ['Security & Audits'],
          summary: 'Create security alert',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/SecurityAlertCreate' } } },
          },
          responses: { 201: { description: 'Security alert created' } },
        },
      },
      '/api/security/scan': {
        post: {
          tags: ['Security & Audits'],
          summary: 'Run automated on-demand security scan',
          requestBody: {
            content: { 'application/json': { schema: { type: 'object', properties: { scan_type: { type: 'string', default: 'comprehensive' }, target_areas: { type: 'array', items: { type: 'string' } } } } } },
          },
          responses: { 200: { description: 'Security scan finished with security score' } },
        },
      },
      '/api/security/events': {
        get: {
          tags: ['Security & Audits'],
          summary: 'List security audit events timeline',
          responses: { 200: { description: 'Security events' } },
        },
      },
      '/api/sandbox/environments': {
        get: {
          tags: ['Sandbox Environments'],
          summary: 'List active sandbox environments',
          responses: { 200: { description: 'Environments list' } },
        },
        post: {
          tags: ['Sandbox Environments'],
          summary: 'Provision a new sandbox environment',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/SandboxEnvCreate' } } },
          },
          responses: { 201: { description: 'Environment created and provisioning started' } },
        },
      },
      '/api/sandbox/environments/{environment_id}/start': {
        post: {
          tags: ['Sandbox Environments'],
          summary: 'Start an existing sandbox environment',
          parameters: [{ name: 'environment_id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'Environment starting' } },
        },
      },
      '/api/sandbox/environments/{environment_id}/stop': {
        post: {
          tags: ['Sandbox Environments'],
          summary: 'Stop an existing sandbox environment',
          parameters: [{ name: 'environment_id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'Environment stopped' } },
        },
      },
      '/api/sandbox/dashboard': {
        get: {
          tags: ['Sandbox Environments'],
          summary: 'Get sandbox usage and resource utilization dashboard',
          responses: { 200: { description: 'Sandbox dashboard' } },
        },
      },
      '/api/testing/suites': {
        get: {
          tags: ['Testing & QA'],
          summary: 'List automated test suites',
          responses: { 200: { description: 'Test suites' } },
        },
        post: {
          tags: ['Testing & QA'],
          summary: 'Create an automated test suite',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/TestSuiteCreate' } } },
          },
          responses: { 201: { description: 'Test suite created' } },
        },
      },
      '/api/testing/suites/{suite_id}/run': {
        post: {
          tags: ['Testing & QA'],
          summary: 'Trigger test suite execution',
          parameters: [{ name: 'suite_id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            content: { 'application/json': { schema: { type: 'object', properties: { parallel_execution: { type: 'boolean' } } } } },
          },
          responses: { 200: { description: 'Execution started' } },
        },
      },
      '/api/testing/executions': {
        get: {
          tags: ['Testing & QA'],
          summary: 'List test execution history and results',
          responses: { 200: { description: 'Executions list' } },
        },
      },
      '/api/testing/analytics': {
        get: {
          tags: ['Testing & QA'],
          summary: 'Get QA test coverage, pass rates, and trends',
          responses: { 200: { description: 'QA testing analytics' } },
        },
      },
      '/api/admin/users': {
        get: {
          tags: ['Admin'],
          summary: 'List users with role and status filters',
          responses: { 200: { description: 'Users list' } },
        },
        post: {
          tags: ['Admin'],
          summary: 'Create a new user',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/RegisterRequest' } } },
          },
          responses: { 201: { description: 'User created' } },
        },
      },
      '/api/admin/system-stats': {
        get: {
          tags: ['Admin'],
          summary: 'Get system resource and database health stats',
          responses: { 200: { description: 'System health stats' } },
        },
      },
    },
  };
}

export const swaggerSpec = getSwaggerSpec();