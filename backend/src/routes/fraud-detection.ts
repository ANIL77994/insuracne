import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../database/connection';
import { authenticateToken, requireRole } from '../middleware/auth';

const router = Router();

// Fraud detection analysis for claims
router.post('/analyze-claim', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { claim_id, claimant_data, incident_data } = req.body;

    // Get recent claims for the same claimant
    const recentClaimsQuery = await db.query(`
      SELECT claim_id, incident_date, claimed_amount, claim_type, status
      FROM claims 
      WHERE claimant_id = $1 
        AND incident_date >= NOW() - INTERVAL '365 days'
        AND workspace_id = $2
      ORDER BY incident_date DESC
    `, [claimant_data.claimant_id, req.workspace_id]);

    const recentClaims = recentClaimsQuery.rows;

    // Fraud risk analysis
    let fraudScore = 0;
    const riskFactors = [];
    const alerts = [];

    // Pattern 1: Multiple claims within short time period
    if (recentClaims.length >= 3) {
      fraudScore += 25;
      riskFactors.push('Multiple recent claims');
      alerts.push('Claimant has filed multiple claims in the past year');
    }

    // Pattern 2: Claims pattern similarity
    const similarClaims = recentClaims.filter(claim => 
      claim.claim_type === incident_data.claim_type
    );
    if (similarClaims.length >= 2) {
      fraudScore += 20;
      riskFactors.push('Similar claim types');
      alerts.push('Similar type of claim filed before');
    }

    // Pattern 3: High claim amount compared to policy limits
    if (incident_data.claimed_amount > claimant_data.coverage_limit * 0.8) {
      fraudScore += 15;
      riskFactors.push('High claim amount');
      alerts.push('Claim amount is close to policy limit');
    }

    // Pattern 4: Weekend/holiday incidents
    const incidentDate = new Date(incident_data.incident_date);
    const dayOfWeek = incidentDate.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      fraudScore += 10;
      riskFactors.push('Weekend incident');
      alerts.push('Incident occurred on weekend');
    }

    // Pattern 5: Delayed reporting
    const daysDiff = Math.floor((Date.now() - incidentDate.getTime()) / (1000 * 60 * 60 * 24));
    if (daysDiff > 30) {
      fraudScore += 20;
      riskFactors.push('Delayed reporting');
      alerts.push(`Incident reported ${daysDiff} days after occurrence`);
    }

    // Pattern 6: Large claim amount with minimal documentation
    if (incident_data.claimed_amount > 50000 && (!incident_data.photos || incident_data.photos.length < 3)) {
      fraudScore += 15;
      riskFactors.push('Insufficient documentation');
      alerts.push('Large claim with minimal supporting documentation');
    }

    // Pattern 7: Multiple claimants on same policy
    if (claimant_data.policy_holders && claimant_data.policy_holders.length > 1) {
      const otherClaims = recentClaims.filter(claim => 
        claim.claimant_id !== claimant_data.claimant_id
      );
      if (otherClaims.length > 0) {
        fraudScore += 20;
        riskFactors.push('Multiple claimants on policy');
        alerts.push('Other claims filed by different policy holders');
      }
    }

    // Determine fraud risk level
    let fraudRiskLevel = 'LOW';
    if (fraudScore >= 70) fraudRiskLevel = 'HIGH';
    else if (fraudScore >= 40) fraudRiskLevel = 'MEDIUM';

    // Generate recommendations
    const recommendations = [];
    if (fraudScore >= 70) {
      recommendations.push('Conduct thorough investigation');
      recommendations.push('Request additional documentation');
      recommendations.push('Consider surveillance if appropriate');
    } else if (fraudScore >= 40) {
      recommendations.push('Review supporting documents carefully');
      recommendations.push('Verify incident details');
    }

    // Save fraud analysis
    const analysisId = uuidv4();
    await db.query(`
      INSERT INTO fraud_analysis (
        analysis_id, workspace_id, claim_id, fraud_score, risk_level,
        risk_factors, alerts, recommendations, analysis_date
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
    `, [
      analysisId, req.workspace_id, claim_id, fraudScore, fraudRiskLevel,
      JSON.stringify(riskFactors), JSON.stringify(alerts), JSON.stringify(recommendations)
    ]);

    // Update claim with fraud flags if high risk
    if (fraudRiskLevel === 'HIGH') {
      await db.query(`
        UPDATE claims 
        SET fraud_flags = fraud_flags || $1::jsonb,
            risk_level = $2,
            requires_investigation = true
        WHERE claim_id = $3 AND workspace_id = $4
      `, [
        JSON.stringify({ high_risk: true, analysis_id: analysisId }),
        fraudRiskLevel,
        claim_id,
        req.workspace_id
      ]);
    }

    res.json({
      success: true,
      data: {
        analysis_id: analysisId,
        fraud_score: fraudScore,
        risk_level: fraudRiskLevel,
        risk_factors: riskFactors,
        alerts: alerts,
        recommendations: recommendations,
        requires_investigation: fraudRiskLevel === 'HIGH'
      }
    });

  } catch (error) {
    console.error('Error in fraud analysis:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to perform fraud analysis'
    });
  }
});

// Get fraud analysis for claim
router.get('/analysis/:claim_id', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { claim_id } = req.params;

    const result = await db.query(`
      SELECT 
        analysis_id,
        fraud_score,
        risk_level,
        risk_factors,
        alerts,
        recommendations,
        analysis_date
      FROM fraud_analysis 
      WHERE workspace_id = $1 AND claim_id = $2
      ORDER BY analysis_date DESC
      LIMIT 1
    `, [req.workspace_id, claim_id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No fraud analysis found for this claim'
      });
    }

    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error fetching fraud analysis:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch fraud analysis'
    });
  }
});

// Get fraud dashboard data
router.get('/dashboard', authenticateToken, requireRole(['admin', 'manager']), async (req: Request, res: Response) => {
  try {
    // High risk claims count
    const highRiskQuery = await db.query(`
      SELECT COUNT(*) as count
      FROM fraud_analysis 
      WHERE workspace_id = $1 AND risk_level = 'HIGH'
    `, [req.workspace_id]);

    // Fraud trends by month
    const trendsQuery = await db.query(`
      SELECT 
        DATE_TRUNC('month', analysis_date) as month,
        COUNT(*) as total_cases,
        COUNT(CASE WHEN risk_level = 'HIGH' THEN 1 END) as high_risk,
        COUNT(CASE WHEN risk_level = 'MEDIUM' THEN 1 END) as medium_risk,
        AVG(fraud_score) as avg_score
      FROM fraud_analysis 
      WHERE workspace_id = $1 
        AND analysis_date >= NOW() - INTERVAL '12 months'
      GROUP BY DATE_TRUNC('month', analysis_date)
      ORDER BY month DESC
    `, [req.workspace_id]);

    // Top fraud risk factors
    const riskFactorsQuery = await db.query(`
      SELECT 
        jsonb_array_elements_text(risk_factors) as factor,
        COUNT(*) as frequency
      FROM fraud_analysis 
      WHERE workspace_id = $1 AND risk_level IN ('MEDIUM', 'HIGH')
      GROUP BY factor
      ORDER BY frequency DESC
      LIMIT 10
    `, [req.workspace_id]);

    // Recent investigations
    const investigationsQuery = await db.query(`
      SELECT 
        fa.analysis_id,
        fa.fraud_score,
        fa.risk_level,
        c.claim_id,
        c.claimant_name,
        c.incident_date,
        c.claimed_amount,
        fa.alerts
      FROM fraud_analysis fa
      JOIN claims c ON fa.claim_id = c.claim_id
      WHERE fa.workspace_id = $1 
        AND fa.risk_level IN ('HIGH', 'MEDIUM')
      ORDER BY fa.analysis_date DESC
      LIMIT 10
    `, [req.workspace_id]);

    res.json({
      success: true,
      data: {
        summary: {
          high_risk_cases: parseInt(highRiskQuery.rows[0].count)
        },
        trends: trendsQuery.rows,
        risk_factors: riskFactorsQuery.rows,
        recent_investigations: investigationsQuery.rows
      }
    });
  } catch (error) {
    console.error('Error fetching fraud dashboard:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch fraud dashboard data'
    });
  }
});

// Investigate fraud case
router.post('/investigate/:analysis_id', authenticateToken, requireRole(['admin', 'manager']), async (req: Request, res: Response) => {
  try {
    const { analysis_id } = req.params;
    const { investigation_notes, assigned_investigator, status } = req.body;

    // Create investigation record
    const investigationId = uuidv4();
    await db.query(`
      INSERT INTO fraud_investigations (
        investigation_id, workspace_id, analysis_id, investigator_id,
        status, notes, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
    `, [
      investigationId, req.workspace_id, analysis_id, req.user.id,
      status || 'OPEN', investigation_notes
    ]);

    // Update fraud analysis with investigation info
    await db.query(`
      UPDATE fraud_analysis 
      SET investigation_id = $1,
          investigation_status = $2,
          investigator_assigned = $3
      WHERE analysis_id = $4 AND workspace_id = $5
    `, [
      investigationId, status || 'OPEN', assigned_investigator || req.user.id,
      analysis_id, req.workspace_id
    ]);

    res.json({
      success: true,
      data: { investigation_id: investigationId }
    });
  } catch (error) {
    console.error('Error creating fraud investigation:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create fraud investigation'
    });
  }
});

// Get fraud statistics
router.get('/statistics', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { period = '30' } = req.query; // days

    const statsQuery = await db.query(`
      SELECT 
        COUNT(*) as total_analyses,
        COUNT(CASE WHEN risk_level = 'HIGH' THEN 1 END) as high_risk_count,
        COUNT(CASE WHEN risk_level = 'MEDIUM' THEN 1 END) as medium_risk_count,
        COUNT(CASE WHEN risk_level = 'LOW' THEN 1 END) as low_risk_count,
        AVG(fraud_score) as average_score,
        MAX(fraud_score) as max_score
      FROM fraud_analysis 
      WHERE workspace_id = $1 
        AND analysis_date >= NOW() - INTERVAL '${period} days'
    `, [req.workspace_id]);

    res.json({
      success: true,
      data: {
        period_days: parseInt(period),
        total_analyses: parseInt(statsQuery.rows[0].total_analyses),
        risk_distribution: {
          high: parseInt(statsQuery.rows[0].high_risk_count),
          medium: parseInt(statsQuery.rows[0].medium_risk_count),
          low: parseInt(statsQuery.rows[0].low_risk_count)
        },
        average_score: parseFloat(statsQuery.rows[0].average_score) || 0,
        max_score: parseInt(statsQuery.rows[0].max_score) || 0
      }
    });
  } catch (error) {
    console.error('Error fetching fraud statistics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch fraud statistics'
    });
  }
});

export default router;