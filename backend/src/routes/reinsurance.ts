import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../database/connection';
import { authenticateToken, requireRole } from '../middleware/auth';

const router = Router();

// Get reinsurance treaties
router.get('/treaties', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { treaty_type, status, reinsurer } = req.query;

    let whereClause = 'WHERE workspace_id = $1';
    const queryParams = [req.workspace_id];
    let paramCount = 1;

    if (treaty_type) {
      paramCount++;
      whereClause += ` AND treaty_type = $${paramCount}`;
      queryParams.push(treaty_type);
    }

    if (status) {
      paramCount++;
      whereClause += ` AND status = $${paramCount}`;
      queryParams.push(status);
    }

    if (reinsurer) {
      paramCount++;
      whereClause += ` AND reinsurer_name ILIKE $${paramCount}`;
      queryParams.push(`%${reinsurer}%`);
    }

    const treatiesQuery = await db.query(`
      SELECT 
        treaty_id, treaty_name, treaty_type, reinsurer_name,
        quota_share, surplus_share, attachment_point, capacity,
        premium_rate, commission_rate, status, effective_date,
        expiration_date, created_at
      FROM reinsurance_treaties 
      ${whereClause}
      ORDER BY effective_date DESC
    `, queryParams);

    res.json({
      success: true,
      data: treatiesQuery.rows
    });
  } catch (error) {
    console.error('Error fetching reinsurance treaties:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch reinsurance treaties'
    });
  }
});

// Create reinsurance treaty
router.post('/treaties', authenticateToken, requireRole(['admin', 'manager']), async (req: Request, res: Response) => {
  try {
    const {
      treaty_name, treaty_type, reinsurer_name, reinsurer_contact,
      quota_share, surplus_share, attachment_point, capacity,
      premium_rate, commission_rate, coverage_lines, terms_conditions,
      effective_date, expiration_date
    } = req.body;

    const treatyId = uuidv4();

    await db.query(`
      INSERT INTO reinsurance_treaties (
        treaty_id, workspace_id, treaty_name, treaty_type, reinsurer_name,
        reinsurer_contact, quota_share, surplus_share, attachment_point,
        capacity, premium_rate, commission_rate, coverage_lines,
        terms_conditions, status, effective_date, expiration_date,
        created_at, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NOW(), $18)
    `, [
      treatyId, req.workspace_id, treaty_name, treaty_type, reinsurer_name,
      reinsurer_contact, quota_share, surplus_share, attachment_point,
      capacity, premium_rate, commission_rate, JSON.stringify(coverage_lines),
      terms_conditions, 'ACTIVE', effective_date, expiration_date, req.user.id
    ]);

    res.status(201).json({
      success: true,
      data: { treaty_id: treatyId }
    });
  } catch (error) {
    console.error('Error creating reinsurance treaty:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create reinsurance treaty'
    });
  }
});

// Calculate reinsurance cession
router.post('/calculate-cession', authenticateToken, async (req: Request, res: Response) => {
  try {
    const {
      policy_id, policy_amount, premium_amount, 
      risk_factors, treaty_id
    } = req.body;

    // Get applicable treaties
    let treatiesQuery;
    if (treaty_id) {
      treatiesQuery = await db.query(`
        SELECT * FROM reinsurance_treaties 
        WHERE treaty_id = $1 AND workspace_id = $2 AND status = 'ACTIVE'
      `, [treaty_id, req.workspace_id]);
    } else {
      treatiesQuery = await db.query(`
        SELECT * FROM reinsurance_treaties 
        WHERE workspace_id = $1 AND status = 'ACTIVE'
          AND effective_date <= NOW() AND expiration_date >= NOW()
      `, [req.workspace_id]);
    }

    if (treatiesQuery.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No active reinsurance treaties found'
      });
    }

    const treaty = treatiesQuery.rows[0];
    const cessions = [];

    // Calculate quota share cession
    if (treaty.quota_share > 0) {
      const quotaShareCession = policy_amount * (treaty.quota_share / 100);
      const quotaSharePremium = premium_amount * (treaty.quota_share / 100);
      
      cessions.push({
        treaty_id: treaty.treaty_id,
        treaty_name: treaty.treaty_name,
        cession_type: 'QUOTA_SHARE',
        ceded_amount: quotaShareCession,
        ceded_premium: quotaSharePremium,
        commission_rate: treaty.commission_rate,
        commission_amount: quotaSharePremium * (treaty.commission_rate / 100),
        net_ceded_premium: quotaSharePremium * (1 - treaty.commission_rate / 100)
      });
    }

    // Calculate surplus share cession (if applicable)
    if (treaty.surplus_share > 0 && policy_amount > treaty.attachment_point) {
      const excessAmount = policy_amount - treaty.attachment_point;
      const surplusShareCession = excessAmount * (treaty.surplus_share / 100);
      const surplusSharePremium = premium_amount * (surplusShareCession / policy_amount);
      
      cessions.push({
        treaty_id: treaty.treaty_id,
        treaty_name: treaty.treaty_name,
        cession_type: 'SURPLUS_SHARE',
        ceded_amount: surplusShareCession,
        ceded_premium: surplusSharePremium,
        attachment_point: treaty.attachment_point,
        commission_rate: treaty.commission_rate,
        commission_amount: surplusSharePremium * (treaty.commission_rate / 100),
        net_ceded_premium: surplusSharePremium * (1 - treaty.commission_rate / 100)
      });
    }

    // Save cession records
    const cessionRecords = [];
    for (const cession of cessions) {
      const cessionId = uuidv4();
      
      await db.query(`
        INSERT INTO reinsurance_cessions (
          cession_id, workspace_id, policy_id, treaty_id,
          cession_type, ceded_amount, ceded_premium,
          commission_rate, commission_amount, net_ceded_premium,
          calculated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
      `, [
        cessionId, req.workspace_id, policy_id, treaty.treaty_id,
        cession.cession_type, cession.ceded_amount, cession.ceded_premium,
        cession.commission_rate, cession.commission_amount, cession.net_ceded_premium
      ]);

      cessionRecords.push({ ...cession, cession_id: cessionId });
    }

    // Calculate totals
    const totalCededAmount = cessions.reduce((sum, c) => sum + c.ceded_amount, 0);
    const totalCededPremium = cessions.reduce((sum, c) => sum + c.ceded_premium, 0);
    const totalCommission = cessions.reduce((sum, c) => sum + c.commission_amount, 0);
    const totalNetCededPremium = cessions.reduce((sum, c) => sum + c.net_ceded_premium, 0);

    res.json({
      success: true,
      data: {
        policy_id,
        total_ceded_amount: totalCededAmount,
        total_ceded_premium: totalCededPremium,
        total_commission: totalCommission,
        total_net_ceded_premium: totalNetCededPremium,
        retention_amount: policy_amount - totalCededAmount,
        retention_percentage: ((policy_amount - totalCededAmount) / policy_amount) * 100,
        cessions: cessionRecords
      }
    });
  } catch (error) {
    console.error('Error calculating reinsurance cession:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to calculate reinsurance cession'
    });
  }
});

// Get reinsurance cessions
router.get('/cessions', authenticateToken, async (req: Request, res: Response) => {
  try {
    const {
      policy_id, treaty_id, date_from, date_to,
      page = 1, limit = 20
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);

    let whereClause = 'WHERE rc.workspace_id = $1';
    const queryParams = [req.workspace_id];
    let paramCount = 1;

    if (policy_id) {
      paramCount++;
      whereClause += ` AND rc.policy_id = $${paramCount}`;
      queryParams.push(policy_id);
    }

    if (treaty_id) {
      paramCount++;
      whereClause += ` AND rc.treaty_id = $${paramCount}`;
      queryParams.push(treaty_id);
    }

    if (date_from) {
      paramCount++;
      whereClause += ` AND rc.calculated_at >= $${paramCount}`;
      queryParams.push(date_from);
    }

    if (date_to) {
      paramCount++;
      whereClause += ` AND rc.calculated_at <= $${paramCount}`;
      queryParams.push(date_to);
    }

    const cessionsQuery = await db.query(`
      SELECT 
        rc.cession_id, rc.cession_type, rc.ceded_amount, rc.ceded_premium,
        rc.commission_rate, rc.commission_amount, rc.net_ceded_premium,
        rc.calculated_at, rt.treaty_name, rt.reinsurer_name,
        p.policy_number, p.policy_type
      FROM reinsurance_cessions rc
      JOIN reinsurance_treaties rt ON rc.treaty_id = rt.treaty_id
      JOIN policies p ON rc.policy_id = p.policy_id
      ${whereClause}
      ORDER BY rc.calculated_at DESC
      LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}
    `, [...queryParams, parseInt(limit), offset]);

    const countQuery = await db.query(`
      SELECT COUNT(*) as total
      FROM reinsurance_cessions rc
      ${whereClause}
    `, queryParams);

    res.json({
      success: true,
      data: {
        cessions: cessionsQuery.rows,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: parseInt(countQuery.rows[0].total),
          pages: Math.ceil(parseInt(countQuery.rows[0].total) / parseInt(limit))
        }
      }
    });
  } catch (error) {
    console.error('Error fetching reinsurance cessions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch reinsurance cessions'
    });
  }
});

// Process reinsurance claim
router.post('/claims', authenticateToken, async (req: Request, res: Response) => {
  try {
    const {
      original_claim_id, treaty_id, claim_amount, 
      recovery_amount, recovery_percentage, notes
    } = req.body;

    // Verify treaty and calculate recovery
    const treatyQuery = await db.query(`
      SELECT * FROM reinsurance_treaties 
      WHERE treaty_id = $1 AND workspace_id = $2
    `, [treaty_id, req.workspace_id]);

    if (treatyQuery.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Reinsurance treaty not found'
      });
    }

    const treaty = treatyQuery.rows[0];

    // Calculate actual recovery based on treaty terms
    let calculatedRecovery = 0;
    if (recovery_percentage) {
      calculatedRecovery = claim_amount * (recovery_percentage / 100);
    } else {
      // Default to treaty quota share percentage
      calculatedRecovery = claim_amount * (treaty.quota_share / 100);
    }

    const recoveryId = uuidv4();

    await db.query(`
      INSERT INTO reinsurance_recoveries (
        recovery_id, workspace_id, original_claim_id, treaty_id,
        claim_amount, recovery_amount, recovery_percentage,
        recovery_rate, status, notes, processed_at, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
    `, [
      recoveryId, req.workspace_id, original_claim_id, treaty_id,
      claim_amount, calculatedRecovery, recovery_percentage || treaty.quota_share,
      calculatedRecovery / claim_amount, 'PENDING', notes
    ]);

    res.status(201).json({
      success: true,
      data: { 
        recovery_id: recoveryId,
        recovery_amount: calculatedRecovery,
        recovery_rate: calculatedRecovery / claim_amount
      }
    });
  } catch (error) {
    console.error('Error processing reinsurance claim:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process reinsurance claim'
    });
  }
});

// Get reinsurance recoveries
router.get('/recoveries', authenticateToken, async (req: Request, res: Response) => {
  try {
    const {
      treaty_id, status, date_from, date_to,
      page = 1, limit = 20
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);

    let whereClause = 'WHERE rr.workspace_id = $1';
    const queryParams = [req.workspace_id];
    let paramCount = 1;

    if (treaty_id) {
      paramCount++;
      whereClause += ` AND rr.treaty_id = $${paramCount}`;
      queryParams.push(treaty_id);
    }

    if (status) {
      paramCount++;
      whereClause += ` AND rr.status = $${paramCount}`;
      queryParams.push(status);
    }

    if (date_from) {
      paramCount++;
      whereClause += ` AND rr.processed_at >= $${paramCount}`;
      queryParams.push(date_from);
    }

    if (date_to) {
      paramCount++;
      whereClause += ` AND rr.processed_at <= $${paramCount}`;
      queryParams.push(date_to);
    }

    const recoveriesQuery = await db.query(`
      SELECT 
        rr.recovery_id, rr.claim_amount, rr.recovery_amount,
        rr.recovery_percentage, rr.recovery_rate, rr.status,
        rr.processed_at, rr.notes, rt.treaty_name, rt.reinsurer_name,
        c.claim_number, c.claimant_name
      FROM reinsurance_recoveries rr
      JOIN reinsurance_treaties rt ON rr.treaty_id = rt.treaty_id
      JOIN claims c ON rr.original_claim_id = c.claim_id
      ${whereClause}
      ORDER BY rr.processed_at DESC
      LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}
    `, [...queryParams, parseInt(limit), offset]);

    const countQuery = await db.query(`
      SELECT COUNT(*) as total
      FROM reinsurance_recoveries rr
      ${whereClause}
    `, queryParams);

    res.json({
      success: true,
      data: {
        recoveries: recoveriesQuery.rows,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: parseInt(countQuery.rows[0].total),
          pages: Math.ceil(parseInt(countQuery.rows[0].total) / parseInt(limit))
        }
      }
    });
  } catch (error) {
    console.error('Error fetching reinsurance recoveries:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch reinsurance recoveries'
    });
  }
});

// Get reinsurance dashboard
router.get('/dashboard', authenticateToken, async (req: Request, res: Response) => {
  try {
    // Treaty utilization
    const treatyUtilizationQuery = await db.query(`
      SELECT 
        rt.treaty_name, rt.capacity, rt.quota_share, rt.surplus_share,
        COALESCE(SUM(rc.ceded_amount), 0) as total_ceded,
        ROUND((COALESCE(SUM(rc.ceded_amount), 0) / rt.capacity) * 100, 2) as utilization_percentage
      FROM reinsurance_treaties rt
      LEFT JOIN reinsurance_cessions rc ON rt.treaty_id = rc.treaty_id
      WHERE rt.workspace_id = $1 AND rt.status = 'ACTIVE'
        AND (rc.calculated_at >= NOW() - INTERVAL '365 days' OR rc.calculated_at IS NULL)
      GROUP BY rt.treaty_id, rt.treaty_name, rt.capacity, rt.quota_share, rt.surplus_share
      ORDER BY utilization_percentage DESC
    `, [req.workspace_id]);

    // Recovery summary
    const recoverySummaryQuery = await db.query(`
      SELECT 
        COUNT(*) as total_recoveries,
        SUM(claim_amount) as total_claims,
        SUM(recovery_amount) as total_recoveries_amount,
        AVG(recovery_rate) as avg_recovery_rate,
        COUNT(CASE WHEN status = 'PAID' THEN 1 END) as paid_recoveries,
        COUNT(CASE WHEN status = 'PENDING' THEN 1 END) as pending_recoveries
      FROM reinsurance_recoveries 
      WHERE workspace_id = $1 AND processed_at >= NOW() - INTERVAL '365 days'
    `, [req.workspace_id]);

    // Top reinsurers by volume
    const topReinsurersQuery = await db.query(`
      SELECT 
        rt.reinsurer_name,
        COUNT(rc.cession_id) as total_cessions,
        SUM(rc.ceded_amount) as total_ceded_amount,
        SUM(rc.ceded_premium) as total_ceded_premium,
        SUM(rc.commission_amount) as total_commission
      FROM reinsurance_treaties rt
      JOIN reinsurance_cessions rc ON rt.treaty_id = rc.treaty_id
      WHERE rt.workspace_id = $1
        AND rc.calculated_at >= NOW() - INTERVAL '365 days'
      GROUP BY rt.reinsurer_name
      ORDER BY total_ceded_amount DESC
      LIMIT 10
    `, [req.workspace_id]);

    // Monthly cession trends
    const cessionTrendsQuery = await db.query(`
      SELECT 
        DATE_TRUNC('month', rc.calculated_at) as month,
        SUM(rc.ceded_amount) as total_ceded,
        SUM(rc.ceded_premium) as total_premium,
        COUNT(rc.cession_id) as cession_count
      FROM reinsurance_cessions rc
      WHERE rc.workspace_id = $1 
        AND rc.calculated_at >= NOW() - INTERVAL '12 months'
      GROUP BY DATE_TRUNC('month', rc.calculated_at)
      ORDER BY month
    `, [req.workspace_id]);

    res.json({
      success: true,
      data: {
        treaty_utilization: treatyUtilizationQuery.rows,
        recovery_summary: recoverySummaryQuery.rows[0] || {
          total_recoveries: 0,
          total_claims: 0,
          total_recoveries_amount: 0,
          avg_recovery_rate: 0,
          paid_recoveries: 0,
          pending_recoveries: 0
        },
        top_reinsurers: topReinsurersQuery.rows,
        cession_trends: cessionTrendsQuery.rows
      }
    });
  } catch (error) {
    console.error('Error fetching reinsurance dashboard:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch reinsurance dashboard data'
    });
  }
});

// Generate facultative reinsurance quote
router.post('/facultative-quote', authenticateToken, async (req: Request, res: Response) => {
  try {
    const {
      policy_type, coverage_amount, risk_details,
      reinsurer_preference, special_conditions
    } = req.body;

    const quoteId = uuidv4();

    // Simulate facultative reinsurance quote calculation
    const baseRate = 0.15; // 15% base rate
    const riskAdjustment = calculateRiskAdjustment(risk_details);
    const adjustedRate = baseRate * (1 + riskAdjustment);

    const quotedAmount = coverage_amount * adjustedRate;
    const commissionRate = 0.35; // 35% commission

    const quote = {
      quote_id: quoteId,
      quoted_rate: adjustedRate,
      quoted_amount: quotedAmount,
      commission_rate: commissionRate,
      commission_amount: quotedAmount * commissionRate,
      net_cost: quotedAmount * (1 - commissionRate),
      validity_period: '30 days',
      terms_conditions: {
        attachment_point: coverage_amount * 0.5,
        maximum_coverage: coverage_amount * 0.8,
        exclusions: [
          'War and terrorism',
          'Nuclear risks',
          'Pollution (unless specifically covered)'
        ]
      },
      reinsurer_terms: {
        payment_terms: 'Net 30 days',
        minimum_premium: 10000,
        maximum_premium: coverage_amount * 0.25
      }
    };

    // Store facultative quote
    await db.query(`
      INSERT INTO facultative_quotes (
        quote_id, workspace_id, policy_type, coverage_amount,
        quoted_rate, quoted_amount, commission_rate, commission_amount,
        net_cost, risk_details, special_conditions, status,
        validity_period, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
    `, [
      quoteId, req.workspace_id, policy_type, coverage_amount,
      adjustedRate, quotedAmount, commissionRate, quotedAmount * commissionRate,
      quotedAmount * (1 - commissionRate), JSON.stringify(risk_details),
      JSON.stringify(special_conditions), 'QUOTED', '30 days'
    ]);

    res.json({
      success: true,
      data: quote
    });
  } catch (error) {
    console.error('Error generating facultative quote:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate facultative reinsurance quote'
    });
  }
});

// Helper function to calculate risk adjustment
function calculateRiskAdjustment(riskDetails) {
  let adjustment = 0;

  if (riskDetails.industry_type === 'construction') adjustment += 0.2;
  if (riskDetails.claim_history > 3) adjustment += 0.15;
  if (riskDetails.coverage_amount > 10000000) adjustment += 0.1;
  if (riskDetails.geographic_risk === 'high') adjustment += 0.25;

  return adjustment;
}

export default router;