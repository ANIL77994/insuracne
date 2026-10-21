import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../database/connection';
import { authenticateToken, requireRole } from '../middleware/auth';

const router = Router();

// Get all customers
router.get('/customers', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { 
      page = 1, 
      limit = 20, 
      search, 
      status,
      sort_by = 'created_at',
      sort_order = 'DESC'
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);

    let whereClause = 'WHERE workspace_id = $1';
    const queryParams = [req.workspace_id];
    let paramCount = 1;

    if (search) {
      paramCount++;
      whereClause += ` AND (first_name ILIKE $${paramCount} OR last_name ILIKE $${paramCount} OR email ILIKE $${paramCount})`;
      queryParams.push(`%${search}%`);
    }

    if (status) {
      paramCount++;
      whereClause += ` AND status = $${paramCount}`;
      queryParams.push(status);
    }

    const customersQuery = await db.query(`
      SELECT 
        customer_id, first_name, last_name, email, phone, date_of_birth,
        address, city, state, zip_code, status, customer_type,
        lifetime_value, last_contact_date, created_at
      FROM customers 
      ${whereClause}
      ORDER BY ${sort_by} ${sort_order}
      LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}
    `, [...queryParams, parseInt(limit), offset]);

    const countQuery = await db.query(`
      SELECT COUNT(*) as total
      FROM customers 
      ${whereClause}
    `, queryParams);

    res.json({
      success: true,
      data: {
        customers: customersQuery.rows,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: parseInt(countQuery.rows[0].total),
          pages: Math.ceil(parseInt(countQuery.rows[0].total) / parseInt(limit))
        }
      }
    });
  } catch (error) {
    console.error('Error fetching customers:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch customers'
    });
  }
});

// Get customer details
router.get('/customers/:customer_id', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { customer_id } = req.params;

    // Get customer basic info
    const customerQuery = await db.query(`
      SELECT 
        customer_id, first_name, last_name, email, phone, date_of_birth,
        address, city, state, zip_code, status, customer_type,
        lifetime_value, last_contact_date, notes, created_at
      FROM customers 
      WHERE workspace_id = $1 AND customer_id = $2
    `, [req.workspace_id, customer_id]);

    if (customerQuery.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Customer not found'
      });
    }

    // Get customer's policies
    const policiesQuery = await db.query(`
      SELECT 
        policy_id, policy_number, policy_type, status, 
        premium_amount, coverage_amount, effective_date, expiration_date
      FROM policies 
      WHERE workspace_id = $1 AND customer_id = $2
      ORDER BY effective_date DESC
    `, [req.workspace_id, customer_id]);

    // Get customer's claims
    const claimsQuery = await db.query(`
      SELECT 
        claim_id, claim_number, status, claimed_amount, 
        incident_date, created_at
      FROM claims 
      WHERE workspace_id = $1 AND customer_id = $2
      ORDER BY created_at DESC
      LIMIT 10
    `, [req.workspace_id, customer_id]);

    // Get communication history
    const communicationsQuery = await db.query(`
      SELECT 
        communication_id, communication_type, subject, message,
        direction, status, created_at
      FROM communications 
      WHERE workspace_id = $1 AND customer_id = $2
      ORDER BY created_at DESC
      LIMIT 20
    `, [req.workspace_id, customer_id]);

    res.json({
      success: true,
      data: {
        customer: customerQuery.rows[0],
        policies: policiesQuery.rows,
        claims: claimsQuery.rows,
        communications: communicationsQuery.rows
      }
    });
  } catch (error) {
    console.error('Error fetching customer details:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch customer details'
    });
  }
});

// Create new customer
router.post('/customers', authenticateToken, async (req: Request, res: Response) => {
  try {
    const {
      first_name, last_name, email, phone, date_of_birth,
      address, city, state, zip_code, customer_type, notes
    } = req.body;

    const customerId = uuidv4();

    await db.query(`
      INSERT INTO customers (
        customer_id, workspace_id, first_name, last_name, email, phone,
        date_of_birth, address, city, state, zip_code, customer_type,
        status, notes, created_at, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW(), $15)
    `, [
      customerId, req.workspace_id, first_name, last_name, email, phone,
      date_of_birth, address, city, state, zip_code, customer_type,
      'ACTIVE', notes, req.user.id
    ]);

    res.status(201).json({
      success: true,
      data: { customer_id: customerId }
    });
  } catch (error) {
    console.error('Error creating customer:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create customer'
    });
  }
});

// Update customer
router.put('/customers/:customer_id', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { customer_id } = req.params;
    const updateFields = req.body;

    // Build dynamic update query
    const allowedFields = [
      'first_name', 'last_name', 'email', 'phone', 'date_of_birth',
      'address', 'city', 'state', 'zip_code', 'customer_type', 'status', 'notes'
    ];

    const setClause = [];
    const queryParams = [req.workspace_id, customer_id];
    let paramCount = 2;

    for (const [field, value] of Object.entries(updateFields)) {
      if (allowedFields.includes(field)) {
        paramCount++;
        setClause.push(`${field} = $${paramCount}`);
        queryParams.push(value);
      }
    }

    if (setClause.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No valid fields to update'
      });
    }

    setClause.push('updated_at = NOW()');
    setClause.push('updated_by = $1');

    const updateQuery = await db.query(`
      UPDATE customers 
      SET ${setClause.join(', ')}
      WHERE workspace_id = $2 AND customer_id = $3
    `, queryParams);

    if (updateQuery.rowCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'Customer not found'
      });
    }

    res.json({
      success: true,
      message: 'Customer updated successfully'
    });
  } catch (error) {
    console.error('Error updating customer:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update customer'
    });
  }
});

// Get customer communication history
router.get('/customers/:customer_id/communications', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { customer_id } = req.params;
    const { page = 1, limit = 20 } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);

    const communicationsQuery = await db.query(`
      SELECT 
        communication_id, communication_type, subject, message,
        direction, status, created_at, created_by
      FROM communications 
      WHERE workspace_id = $1 AND customer_id = $2
      ORDER BY created_at DESC
      LIMIT $3 OFFSET $4
    `, [req.workspace_id, customer_id, parseInt(limit), offset]);

    res.json({
      success: true,
      data: communicationsQuery.rows
    });
  } catch (error) {
    console.error('Error fetching communications:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch communication history'
    });
  }
});

// Send communication to customer
router.post('/communications', authenticateToken, async (req: Request, res: Response) => {
  try {
    const {
      customer_id, communication_type, subject, message, priority = 'normal'
    } = req.body;

    const communicationId = uuidv4();

    await db.query(`
      INSERT INTO communications (
        communication_id, workspace_id, customer_id, communication_type,
        subject, message, direction, priority, status, created_at, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), $10)
    `, [
      communicationId, req.workspace_id, customer_id, communication_type,
      subject, message, 'OUTBOUND', priority, 'PENDING', req.user.id
    ]);

    // Simulate sending communication
    setTimeout(async () => {
      await db.query(`
        UPDATE communications 
        SET status = 'SENT', sent_at = NOW()
        WHERE communication_id = $1 AND workspace_id = $2
      `, [communicationId, req.workspace_id]);

      // Update customer's last contact date
      await db.query(`
        UPDATE customers 
        SET last_contact_date = NOW()
        WHERE customer_id = $3 AND workspace_id = $2
      `, [customer_id, req.workspace_id]);
    }, 1000);

    res.status(201).json({
      success: true,
      data: { communication_id: communicationId }
    });
  } catch (error) {
    console.error('Error sending communication:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to send communication'
    });
  }
});

// Get CRM dashboard metrics
router.get('/dashboard', authenticateToken, async (req: Request, res: Response) => {
  try {
    // Customer metrics
    const customerMetricsQuery = await db.query(`
      SELECT 
        COUNT(*) as total_customers,
        COUNT(CASE WHEN status = 'ACTIVE' THEN 1 END) as active_customers,
        COUNT(CASE WHEN created_at >= NOW() - INTERVAL '30 days' THEN 1 END) as new_customers_30d,
        COUNT(CASE WHEN last_contact_date <= NOW() - INTERVAL '90 days' THEN 1 END) as inactive_customers
      FROM customers 
      WHERE workspace_id = $1
    `, [req.workspace_id]);

    // Communication metrics
    const communicationMetricsQuery = await db.query(`
      SELECT 
        COUNT(*) as total_communications,
        COUNT(CASE WHEN status = 'SENT' THEN 1 END) as sent_communications,
        COUNT(CASE WHEN communication_type = 'EMAIL' THEN 1 END) as email_count,
        COUNT(CASE WHEN communication_type = 'SMS' THEN 1 END) as sms_count,
        COUNT(CASE WHEN created_at >= NOW() - INTERVAL '30 days' THEN 1 END) as communications_30d
      FROM communications 
      WHERE workspace_id = $1
    `, [req.workspace_id]);

    // Top customers by lifetime value
    const topCustomersQuery = await db.query(`
      SELECT 
        customer_id, first_name, last_name, email, lifetime_value,
        (SELECT COUNT(*) FROM policies WHERE customer_id = c.customer_id) as policy_count
      FROM customers c
      WHERE c.workspace_id = $1 AND c.status = 'ACTIVE'
      ORDER BY c.lifetime_value DESC
      LIMIT 10
    `, [req.workspace_id]);

    // Customer acquisition trends
    const acquisitionTrendsQuery = await db.query(`
      SELECT 
        DATE_TRUNC('month', created_at) as month,
        COUNT(*) as new_customers
      FROM customers 
      WHERE workspace_id = $1 
        AND created_at >= NOW() - INTERVAL '12 months'
      GROUP BY DATE_TRUNC('month', created_at)
      ORDER BY month
    `, [req.workspace_id]);

    res.json({
      success: true,
      data: {
        customers: customerMetricsQuery.rows[0],
        communications: communicationMetricsQuery.rows[0],
        top_customers: topCustomersQuery.rows,
        acquisition_trends: acquisitionTrendsQuery.rows
      }
    });
  } catch (error) {
    console.error('Error fetching CRM dashboard:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch CRM dashboard data'
    });
  }
});

// Get customer segmentation
router.get('/segmentation', authenticateToken, async (req: Request, res: Response) => {
  try {
    const segmentationQuery = await db.query(`
      SELECT 
        customer_type,
        COUNT(*) as count,
        AVG(lifetime_value) as avg_lifetime_value,
        COUNT(CASE WHEN status = 'ACTIVE' THEN 1 END) as active_count
      FROM customers 
      WHERE workspace_id = $1
      GROUP BY customer_type
      ORDER BY count DESC
    `, [req.workspace_id]);

    // Risk-based segmentation
    const riskSegmentationQuery = await db.query(`
      SELECT 
        CASE 
          WHEN lifetime_value > 100000 THEN 'High Value'
          WHEN lifetime_value > 50000 THEN 'Medium Value'
          WHEN lifetime_value > 10000 THEN 'Standard'
          ELSE 'Low Value'
        END as value_segment,
        COUNT(*) as count,
        COUNT(CASE WHEN status = 'ACTIVE' THEN 1 END) as active_count
      FROM customers 
      WHERE workspace_id = $1
      GROUP BY 
        CASE 
          WHEN lifetime_value > 100000 THEN 'High Value'
          WHEN lifetime_value > 50000 THEN 'Medium Value'
          WHEN lifetime_value > 10000 THEN 'Standard'
          ELSE 'Low Value'
        END
      ORDER BY 
        CASE 
          WHEN value_segment = 'High Value' THEN 1
          WHEN value_segment = 'Medium Value' THEN 2
          WHEN value_segment = 'Standard' THEN 3
          ELSE 4
        END
    `, [req.workspace_id]);

    res.json({
      success: true,
      data: {
        by_type: segmentationQuery.rows,
        by_value: riskSegmentationQuery.rows
      }
    });
  } catch (error) {
    console.error('Error fetching customer segmentation:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch customer segmentation data'
    });
  }
});

export default router;