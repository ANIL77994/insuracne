import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';
import axios from 'axios';
import bcrypt from 'bcrypt';
import { prisma } from '../lib/prisma';
import authRoutes from '../routes/auth';
import adminRoutes from '../routes/admin';
import claimsRoutes from '../routes/claims';
import policyRoutes from '../routes/policies';
import { authenticateToken } from '../middleware/auth';
import { errorHandler } from '../middleware/errorHandler';
import { seedDefaultPermissions } from '../services/permissions';
import { RoleName } from '../constants/access';

async function runTestSuite() {
  console.log('🚀 Starting Comprehensive Roles & Permissions Test Suite...');

  // 1. Setup in-memory test express app
  const app = express();
  app.use(express.json());

  // Mount routes
  app.use('/api/auth', authRoutes);
  app.use('/api/admin', authenticateToken, adminRoutes);
  app.use('/api/claims', authenticateToken, claimsRoutes);
  app.use('/api/policies', authenticateToken, policyRoutes);
  app.use(errorHandler);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`📡 Test server running at ${baseUrl}`);

  const results: { test: string; passed: boolean; details?: string }[] = [];

  function record(test: string, passed: boolean, details?: string) {
    results.push({ test, passed, details });
    if (passed) {
      console.log(`  ✅ PASS: ${test}`);
    } else {
      console.error(`  ❌ FAIL: ${test} - ${details}`);
    }
  }

  try {
    // 2. Setup Test Workspace & Users
    const wsName = `Test_Workspace_${Date.now()}`;
    const workspace = await prisma.workspace.create({
      data: {
        name: wsName,
        apiKey: `test_key_${Date.now()}`,
        apiSecret: `test_sec_${Date.now()}`,
        status: 'active',
      },
    });

    await seedDefaultPermissions(workspace.workspaceId);

    const testPassword = 'Password@123';
    const passwordHash = await bcrypt.hash(testPassword, 10);

    async function createUser(emailPrefix: string, role: RoleName, isActive = true) {
      const email = `${emailPrefix}_${Date.now()}@testinsurance.com`;
      return prisma.user.create({
        data: {
          workspaceId: workspace.workspaceId,
          email,
          passwordHash,
          firstName: emailPrefix,
          lastName: 'Tester',
          role,
          isActive,
        },
      });
    }

    const superAdminUser = await createUser('superadmin', 'SUPER_ADMIN');
    const policyAdminUser = await createUser('policyadmin', 'POLICY_ADMINISTRATOR');
    const agentUser = await createUser('agent', 'AGENT');
    const claimAssessorUser = await createUser('assessor', 'CLAIM_ASSESSOR');
    const claimSupervisorUser = await createUser('supervisor', 'CLAIM_SUPERVISOR');
    const claimManagerUser = await createUser('claimmanager', 'CLAIM_MANAGER');
    const insurerUser = await createUser('insurer', 'INSURER');
    const inactiveUser = await createUser('inactive', 'AGENT', false);

    // Login helper
    async function login(email: string): Promise<string> {
      const res = await axios.post(`${baseUrl}/api/auth/login`, {
        email,
        password: testPassword,
      });
      return res.data.data.token;
    }

    const superAdminToken = await login(superAdminUser.email);
    const policyAdminToken = await login(policyAdminUser.email);
    const agentToken = await login(agentUser.email);
    const assessorToken = await login(claimAssessorUser.email);
    const supervisorToken = await login(claimSupervisorUser.email);
    const managerToken = await login(claimManagerUser.email);
    const insurerToken = await login(insurerUser.email);

    // Create a shared customer, policy, and claim for testing actions
    const customer = await prisma.customer.create({
      data: {
        workspaceId: workspace.workspaceId,
        firstName: 'John',
        lastName: 'Doe',
        email: `john_${Date.now()}@example.com`,
      },
    });

    const testClaim = await prisma.claim.create({
      data: {
        workspaceId: workspace.workspaceId,
        claimNumber: `CLM-TEST-${Date.now()}`,
        customerId: customer.customerId,
        policyId: '00000000-0000-0000-0000-000000000001',
        claimantName: 'John Doe',
        claimType: 'MOTOR',
        status: 'open',
        priority: 'normal',
        incidentDate: new Date(),
        reportedDate: new Date(),
        claimedAmount: 5000,
      },
    });

    // ─────────────────────────────────────────────────────────
    // Test Group 1: Authentication & Inactive Accounts
    // ─────────────────────────────────────────────────────────
    console.log('\n--- Test Group 1: Authentication & Inactive Guard ---');

    // 1.1 Unauthenticated request returns 401
    try {
      await axios.get(`${baseUrl}/api/admin/users`);
      record('1.1 Unauthenticated request rejected', false, 'Expected 401');
    } catch (err: any) {
      record('1.1 Unauthenticated request rejected', err.response?.status === 401);
    }

    // 1.2 Inactive account login returns 401
    try {
      await axios.post(`${baseUrl}/api/auth/login`, {
        email: inactiveUser.email,
        password: testPassword,
      });
      record('1.2 Inactive account cannot login', false, 'Expected 401');
    } catch (err: any) {
      record('1.2 Inactive account cannot login', err.response?.status === 401);
    }

    // ─────────────────────────────────────────────────────────
    // Test Group 2: Role-based Navigation & Permissions API
    // ─────────────────────────────────────────────────────────
    console.log('\n--- Test Group 2: User Permissions & Matrix API ---');

    // 2.1 Get self permissions for Agent
    const agentPermRes = await axios.get(`${baseUrl}/api/admin/me/permissions`, {
      headers: { Authorization: `Bearer ${agentToken}` },
    });
    record(
      '2.1 Agent can read own permissions matrix',
      agentPermRes.status === 200 &&
        agentPermRes.data.data.role === 'AGENT' &&
        agentPermRes.data.data.features?.customers?.create === true &&
        agentPermRes.data.data.features?.policies?.create === false,
    );

    // 2.2 Super Admin has full permissions
    const saPermRes = await axios.get(`${baseUrl}/api/admin/me/permissions`, {
      headers: { Authorization: `Bearer ${superAdminToken}` },
    });
    record(
      '2.2 Super Admin has full permissions matrix',
      saPermRes.status === 200 &&
        saPermRes.data.data.role === 'SUPER_ADMIN' &&
        saPermRes.data.data.features?.policies?.delete === true,
    );

    // ─────────────────────────────────────────────────────────
    // Test Group 3: Feature-level Access Control (Policies)
    // ─────────────────────────────────────────────────────────
    console.log('\n--- Test Group 3: Feature-level Permissions (Policies) ---');

    // 3.1 Policy Admin CAN view policies
    try {
      const res = await axios.get(`${baseUrl}/api/policies`, {
        headers: { Authorization: `Bearer ${policyAdminToken}` },
      });
      record('3.1 Policy Admin can view policies', res.status === 200);
    } catch (err: any) {
      record('3.1 Policy Admin can view policies', false, err.message);
    }

    // 3.2 Policy Admin CAN create policy
    try {
      const res = await axios.post(
        `${baseUrl}/api/policies`,
        {
          customerId: customer.customerId,
          policyType: 'auto',
          effectiveDate: '2026-01-01',
          expirationDate: '2027-01-01',
          premiumAmount: 1200,
          coverageAmount: 50000,
        },
        { headers: { Authorization: `Bearer ${policyAdminToken}` } },
      );
      record('3.2 Policy Admin can create policy', res.status === 201);
    } catch (err: any) {
      record('3.2 Policy Admin can create policy', false, err.message);
    }

    // 3.3 Agent CANNOT create policy (canCreate is false)
    try {
      await axios.post(
        `${baseUrl}/api/policies`,
        {
          customerId: customer.customerId,
          policyType: 'auto',
          effectiveDate: '2026-01-01',
          expirationDate: '2027-01-01',
          premiumAmount: 1200,
          coverageAmount: 50000,
        },
        { headers: { Authorization: `Bearer ${agentToken}` } },
      );
      record('3.3 Agent cannot create policy (Forbidden)', false, 'Expected 403');
    } catch (err: any) {
      record('3.3 Agent cannot create policy (Forbidden)', err.response?.status === 403);
    }

    // ─────────────────────────────────────────────────────────
    // Test Group 4: Claim-Specific Action Permissions
    // ─────────────────────────────────────────────────────────
    console.log('\n--- Test Group 4: Claim Actions Enforcement ---');

    // 4.1 Claim Assessor CANNOT approve a claim (requires 'approve' claimAction)
    try {
      await axios.post(
        `${baseUrl}/api/claims/${testClaim.claimId}/approve`,
        { approvedAmount: 4500 },
        { headers: { Authorization: `Bearer ${assessorToken}` } },
      );
      record('4.1 Claim Assessor cannot approve claim (Forbidden)', false, 'Expected 403');
    } catch (err: any) {
      record(
        '4.1 Claim Assessor cannot approve claim (Forbidden)',
        err.response?.status === 403,
      );
    }

    // 4.2 Claim Assessor CAN upload invoice (has 'upload_invoice')
    try {
      const res = await axios.post(
        `${baseUrl}/api/claims/${testClaim.claimId}/invoice`,
        { invoiceNumber: 'INV-001', amount: 500, vendor: 'BodyShop' },
        { headers: { Authorization: `Bearer ${assessorToken}` } },
      );
      record('4.2 Claim Assessor can upload invoice', res.status === 200);
    } catch (err: any) {
      record('4.2 Claim Assessor can upload invoice', false, err.message);
    }

    // 4.3 Claim Supervisor CANNOT approve a claim
    try {
      await axios.post(
        `${baseUrl}/api/claims/${testClaim.claimId}/approve`,
        { approvedAmount: 4500 },
        { headers: { Authorization: `Bearer ${supervisorToken}` } },
      );
      record('4.3 Claim Supervisor cannot approve claim (Forbidden)', false, 'Expected 403');
    } catch (err: any) {
      record(
        '4.3 Claim Supervisor cannot approve claim (Forbidden)',
        err.response?.status === 403,
      );
    }

    // 4.4 Claim Supervisor CAN repudiate a claim
    try {
      const res = await axios.post(
        `${baseUrl}/api/claims/${testClaim.claimId}/repudiate`,
        { reason: 'Policy exclusion applies' },
        { headers: { Authorization: `Bearer ${supervisorToken}` } },
      );
      record('4.4 Claim Supervisor can repudiate claim', res.status === 200);
    } catch (err: any) {
      record('4.4 Claim Supervisor can repudiate claim', false, err.message);
    }

    // 4.5 Claim Supervisor CANNOT process payout (has no payout_processed)
    try {
      await axios.post(
        `${baseUrl}/api/claims/${testClaim.claimId}/payout/process`,
        { settlementAmount: 4500 },
        { headers: { Authorization: `Bearer ${supervisorToken}` } },
      );
      record('4.5 Claim Supervisor cannot process payout (Forbidden)', false, 'Expected 403');
    } catch (err: any) {
      record(
        '4.5 Claim Supervisor cannot process payout (Forbidden)',
        err.response?.status === 403,
      );
    }

    // 4.6 Claim Manager CAN approve a claim
    try {
      const res = await axios.post(
        `${baseUrl}/api/claims/${testClaim.claimId}/approve`,
        { approvedAmount: 4500 },
        { headers: { Authorization: `Bearer ${managerToken}` } },
      );
      record('4.6 Claim Manager can approve claim', res.status === 200);
    } catch (err: any) {
      record('4.6 Claim Manager can approve claim', false, err.message);
    }

    // 4.7 Claim Manager CAN process payout
    try {
      const res = await axios.post(
        `${baseUrl}/api/claims/${testClaim.claimId}/payout/process`,
        { settlementAmount: 4500, paymentReference: 'EFT-789' },
        { headers: { Authorization: `Bearer ${managerToken}` } },
      );
      record('4.7 Claim Manager can process payout', res.status === 200);
    } catch (err: any) {
      record('4.7 Claim Manager can process payout', false, err.message);
    }

    // 4.8 Status update endpoint prevents unauthorized bypass:
    // Assessor trying to set status to 'approved' via PUT /api/claims/:id/status
    try {
      await axios.put(
        `${baseUrl}/api/claims/${testClaim.claimId}/status`,
        { status: 'approved' },
        { headers: { Authorization: `Bearer ${assessorToken}` } },
      );
      record('4.8 Status endpoint blocks unauthorized approval (Forbidden)', false, 'Expected 403');
    } catch (err: any) {
      record(
        '4.8 Status endpoint blocks unauthorized approval (Forbidden)',
        err.response?.status === 403,
      );
    }

    // ─────────────────────────────────────────────────────────
    // Test Group 5: Role & User Management Security
    // ─────────────────────────────────────────────────────────
    console.log('\n--- Test Group 5: Role Management & Privilege Guard ---');

    // 5.1 Unauthorized user (Agent) cannot access User Management
    try {
      await axios.get(`${baseUrl}/api/admin/users`, {
        headers: { Authorization: `Bearer ${agentToken}` },
      });
      record('5.1 Agent cannot access user management (Forbidden)', false, 'Expected 403');
    } catch (err: any) {
      record(
        '5.1 Agent cannot access user management (Forbidden)',
        err.response?.status === 403,
      );
    }

    // 5.2 Super Admin CAN access User Management
    try {
      const res = await axios.get(`${baseUrl}/api/admin/users`, {
        headers: { Authorization: `Bearer ${superAdminToken}` },
      });
      record('5.2 Super Admin can view user list', res.status === 200 && Array.isArray(res.data.data.users));
    } catch (err: any) {
      record('5.2 Super Admin can view user list', false, err.message);
    }

    // 5.3 Super Admin CAN view access levels matrix
    try {
      const res = await axios.get(`${baseUrl}/api/admin/access-levels`, {
        headers: { Authorization: `Bearer ${superAdminToken}` },
      });
      record(
        '5.3 Super Admin can view access levels matrix',
        res.status === 200 && res.data.data.roles.length === 8,
      );
    } catch (err: any) {
      record('5.3 Super Admin can view access levels matrix', false, err.message);
    }

    // 5.4 Self-role modification prevention: Super Admin cannot demote themselves
    try {
      await axios.put(
        `${baseUrl}/api/admin/users/${superAdminUser.userId}`,
        { role: 'AGENT' },
        { headers: { Authorization: `Bearer ${superAdminToken}` } },
      );
      record('5.4 Self-role update is blocked', false, 'Expected 400 error');
    } catch (err: any) {
      record(
        '5.4 Self-role update is blocked',
        err.response?.status === 400 && err.response?.data?.error?.code === 'SELF_UPDATE',
      );
    }

    // 5.5 Self-deactivation prevention: Super Admin cannot deactivate themselves
    try {
      await axios.put(
        `${baseUrl}/api/admin/users/${superAdminUser.userId}`,
        { status: 'inactive' },
        { headers: { Authorization: `Bearer ${superAdminToken}` } },
      );
      record('5.5 Self-deactivation is blocked', false, 'Expected 400 error');
    } catch (err: any) {
      record(
        '5.5 Self-deactivation is blocked',
        err.response?.status === 400 && err.response?.data?.error?.code === 'SELF_UPDATE',
      );
    }

    // 5.6 Self-deletion prevention: Super Admin cannot delete own account
    try {
      await axios.delete(`${baseUrl}/api/admin/users/${superAdminUser.userId}`, {
        headers: { Authorization: `Bearer ${superAdminToken}` },
      });
      record('5.6 Self-deletion is blocked', false, 'Expected 400 error');
    } catch (err: any) {
      record(
        '5.6 Self-deletion is blocked',
        err.response?.status === 400 && err.response?.data?.error?.code === 'SELF_DELETE',
      );
    }

    // 5.7 Super Admin can update access levels dynamically (e.g. grant Agent canDelete on quotes)
    try {
      const updateRes = await axios.put(
        `${baseUrl}/api/admin/access-levels/AGENT`,
        {
          features: [
            { feature: 'quotes', canView: true, canCreate: true, canUpdate: true, canDelete: true },
            { feature: 'customers', canView: true, canCreate: true, canUpdate: true, canDelete: false },
          ],
          claimActions: [],
        },
        { headers: { Authorization: `Bearer ${superAdminToken}` } },
      );
      record(
        '5.7 Dynamic permission update via AccessLevels API',
        updateRes.status === 200 && updateRes.data.data.features.quotes.delete === true,
      );
    } catch (err: any) {
      record('5.7 Dynamic permission update via AccessLevels API', false, err.message);
    }

    // 5.8 Verify dynamic permission change took effect immediately
    const updatedAgentPermRes = await axios.get(`${baseUrl}/api/admin/me/permissions`, {
      headers: { Authorization: `Bearer ${agentToken}` },
    });
    record(
      '5.8 Cache invalidated: Agent immediately sees updated quote delete permission',
      updatedAgentPermRes.data.data.features?.quotes?.delete === true,
    );

    // 5.9 Disallow editing SUPER_ADMIN permissions matrix
    try {
      await axios.put(
        `${baseUrl}/api/admin/access-levels/SUPER_ADMIN`,
        { features: [] },
        { headers: { Authorization: `Bearer ${superAdminToken}` } },
      );
      record('5.9 SUPER_ADMIN role matrix is immutable', false, 'Expected 403');
    } catch (err: any) {
      record('5.9 SUPER_ADMIN role matrix is immutable', err.response?.status === 403);
    }

    // ─────────────────────────────────────────────────────────
    // Summary
    // ─────────────────────────────────────────────────────────
    const passedCount = results.filter((r) => r.passed).length;
    const totalCount = results.length;
    console.log(`\n========================================`);
    console.log(`Test Results: ${passedCount}/${totalCount} Passed`);
    console.log(`========================================\n`);

    if (passedCount !== totalCount) {
      process.exit(1);
    }
  } finally {
    server.close();
    await prisma.$disconnect();
    process.exit(0);
  }
}

runTestSuite().catch((e) => {
  console.error('Test execution error:', e);
  process.exit(1);
});
