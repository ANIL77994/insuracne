import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../database/connection';
import { prisma } from '../lib/prisma';
import { requireFeature } from '../middleware/access';
import { asyncHandler, createError } from '../middleware/errorHandler';

const router = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Helper to seed standard products for workspace if none exist
async function ensureWorkspaceProducts(workspaceId: string) {
  const countRes = await db.query(
    'SELECT COUNT(*) as count FROM products WHERE workspace_id = $1',
    [workspaceId]
  );
  if (parseInt(countRes.rows[0].count) > 0) return;

  const standardProducts = [
    { name: 'Auto Insurance Plus', category: 'Automobile', desc: 'Comprehensive auto collision and liability coverage' },
    { name: 'Homeowners Secure', category: 'Property', desc: 'Complete home, dwelling, and personal property insurance' },
    { name: 'Term Life Protect', category: 'Life', desc: 'Flexible term life coverage with accidental death benefit' },
    { name: 'Health Comprehensive Care', category: 'Health', desc: 'Extensive medical, hospital, and preventive health insurance' },
  ];

  for (const prod of standardProducts) {
    await db.query(`
      INSERT INTO products (
        product_id, workspace_id, name, description, category, coverage_types, pricing_model, is_active, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, true, NOW(), NOW())
    `, [
      uuidv4(),
      workspaceId,
      prod.name,
      prod.desc,
      prod.category,
      JSON.stringify(['Standard', 'Comprehensive']),
      'flat_rate'
    ]);
  }
}

// Helper to seed sample customers for workspace if none exist
async function ensureWorkspaceCustomers(workspaceId: string) {
  const countRes = await db.query(
    'SELECT COUNT(*) as count FROM customers WHERE workspace_id = $1',
    [workspaceId]
  );
  if (parseInt(countRes.rows[0].count) > 0) return;

  const shortId = workspaceId.substring(0, 6);
  const defaultCustomers = [
    { first: 'John', last: 'Doe', email: `john.doe.${shortId}@example.com`, phone: '+1 (555) 234-5678', street: '123 Main St', city: 'San Francisco', state: 'CA', zip: '94105' },
    { first: 'Sarah', last: 'Johnson', email: `sarah.j.${shortId}@example.com`, phone: '+1 (555) 345-6789', street: '456 Market St', city: 'San Francisco', state: 'CA', zip: '94103' },
    { first: 'Michael', last: 'Chen', email: `m.chen.${shortId}@example.com`, phone: '+1 (555) 456-7890', street: '789 Mission St', city: 'San Jose', state: 'CA', zip: '95113' }
  ];

  for (const cust of defaultCustomers) {
    try {
      await db.query(`
        INSERT INTO customers (
          customer_id, workspace_id, first_name, last_name, email, phone,
          address, city, state, zip_code, status, customer_type, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'ACTIVE', 'individual', NOW(), NOW())
        ON CONFLICT (email) DO NOTHING
      `, [
        uuidv4(),
        workspaceId,
        cust.first,
        cust.last,
        cust.email,
        cust.phone,
        cust.street,
        cust.city,
        cust.state,
        cust.zip
      ]);
    } catch {
      // Continue if conflict
    }
  }
}

// Helper to normalize and enrich a policy row
function formatPolicy(row: any) {
  let policyData: any = {};
  try {
    policyData = typeof row.policy_data === 'string' ? JSON.parse(row.policy_data) : (row.policy_data || {});
  } catch {
    policyData = {};
  }

  const effectiveStr = row.effective_date ? new Date(row.effective_date).toISOString().split('T')[0] : '';
  const expiryStr = row.expiration_date ? new Date(row.expiration_date).toISOString().split('T')[0] : '';

  return {
    id: row.policy_id,
    policy_id: row.policy_id,
    policy_number: row.policy_number,
    customer_id: row.customer_id,
    product_id: row.product_id,
    policy_type: row.policy_type || 'General',
    status: row.status || 'draft',
    effective_date: effectiveStr,
    expiry_date: expiryStr,
    expiration_date: expiryStr,
    premium: parseFloat(row.premium_amount) || 0,
    premium_amount: parseFloat(row.premium_amount) || 0,
    sum_insured: parseFloat(row.coverage_amount) || 0,
    coverage_amount: parseFloat(row.coverage_amount) || 0,
    deductible: parseFloat(row.deductible) || 0,
    payment_frequency: policyData.payment_frequency || row.payment_frequency || 'monthly',
    special_conditions: policyData.special_conditions || row.special_conditions || '',
    policy_data: policyData,
    created_at: row.created_at,
    updated_at: row.updated_at,
    customer: row.customer_id ? {
      id: row.customer_id,
      customer_id: row.customer_id,
      first_name: row.customer_first_name || row.first_name || 'Customer',
      last_name: row.customer_last_name || row.last_name || '',
      email: row.customer_email || row.email || '',
      phone: row.customer_phone || row.phone || '',
      address: {
        street: row.customer_address || row.address || '',
        city: row.customer_city || row.city || '',
        state: row.customer_state || row.state || '',
        postal_code: row.customer_zip_code || row.zip_code || '',
        country: 'US'
      }
    } : undefined,
    product: row.product_id ? {
      id: row.product_id,
      product_id: row.product_id,
      name: row.product_name || row.name || 'Insurance Product',
      category: row.product_category || row.category || 'General',
      description: row.product_description || row.description || ''
    } : undefined
  };
}

// ---------------------------------------------------------------------------
// 1. GET /api/policies/products - List products for policy creation dropdown
// ---------------------------------------------------------------------------
router.get('/products', requireFeature('policies', 'view'), asyncHandler(async (req: any, res: Response) => {
  await ensureWorkspaceProducts(req.workspace_id);

  const query = await db.query(`
    SELECT product_id, name, description, category, is_active, created_at
    FROM products
    WHERE (workspace_id = $1 OR workspace_id IS NULL) AND is_active = true
    ORDER BY name ASC
  `, [req.workspace_id]);

  const products = query.rows.map((p) => ({
    id: p.product_id,
    product_id: p.product_id,
    name: p.name,
    description: p.description,
    category: p.category,
    is_active: p.is_active,
  }));

  res.json({
    success: true,
    data: { products }
  });
}));

// ---------------------------------------------------------------------------
// 2. GET /api/policies/customers - List customers for policy creation dropdown
// ---------------------------------------------------------------------------
router.get('/customers', requireFeature('policies', 'view'), asyncHandler(async (req: any, res: Response) => {
  await ensureWorkspaceCustomers(req.workspace_id);

  const query = await db.query(`
    SELECT customer_id, first_name, last_name, email, phone, address, city, state, zip_code
    FROM customers
    WHERE workspace_id = $1
    ORDER BY first_name ASC, last_name ASC
  `, [req.workspace_id]);

  const customers = query.rows.map((c) => ({
    id: c.customer_id,
    customer_id: c.customer_id,
    first_name: c.first_name,
    last_name: c.last_name,
    name: `${c.first_name || ''} ${c.last_name || ''}`.trim() || c.email || 'Customer',
    email: c.email,
    phone: c.phone,
    address: {
      street: c.address || '',
      city: c.city || '',
      state: c.state || '',
      postal_code: c.zip_code || '',
      country: 'US'
    }
  }));

  console.log("customers", customers)
  res.json({
    success: true,
    data: { customers }
  });
}));

// ---------------------------------------------------------------------------
// 2b. POST /api/policies/customers - Create new customer quickly
// ---------------------------------------------------------------------------
router.post('/customers', requireFeature('policies', 'create'), asyncHandler(async (req: any, res: Response) => {
  const {
    first_name, last_name, email, phone, address, city, state, zip_code
  } = req.body;

  if (!first_name || !email) {
    throw createError('First name and email are required', 400, 'VALIDATION_ERROR');
  }

  const customerId = uuidv4();
  await db.query(`
    INSERT INTO customers (
      customer_id, workspace_id, first_name, last_name, email, phone,
      address, city, state, zip_code, status, customer_type, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'ACTIVE', 'individual', NOW(), NOW())
  `, [
    customerId, req.workspace_id, first_name, last_name || '', email, phone || '',
    address || '', city || '', state || '', zip_code || ''
  ]);

  const customer = {
    id: customerId,
    customer_id: customerId,
    first_name,
    last_name: last_name || '',
    name: `${first_name} ${last_name || ''}`.trim(),
    email,
    phone: phone || '',
    address: { street: address || '', city: city || '', state: state || '', postal_code: zip_code || '' }
  };

  res.status(201).json({
    success: true,
    data: { customer, customerId }
  });
}));

// ---------------------------------------------------------------------------
// 3. GET /api/policies - List policies with joined Customer and Product
// ---------------------------------------------------------------------------
router.get('/', requireFeature('policies', 'view'), asyncHandler(async (req: any, res: Response) => {
  const { page = 1, limit = 50, status, policyType, search } = req.query;
  const parsedLimit = Math.min(Math.max(parseInt(limit as string) || 20, 1), 100);
  const offset = ((parseInt(page as string) || 1) - 1) * parsedLimit;

  let whereClause = 'WHERE p.workspace_id = $1';
  const queryParams: any[] = [req.workspace_id];
  let paramCount = 1;

  if (status && status !== 'all') {
    paramCount++;
    whereClause += ` AND p.status = $${paramCount}`;
    queryParams.push(status);
  }

  if (policyType && policyType !== 'all') {
    paramCount++;
    whereClause += ` AND p.policy_type = $${paramCount}`;
    queryParams.push(policyType);
  }

  if (search && String(search).trim() !== '') {
    paramCount++;
    whereClause += ` AND (
      p.policy_number ILIKE $${paramCount} 
      OR c.first_name ILIKE $${paramCount} 
      OR c.last_name ILIKE $${paramCount}
      OR c.email ILIKE $${paramCount}
      OR pr.name ILIKE $${paramCount}
    )`;
    queryParams.push(`%${search}%`);
  }

  const policiesQuery = await db.query(`
    SELECT 
      p.policy_id, p.workspace_id, p.policy_number, p.customer_id, p.product_id,
      p.policy_type, p.status, p.effective_date, p.expiration_date, p.premium_amount,
      p.coverage_amount, p.deductible, p.policy_data, p.created_at, p.updated_at,
      c.first_name as customer_first_name, c.last_name as customer_last_name,
      c.email as customer_email, c.phone as customer_phone,
      c.address as customer_address, c.city as customer_city,
      c.state as customer_state, c.zip_code as customer_zip_code,
      pr.name as product_name, pr.category as product_category, pr.description as product_description
    FROM policies p
    LEFT JOIN customers c ON p.customer_id = c.customer_id
    LEFT JOIN products pr ON p.product_id = pr.product_id
    ${whereClause}
    ORDER BY p.created_at DESC
    LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}
  `, [...queryParams, parsedLimit, offset]);

  const countQuery = await db.query(`
    SELECT COUNT(*) as total 
    FROM policies p
    LEFT JOIN customers c ON p.customer_id = c.customer_id
    LEFT JOIN products pr ON p.product_id = pr.product_id
    ${whereClause}
  `, queryParams);

  const total = parseInt(countQuery.rows[0]?.total || '0');
  const formattedPolicies = policiesQuery.rows.map(formatPolicy);

  res.json({
    success: true,
    data: {
      policies: formattedPolicies,
      pagination: {
        page: parseInt(page as string) || 1,
        limit: parsedLimit,
        total,
        pages: Math.ceil(total / parsedLimit) || 1,
        totalPages: Math.ceil(total / parsedLimit) || 1,
      }
    }
  });
}));

// ---------------------------------------------------------------------------
// 4. GET /api/policies/:policyId - Single policy with customer, product & claims
// ---------------------------------------------------------------------------
router.get('/:policyId', requireFeature('policies', 'view'), asyncHandler(async (req: any, res: Response) => {
  const { policyId } = req.params;

  if (!UUID_RE.test(policyId)) {
    throw createError('Invalid policy ID format', 400, 'VALIDATION_ERROR');
  }

  const policyQuery = await db.query(`
    SELECT 
      p.policy_id, p.workspace_id, p.policy_number, p.customer_id, p.product_id,
      p.policy_type, p.status, p.effective_date, p.expiration_date, p.premium_amount,
      p.coverage_amount, p.deductible, p.policy_data, p.created_at, p.updated_at,
      c.first_name as customer_first_name, c.last_name as customer_last_name,
      c.email as customer_email, c.phone as customer_phone,
      c.address as customer_address, c.city as customer_city,
      c.state as customer_state, c.zip_code as customer_zip_code,
      pr.name as product_name, pr.category as product_category, pr.description as product_description
    FROM policies p
    LEFT JOIN customers c ON p.customer_id = c.customer_id
    LEFT JOIN products pr ON p.product_id = pr.product_id
    WHERE p.policy_id = $1 AND p.workspace_id = $2
  `, [policyId, req.workspace_id]);

  if (policyQuery.rows.length === 0) {
    throw createError('Policy not found', 404, 'POLICY_NOT_FOUND');
  }

  // Related claims
  const claimsQuery = await db.query(`
    SELECT claim_id, claim_number, claim_type, status, claimed_amount, incident_date, created_at
    FROM claims
    WHERE policy_id = $1
    ORDER BY created_at DESC
  `, [policyId]);

  // Related billing
  const billingQuery = await db.query(`
    SELECT record_id, transaction_id, amount, status, due_date, paid_date, created_at
    FROM billing_records
    WHERE policy_id = $1
    ORDER BY created_at DESC
  `, [policyId]);

  const policy = formatPolicy(policyQuery.rows[0]);

  res.json({
    success: true,
    data: {
      policy,
      claims: claimsQuery.rows.map((c) => ({
        id: c.claim_id,
        claim_number: c.claim_number,
        type: c.claim_type,
        status: c.status,
        amount: parseFloat(c.claimed_amount) || 0,
        filed_date: c.incident_date ? new Date(c.incident_date).toISOString().split('T')[0] : '',
      })),
      billing: billingQuery.rows.map((b) => ({
        id: b.record_id,
        invoice_number: b.transaction_id || `INV-${b.record_id.substring(0, 8).toUpperCase()}`,
        amount: parseFloat(b.amount) || 0,
        status: b.status,
        due_date: b.due_date ? new Date(b.due_date).toISOString().split('T')[0] : '',
        paid_date: b.paid_date ? new Date(b.paid_date).toISOString().split('T')[0] : undefined,
      }))
    }
  });
}));

// ---------------------------------------------------------------------------
// 5. POST /api/policies - Create new policy
// ---------------------------------------------------------------------------
router.post('/', requireFeature('policies', 'create'), asyncHandler(async (req: any, res: Response) => {
  const body = req.body || {};

  // Support both camelCase and snake_case
  let customerId = body.customerId || body.customer_id;
  let productId = body.productId || body.product_id;
  let policyType = body.policyType || body.policy_type;
  const effectiveDate = body.effectiveDate || body.effective_date;
  const expirationDate = body.expirationDate || body.expiry_date || body.expiration_date;
  const premiumAmount = Number(body.premiumAmount ?? body.premium_amount ?? body.premium);
  const coverageAmount = Number(body.coverageAmount ?? body.coverage_amount ?? body.sum_insured);
  const deductible = Number(body.deductible ?? 0);
  const paymentFrequency = body.paymentFrequency || body.payment_frequency || 'monthly';
  const specialConditions = body.specialConditions || body.special_conditions || '';
  const extraData = body.policyData || body.policy_data || {};

  if (!effectiveDate || !expirationDate || isNaN(premiumAmount) || isNaN(coverageAmount)) {
    throw createError(
      'Missing required fields: effectiveDate, expirationDate, premium, coverageAmount',
      400,
      'VALIDATION_ERROR'
    );
  }

  // Auto-resolve / validate customerId
  if (!customerId || !UUID_RE.test(customerId)) {
    await ensureWorkspaceCustomers(req.workspace_id);
    const firstCust = await db.query(
      'SELECT customer_id FROM customers WHERE workspace_id = $1 ORDER BY created_at ASC LIMIT 1',
      [req.workspace_id]
    );
    if (firstCust.rows.length > 0) {
      customerId = firstCust.rows[0].customer_id;
    } else {
      const newCustId = uuidv4();
      const uniqueEmail = `client.${req.workspace_id.substring(0, 6)}.${Date.now()}@example.com`;
      await db.query(`
        INSERT INTO customers (customer_id, workspace_id, first_name, last_name, email, status)
        VALUES ($1, $2, 'Valued', 'Client', $3, 'ACTIVE')
        ON CONFLICT (email) DO NOTHING
      `, [newCustId, req.workspace_id, uniqueEmail]);
      customerId = newCustId;
    }
  }

  // Auto-resolve / validate productId
  if (!productId || !UUID_RE.test(productId)) {
    await ensureWorkspaceProducts(req.workspace_id);
    const firstProd = await db.query(
      'SELECT product_id, category FROM products WHERE workspace_id = $1 OR workspace_id IS NULL ORDER BY created_at ASC LIMIT 1',
      [req.workspace_id]
    );
    if (firstProd.rows.length > 0) {
      productId = firstProd.rows[0].product_id;
      if (!policyType) policyType = firstProd.rows[0].category || 'Automobile';
    }
  }

  if (!policyType) {
    if (productId && UUID_RE.test(productId)) {
      const pRow = await db.query('SELECT category FROM products WHERE product_id = $1', [productId]);
      if (pRow.rows.length > 0) policyType = pRow.rows[0].category;
    }
    if (!policyType) policyType = 'General';
  }

  const policyId = uuidv4();
  const year = new Date().getFullYear();
  const randNum = Math.floor(100000 + Math.random() * 900000);
  const policyNumber = `POL-${year}-${randNum}`;

  const policyData = {
    ...extraData,
    payment_frequency: paymentFrequency,
    special_conditions: specialConditions,
  };

  await db.query(`
    INSERT INTO policies (
      policy_id, workspace_id, policy_number, customer_id, product_id,
      policy_type, status, effective_date, expiration_date, premium_amount,
      coverage_amount, deductible, policy_data, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW())
  `, [
    policyId,
    req.workspace_id,
    policyNumber,
    customerId,
    productId,
    policyType,
    'active',
    effectiveDate,
    expirationDate,
    premiumAmount,
    coverageAmount,
    deductible,
    JSON.stringify(policyData)
  ]);

  // Fetch newly created policy with joins
  const newPolicyQuery = await db.query(`
    SELECT 
      p.policy_id, p.workspace_id, p.policy_number, p.customer_id, p.product_id,
      p.policy_type, p.status, p.effective_date, p.expiration_date, p.premium_amount,
      p.coverage_amount, p.deductible, p.policy_data, p.created_at, p.updated_at,
      c.first_name as customer_first_name, c.last_name as customer_last_name,
      c.email as customer_email, c.phone as customer_phone,
      c.address as customer_address, c.city as customer_city,
      c.state as customer_state, c.zip_code as customer_zip_code,
      pr.name as product_name, pr.category as product_category, pr.description as product_description
    FROM policies p
    LEFT JOIN customers c ON p.customer_id = c.customer_id
    LEFT JOIN products pr ON p.product_id = pr.product_id
    WHERE p.policy_id = $1
  `, [policyId]);

  const createdPolicy = formatPolicy(newPolicyQuery.rows[0]);

  res.status(201).json({
    success: true,
    data: {
      policy: createdPolicy,
      policyId,
      policyNumber,
      message: 'Policy created successfully'
    }
  });
}));

// ---------------------------------------------------------------------------
// 6. PUT /api/policies/:policyId - Update policy
// ---------------------------------------------------------------------------
router.put('/:policyId', requireFeature('policies', 'update'), asyncHandler(async (req: any, res: Response) => {
  const { policyId } = req.params;

  if (!UUID_RE.test(policyId)) {
    throw createError('Invalid policy ID format', 400, 'VALIDATION_ERROR');
  }

  const updates = req.body || {};

  const allowedFields = [
    'status', 'effective_date', 'expiration_date', 'premium_amount',
    'coverage_amount', 'deductible', 'policy_data'
  ];

  // Map incoming alternate keys
  const mappedUpdates: Record<string, any> = {};
  if (updates.status !== undefined) mappedUpdates.status = updates.status;
  if (updates.effectiveDate || updates.effective_date) mappedUpdates.effective_date = updates.effectiveDate || updates.effective_date;
  if (updates.expirationDate || updates.expiry_date || updates.expiration_date) {
    mappedUpdates.expiration_date = updates.expirationDate || updates.expiry_date || updates.expiration_date;
  }
  if (updates.premium !== undefined || updates.premium_amount !== undefined) {
    mappedUpdates.premium_amount = updates.premium ?? updates.premium_amount;
  }
  if (updates.coverageAmount !== undefined || updates.sum_insured !== undefined || updates.coverage_amount !== undefined) {
    mappedUpdates.coverage_amount = updates.coverageAmount ?? updates.sum_insured ?? updates.coverage_amount;
  }
  if (updates.deductible !== undefined) mappedUpdates.deductible = updates.deductible;
  if (updates.policyData || updates.policy_data) mappedUpdates.policy_data = updates.policyData || updates.policy_data;

  const setClause: string[] = [];
  const queryParams: any[] = [req.workspace_id, policyId];
  let paramCount = 2;

  for (const [field, value] of Object.entries(mappedUpdates)) {
    if (allowedFields.includes(field)) {
      paramCount++;
      setClause.push(`${field} = $${paramCount}`);
      queryParams.push(field === 'policy_data' ? JSON.stringify(value) : value);
    }
  }

  if (setClause.length === 0) {
    throw createError('No valid fields to update', 400, 'VALIDATION_ERROR');
  }

  setClause.push('updated_at = NOW()');

  const updateQuery = await db.query(`
    UPDATE policies 
    SET ${setClause.join(', ')}
    WHERE policy_id = $2 AND workspace_id = $1
  `, queryParams);

  if (updateQuery.rowCount === 0) {
    throw createError('Policy not found', 404, 'POLICY_NOT_FOUND');
  }

  res.json({
    success: true,
    message: 'Policy updated successfully'
  });
}));

// ---------------------------------------------------------------------------
// 7. DELETE /api/policies/:policyId - Delete policy
// ---------------------------------------------------------------------------
router.delete('/:policyId', requireFeature('policies', 'delete'), asyncHandler(async (req: any, res: Response) => {
  const { policyId } = req.params;

  if (!UUID_RE.test(policyId)) {
    throw createError('Invalid policy ID format', 400, 'VALIDATION_ERROR');
  }

  // Ensure policy exists and belongs to the caller's workspace
  const policyCheck = await db.query(
    'SELECT policy_id FROM policies WHERE policy_id = $1 AND workspace_id = $2',
    [policyId, req.workspace_id]
  );

  if (policyCheck.rows.length === 0) {
    throw createError('Policy not found', 404, 'POLICY_NOT_FOUND');
  }

  // Prevent deleting policy if active claims exist
  const claimsCheck = await db.query(
    'SELECT COUNT(*) as count FROM claims WHERE policy_id = $1',
    [policyId]
  );
  if (parseInt(claimsCheck.rows[0]?.count || '0') > 0) {
    throw createError('Cannot delete policy with associated claims', 400, 'POLICY_HAS_CLAIMS');
  }

  // Clean up endorsements if any
  await db.query('DELETE FROM policy_endorsements WHERE policy_id = $1', [policyId]);

  await db.query(
    'DELETE FROM policies WHERE policy_id = $1 AND workspace_id = $2',
    [policyId, req.workspace_id]
  );

  res.json({
    success: true,
    message: 'Policy deleted successfully',
  });
}));

export default router;
