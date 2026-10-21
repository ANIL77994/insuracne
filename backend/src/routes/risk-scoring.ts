import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../database/connection';
import { authenticateToken, requireRole } from '../middleware/auth';
import { validateRequest } from '../middleware/validation';

const router = Router();

// Get risk scoring models
router.get('/models', authenticateToken, async (req: Request, res: Response) => {
  try {
    const result = await db.query(`
      SELECT 
        model_id,
        name,
        version,
        description,
        model_type,
        risk_factors,
        thresholds,
        accuracy_score,
        created_at,
        is_active
      FROM risk_scoring_models 
      WHERE workspace_id = $1 AND is_active = true
      ORDER BY created_at DESC
    `, [req.workspace_id]);

    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('Error fetching risk models:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch risk models'
    });
  }
});

// Calculate risk score for applicant
router.post('/calculate', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { 
      applicant_id, 
      policy_type, 
      coverage_amount, 
      risk_factors,
      model_id 
    } = req.body;

    // Get risk scoring model
    const modelQuery = await db.query(`
      SELECT model_id, risk_factors, thresholds, model_config
      FROM risk_scoring_models 
      WHERE model_id = $1 AND workspace_id = $2 AND is_active = true
    `, [model_id, req.workspace_id]);

    if (modelQuery.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Risk scoring model not found'
      });
    }

    const model = modelQuery.rows[0];
    const riskFactors = model.risk_factors;
    const thresholds = model.thresholds;

    // Calculate base risk score
    let baseScore = 0;
    const factorScores = {};

    // Age factor
    if (riskFactors.includes('age') && risk_factors.age) {
      const age = risk_factors.age;
      if (age < 25) factorScores.age = 85;
      else if (age < 35) factorScores.age = 70;
      else if (age < 50) factorScores.age = 55;
      else if (age < 65) factorScores.age = 70;
      else factorScores.age = 90;
    }

    // Credit score factor
    if (riskFactors.includes('credit_score') && risk_factors.credit_score) {
      const credit = risk_factors.credit_score;
      if (credit >= 800) factorScores.credit_score = 20;
      else if (credit >= 740) factorScores.credit_score = 30;
      else if (credit >= 670) factorScores.credit_score = 50;
      else if (credit >= 580) factorScores.credit_score = 75;
      else factorScores.credit_score = 90;
    }

    // Location factor
    if (riskFactors.includes('location') && risk_factors.location) {
      const zip = risk_factors.location;
      const highRiskZipCodes = ['90210', '10001', '60601']; // Sample high-risk areas
      factorScores.location = highRiskZipCodes.includes(zip) ? 85 : 40;
    }

    // Claims history
    if (riskFactors.includes('claims_history') && risk_factors.claims_count !== undefined) {
      const claimsCount = risk_factors.claims_count;
      factorScores.claims_history = Math.min(claimsCount * 15, 90);
    }

    // Calculate weighted average
    const weights = { age: 0.25, credit_score: 0.30, location: 0.20, claims_history: 0.25 };
    baseScore = Object.keys(factorScores).reduce((sum, factor) => {
      return sum + (factorScores[factor] * (weights[factor] || 0.2));
    }, 0);

    // Apply coverage amount adjustment
    const coverageMultiplier = Math.min(coverage_amount / 100000, 2);
    const finalScore = Math.round(baseScore * coverageMultiplier);

    // Determine risk category
    let riskCategory = 'LOW';
    if (finalScore >= thresholds.high_risk) riskCategory = 'HIGH';
    else if (finalScore >= thresholds.medium_risk) riskCategory = 'MEDIUM';

    // Generate recommendations
    const recommendations = [];
    if (finalScore >= thresholds.high_risk) {
      recommendations.push('Require additional documentation');
      recommendations.push('Consider premium adjustment');
    }
    if (risk_factors.claims_count > 2) {
      recommendations.push('Review claims history in detail');
    }

    // Save scoring record
    const scoringId = uuidv4();
    await db.query(`
      INSERT INTO risk_scores (
        scoring_id, workspace_id, applicant_id, policy_type,
        base_score, final_score, risk_category, factor_scores,
        recommendations, model_used, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
    `, [
      scoringId, req.workspace_id, applicant_id, policy_type,
      Math.round(baseScore), finalScore, riskCategory,
      JSON.stringify(factorScores), JSON.stringify(recommendations),
      model_id
    ]);

    res.json({
      success: true,
      data: {
        scoring_id: scoringId,
        final_score: finalScore,
        risk_category: riskCategory,
        factor_scores: factorScores,
        recommendations,
        confidence_level: model.accuracy_score || 0.85
      }
    });

  } catch (error) {
    console.error('Error calculating risk score:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to calculate risk score'
    });
  }
});

// Get risk score history
router.get('/scores/:applicant_id', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { applicant_id } = req.params;

    const result = await db.query(`
      SELECT 
        scoring_id,
        policy_type,
        final_score,
        risk_category,
        factor_scores,
        recommendations,
        created_at
      FROM risk_scores 
      WHERE workspace_id = $1 AND applicant_id = $2
      ORDER BY created_at DESC
    `, [req.workspace_id, applicant_id]);

    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('Error fetching risk scores:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch risk scores'
    });
  }
});

// Create new risk scoring model (Admin only)
router.post('/models', authenticateToken, requireRole(['admin']), async (req: Request, res: Response) => {
  try {
    const { 
      name, 
      version, 
      description, 
      model_type,
      risk_factors, 
      thresholds, 
      model_config 
    } = req.body;

    const modelId = uuidv4();

    await db.query(`
      INSERT INTO risk_scoring_models (
        model_id, workspace_id, name, version, description, model_type,
        risk_factors, thresholds, model_config, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
    `, [
      modelId, req.workspace_id, name, version, description, model_type,
      risk_factors, thresholds, model_config
    ]);

    res.status(201).json({
      success: true,
      data: { model_id: modelId }
    });
  } catch (error) {
    console.error('Error creating risk model:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create risk model'
    });
  }
});

export default router;