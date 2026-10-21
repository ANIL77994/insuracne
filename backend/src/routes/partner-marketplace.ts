import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../database/connection';
import { authenticateToken, requireRole } from '../middleware/auth';

const router = Router();

// Get marketplace partners
router.get('/partners', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { category, status, integration_type } = req.query;

    let whereClause = 'WHERE workspace_id = $1';
    const queryParams = [req.workspace_id];
    let paramCount = 1;

    if (category) {
      paramCount++;
      whereClause += ` AND category = $${paramCount}`;
      queryParams.push(category);
    }

    if (status) {
      paramCount++;
      whereClause += ` AND status = $${paramCount}`;
      queryParams.push(status);
    }

    if (integration_type) {
      paramCount++;
      whereClause += ` AND integration_type = $${paramCount}`;
      queryParams.push(integration_type);
    }

    const partnersQuery = await db.query(`
      SELECT 
        partner_id, partner_name, category, integration_type,
        api_endpoint, webhook_url, status, rating,
        monthly_volume, commission_rate, contract_start,
        contract_end, created_at
      FROM marketplace_partners 
      ${whereClause}
      ORDER BY created_at DESC
    `, queryParams);

    res.json({
      success: true,
      data: partnersQuery.rows
    });
  } catch (error) {
    console.error('Error fetching marketplace partners:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch marketplace partners'
    });
  }
});

// Create marketplace partner
router.post('/partners', authenticateToken, requireRole(['admin', 'manager']), async (req: Request, res: Response) => {
  try {
    const {
      partner_name, category, integration_type, api_endpoint,
      webhook_url, authentication_config, api_quota,
      commission_structure, contract_terms, contact_info
    } = req.body;

    const partnerId = uuidv4();

    await db.query(`
      INSERT INTO marketplace_partners (
        partner_id, workspace_id, partner_name, category, integration_type,
        api_endpoint, webhook_url, authentication_config, api_quota,
        commission_structure, contract_terms, contact_info, status,
        created_at, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), $14)
    `, [
      partnerId, req.workspace_id, partner_name, category, integration_type,
      api_endpoint, webhook_url, JSON.stringify(authentication_config),
      JSON.stringify(api_quota), JSON.stringify(commission_structure),
      JSON.stringify(contract_terms), JSON.stringify(contact_info), 'PENDING',
      req.user.id
    ]);

    res.status(201).json({
      success: true,
      data: { partner_id: partnerId }
    });
  } catch (error) {
    console.error('Error creating marketplace partner:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create marketplace partner'
    });
  }
});

// Test partner integration
router.post('/partners/:partner_id/test-integration', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { partner_id } = req.params;

    // Get partner configuration
    const partnerQuery = await db.query(`
      SELECT * FROM marketplace_partners 
      WHERE partner_id = $1 AND workspace_id = $2
    `, [partner_id, req.workspace_id]);

    if (partnerQuery.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Partner not found'
      });
    }

    const partner = partnerQuery.rows[0];
    const authConfig = JSON.parse(partner.authentication_config);

    // Simulate API test
    const testResults = {
      connection_status: 'SUCCESS',
      api_endpoint_accessible: true,
      authentication_valid: true,
      rate_limit_status: 'OK',
      response_time_ms: Math.floor(Math.random() * 500) + 100,
      features_tested: [],
      errors: []
    };

    // Test different features based on integration type
    switch (partner.integration_type) {
      case 'PAYMENT_GATEWAY':
        testResults.features_tested = [
          'Payment Processing',
          'Refund Processing',
          'Webhook Validation'
        ];
        break;
      case 'DATA_PROVIDER':
        testResults.features_tested = [
          'Data Retrieval',
          'Real-time Updates',
          'Bulk Data Sync'
        ];
        break;
      case 'CRM_INTEGRATION':
        testResults.features_tested = [
          'Customer Sync',
          'Lead Management',
          'Activity Tracking'
        ];
        break;
      default:
        testResults.features_tested = ['Basic Connectivity'];
    }

    // Save integration test results
    const testId = uuidv4();
    await db.query(`
      INSERT INTO integration_tests (
        test_id, workspace_id, partner_id, test_type,
        test_results, status, tested_at, tested_by
      ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7)
    `, [
      testId, req.workspace_id, partner_id, 'INTEGRATION_TEST',
      JSON.stringify(testResults), testResults.connection_status, req.user.id
    ]);

    // Update partner status based on test results
    let newStatus = 'ACTIVE';
    if (testResults.connection_status !== 'SUCCESS') {
      newStatus = 'FAILED';
    }

    await db.query(`
      UPDATE marketplace_partners 
      SET status = $1, last_tested_at = NOW(), updated_at = NOW()
      WHERE partner_id = $2 AND workspace_id = $3
    `, [newStatus, partner_id, req.workspace_id]);

    res.json({
      success: true,
      data: {
        test_id: testId,
        partner_status: newStatus,
        test_results: testResults
      }
    });
  } catch (error) {
    console.error('Error testing partner integration:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to test partner integration'
    });
  }
});

// Process partner transaction
router.post('/transactions', authenticateToken, async (req: Request, res: Response) => {
  try {
    const {
      partner_id, transaction_type, reference_id,
      amount, currency, metadata, callback_url
    } = req.body;

    // Get partner configuration
    const partnerQuery = await db.query(`
      SELECT * FROM marketplace_partners 
      WHERE partner_id = $1 AND workspace_id = $2 AND status = 'ACTIVE'
    `, [partner_id, req.workspace_id]);

    if (partnerQuery.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Partner not found or inactive'
      });
    }

    const partner = partnerQuery.rows[0];
    const transactionId = uuidv4();

    // Calculate partner commission
    const commissionStructure = JSON.parse(partner.commission_structure);
    let commissionAmount = 0;
    
    if (commissionStructure.type === 'PERCENTAGE') {
      commissionAmount = amount * (commissionStructure.rate / 100);
    } else if (commissionStructure.type === 'FIXED') {
      commissionAmount = commissionStructure.rate;
    }

    // Create transaction record
    await db.query(`
      INSERT INTO partner_transactions (
        transaction_id, workspace_id, partner_id, transaction_type,
        reference_id, amount, currency, commission_amount,
        net_amount, status, metadata, callback_url,
        processed_at, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
    `, [
      transactionId, req.workspace_id, partner_id, transaction_type,
      reference_id, amount, currency, commissionAmount,
      amount - commissionAmount, 'PROCESSING', JSON.stringify(metadata), callback_url
    ]);

    // Simulate partner API call
    setTimeout(async () => {
      try {
        // Simulate partner response
        const partnerResponse = {
          status: 'SUCCESS',
          partner_transaction_id: `PT_${Date.now()}`,
          processed_at: new Date().toISOString(),
          fees: commissionAmount
        };

        // Update transaction with partner response
        await db.query(`
          UPDATE partner_transactions 
          SET status = $1, partner_response = $2, processed_at = NOW()
          WHERE transaction_id = $3 AND workspace_id = $4
        `, [
          partnerResponse.status, JSON.stringify(partnerResponse),
          transactionId, req.workspace_id
        ]);

        // Update partner metrics
        await db.query(`
          UPDATE marketplace_partners 
          SET monthly_volume = monthly_volume + $1, updated_at = NOW()
          WHERE partner_id = $2 AND workspace_id = $3
        `, [amount, partner_id, req.workspace_id]);

      } catch (error) {
        console.error('Error processing partner transaction:', error);
        
        // Update transaction as failed
        await db.query(`
          UPDATE partner_transactions 
          SET status = $1, error_message = $2
          WHERE transaction_id = $3 AND workspace_id = $4
        `, ['FAILED', 'Partner API error', transactionId, req.workspace_id]);
      }
    }, 2000);

    res.status(201).json({
      success: true,
      data: {
        transaction_id: transactionId,
        estimated_processing_time: '2-5 minutes',
        commission_amount: commissionAmount
      }
    });
  } catch (error) {
    console.error('Error processing partner transaction:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process partner transaction'
    });
  }
});

// Get partner transactions
router.get('/transactions', authenticateToken, async (req: Request, res: Response) => {
  try {
    const {
      partner_id, transaction_type, status,
      date_from, date_to, page = 1, limit = 20
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);

    let whereClause = 'WHERE pt.workspace_id = $1';
    const queryParams = [req.workspace_id];
    let paramCount = 1;

    if (partner_id) {
      paramCount++;
      whereClause += ` AND pt.partner_id = $${paramCount}`;
      queryParams.push(partner_id);
    }

    if (transaction_type) {
      paramCount++;
      whereClause += ` AND pt.transaction_type = $${paramCount}`;
      queryParams.push(transaction_type);
    }

    if (status) {
      paramCount++;
      whereClause += ` AND pt.status = $${paramCount}`;
      queryParams.push(status);
    }

    if (date_from) {
      paramCount++;
      whereClause += ` AND pt.created_at >= $${paramCount}`;
      queryParams.push(date_from);
    }

    if (date_to) {
      paramCount++;
      whereClause += ` AND pt.created_at <= $${paramCount}`;
      queryParams.push(date_to);
    }

    const transactionsQuery = await db.query(`
      SELECT 
        pt.transaction_id, pt.transaction_type, pt.reference_id,
        pt.amount, pt.currency, pt.commission_amount, pt.net_amount,
        pt.status, pt.processed_at, pt.created_at,
        mp.partner_name, mp.category as partner_category,
        pt.metadata, pt.partner_response
      FROM partner_transactions pt
      JOIN marketplace_partners mp ON pt.partner_id = mp.partner_id
      ${whereClause}
      ORDER BY pt.created_at DESC
      LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}
    `, [...queryParams, parseInt(limit), offset]);

    const countQuery = await db.query(`
      SELECT COUNT(*) as total
      FROM partner_transactions pt
      ${whereClause}
    `, queryParams);

    res.json({
      success: true,
      data: {
        transactions: transactionsQuery.rows,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: parseInt(countQuery.rows[0].total),
          pages: Math.ceil(parseInt(countQuery.rows[0].total) / parseInt(limit))
        }
      }
    });
  } catch (error) {
    console.error('Error fetching partner transactions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch partner transactions'
    });
  }
});

// Get partner performance metrics
router.get('/partners/:partner_id/metrics', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { partner_id } = req.params;
    const { period = '30' } = req.query; // days

    // Transaction volume and value
    const volumeMetricsQuery = await db.query(`
      SELECT 
        COUNT(*) as total_transactions,
        SUM(amount) as total_value,
        SUM(commission_amount) as total_commission,
        AVG(amount) as avg_transaction_value,
        COUNT(CASE WHEN status = 'SUCCESS' THEN 1 END) as successful_transactions,
        COUNT(CASE WHEN status = 'FAILED' THEN 1 END) as failed_transactions,
        ROUND(
          COUNT(CASE WHEN status = 'SUCCESS' THEN 1 END) * 100.0 / 
          NULLIF(COUNT(*), 0), 2
        ) as success_rate
      FROM partner_transactions 
      WHERE workspace_id = $1 AND partner_id = $2
        AND created_at >= NOW() - INTERVAL '${period} days'
    `, [req.workspace_id, partner_id]);

    // Transaction trends
    const trendsQuery = await db.query(`
      SELECT 
        DATE_TRUNC('day', created_at) as date,
        COUNT(*) as daily_transactions,
        SUM(amount) as daily_value,
        SUM(commission_amount) as daily_commission
      FROM partner_transactions 
      WHERE workspace_id = $1 AND partner_id = $2
        AND created_at >= NOW() - INTERVAL '${period} days'
      GROUP BY DATE_TRUNC('day', created_at)
      ORDER BY date
    `, [req.workspace_id, partner_id]);

    // Response time metrics
    const responseTimeQuery = await db.query(`
      SELECT 
        AVG(EXTRACT(EPOCH FROM (processed_at - created_at))) as avg_processing_time_seconds,
        MIN(EXTRACT(EPOCH FROM (processed_at - created_at))) as min_processing_time_seconds,
        MAX(EXTRACT(EPOCH FROM (processed_at - created_at))) as max_processing_time_seconds
      FROM partner_transactions 
      WHERE workspace_id = $1 AND partner_id = $2
        AND status = 'SUCCESS' AND processed_at IS NOT NULL
        AND created_at >= NOW() - INTERVAL '${period} days'
    `, [req.workspace_id, partner_id]);

    res.json({
      success: true,
      data: {
        period_days: parseInt(period),
        volume_metrics: volumeMetricsQuery.rows[0] || {
          total_transactions: 0,
          total_value: 0,
          total_commission: 0,
          avg_transaction_value: 0,
          successful_transactions: 0,
          failed_transactions: 0,
          success_rate: 0
        },
        transaction_trends: trendsQuery.rows,
        performance_metrics: responseTimeQuery.rows[0] || {
          avg_processing_time_seconds: 0,
          min_processing_time_seconds: 0,
          max_processing_time_seconds: 0
        }
      }
    });
  } catch (error) {
    console.error('Error fetching partner metrics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch partner performance metrics'
    });
  }
});

// Get marketplace dashboard
router.get('/dashboard', authenticateToken, async (req: Request, res: Response) => {
  try {
    // Partner status overview
    const partnerStatusQuery = await db.query(`
      SELECT 
        status,
        COUNT(*) as count,
        AVG(monthly_volume) as avg_monthly_volume,
        AVG(rating) as avg_rating
      FROM marketplace_partners 
      WHERE workspace_id = $1
      GROUP BY status
    `, [req.workspace_id]);

    // Transaction summary
    const transactionSummaryQuery = await db.query(`
      SELECT 
        COUNT(*) as total_transactions,
        SUM(amount) as total_value,
        SUM(commission_amount) as total_commission,
        COUNT(CASE WHEN status = 'SUCCESS' THEN 1 END) as successful_transactions,
        COUNT(CASE WHEN status = 'FAILED' THEN 1 END) as failed_transactions,
        COUNT(CASE WHEN status = 'PROCESSING' THEN 1 END) as processing_transactions
      FROM partner_transactions 
      WHERE workspace_id = $1 AND created_at >= NOW() - INTERVAL '30 days'
    `, [req.workspace_id]);

    // Top performing partners
    const topPartnersQuery = await db.query(`
      SELECT 
        mp.partner_id, mp.partner_name, mp.category,
        COUNT(pt.transaction_id) as transaction_count,
        SUM(pt.amount) as total_volume,
        SUM(pt.commission_amount) as total_commission,
        AVG(pt.amount) as avg_transaction_value
      FROM marketplace_partners mp
      LEFT JOIN partner_transactions pt ON mp.partner_id = pt.partner_id
        AND pt.created_at >= NOW() - INTERVAL '30 days'
      WHERE mp.workspace_id = $1 AND mp.status = 'ACTIVE'
      GROUP BY mp.partner_id, mp.partner_name, mp.category
      ORDER BY total_volume DESC
      LIMIT 10
    `, [req.workspace_id]);

    // Integration health
    const integrationHealthQuery = await db.query(`
      SELECT 
        integration_type,
        COUNT(*) as total_integrations,
        COUNT(CASE WHEN status = 'ACTIVE' THEN 1 END) as active_integrations,
        COUNT(CASE WHEN last_tested_at >= NOW() - INTERVAL '7 days' THEN 1 END) as recently_tested
      FROM marketplace_partners 
      WHERE workspace_id = $1
      GROUP BY integration_type
    `, [req.workspace_id]);

    // Transaction trends
    const transactionTrendsQuery = await db.query(`
      SELECT 
        DATE_TRUNC('week', pt.created_at) as week,
        COUNT(*) as weekly_transactions,
        SUM(pt.amount) as weekly_value,
        SUM(pt.commission_amount) as weekly_commission
      FROM partner_transactions pt
      WHERE pt.workspace_id = $1 
        AND pt.created_at >= NOW() - INTERVAL '12 weeks'
      GROUP BY DATE_TRUNC('week', pt.created_at)
      ORDER BY week
    `, [req.workspace_id]);

    res.json({
      success: true,
      data: {
        partner_status: partnerStatusQuery.rows,
        transaction_summary: transactionSummaryQuery.rows[0] || {
          total_transactions: 0,
          total_value: 0,
          total_commission: 0,
          successful_transactions: 0,
          failed_transactions: 0,
          processing_transactions: 0
        },
        top_partners: topPartnersQuery.rows,
        integration_health: integrationHealthQuery.rows,
        transaction_trends: transactionTrendsQuery.rows
      }
    });
  } catch (error) {
    console.error('Error fetching marketplace dashboard:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch marketplace dashboard data'
    });
  }
});

// Generate partner API keys
router.post('/partners/:partner_id/api-keys', authenticateToken, requireRole(['admin']), async (req: Request, res: Response) => {
  try {
    const { partner_id } = req.params;
    const { key_name, permissions, expiration_date } = req.body;

    // Generate API key
    const apiKey = `mpk_${uuidv4().replace(/-/g, '').substring(0, 32)}`;
    const secretKey = `mps_${uuidv4().replace(/-/g, '').substring(0, 32)}`;

    const keyId = uuidv4();

    await db.query(`
      INSERT INTO partner_api_keys (
        key_id, workspace_id, partner_id, key_name, api_key,
        secret_key, permissions, expiration_date, status,
        created_at, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), $10)
    `, [
      keyId, req.workspace_id, partner_id, key_name, apiKey,
      secretKey, JSON.stringify(permissions), expiration_date, 'ACTIVE',
      req.user.id
    ]);

    res.status(201).json({
      success: true,
      data: {
        key_id: keyId,
        api_key: apiKey,
        secret_key: secretKey,
        permissions: permissions
      }
    });
  } catch (error) {
    console.error('Error generating API key:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate partner API key'
    });
  }
});

export default router;