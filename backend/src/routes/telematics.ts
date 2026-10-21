import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../database/connection';
import { authenticateToken, requireRole } from '../middleware/auth';

const router = Router();

// Get telematics devices for workspace
router.get('/devices', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { status, device_type } = req.query;

    let whereClause = 'WHERE workspace_id = $1';
    const queryParams = [req.workspace_id];
    let paramCount = 1;

    if (status) {
      paramCount++;
      whereClause += ` AND status = $${paramCount}`;
      queryParams.push(status);
    }

    if (device_type) {
      paramCount++;
      whereClause += ` AND device_type = $${paramCount}`;
      queryParams.push(device_type);
    }

    const devicesQuery = await db.query(`
      SELECT 
        device_id, device_name, device_type, serial_number, 
        status, firmware_version, last_seen, battery_level,
        policy_id, installation_date, created_at
      FROM telematics_devices 
      ${whereClause}
      ORDER BY created_at DESC
    `, queryParams);

    res.json({
      success: true,
      data: devicesQuery.rows
    });
  } catch (error) {
    console.error('Error fetching telematics devices:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch telematics devices'
    });
  }
});

// Register new telematics device
router.post('/devices', authenticateToken, async (req: Request, res: Response) => {
  try {
    const {
      device_name, device_type, serial_number, firmware_version,
      policy_id, installation_location
    } = req.body;

    const deviceId = uuidv4();

    await db.query(`
      INSERT INTO telematics_devices (
        device_id, workspace_id, device_name, device_type, serial_number,
        firmware_version, policy_id, installation_location, status,
        installation_date, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
    `, [
      deviceId, req.workspace_id, device_name, device_type, serial_number,
      firmware_version, policy_id, installation_location, 'ACTIVE'
    ]);

    res.status(201).json({
      success: true,
      data: { device_id: deviceId }
    });
  } catch (error) {
    console.error('Error registering device:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to register telematics device'
    });
  }
});

// Process telematics data
router.post('/data', authenticateToken, async (req: Request, res: Response) => {
  try {
    const {
      device_id, timestamp, location, speed, acceleration, 
      braking_events, acceleration_events, night_driving, 
      distance_travelled, fuel_consumption
    } = req.body;

    // Verify device belongs to workspace
    const deviceQuery = await db.query(`
      SELECT device_id, policy_id 
      FROM telematics_devices 
      WHERE device_id = $1 AND workspace_id = $2
    `, [device_id, req.workspace_id]);

    if (deviceQuery.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Device not found'
      });
    }

    const device = deviceQuery.rows[0];
    const dataId = uuidv4();

    // Store raw telematics data
    await db.query(`
      INSERT INTO telematics_data (
        data_id, workspace_id, device_id, policy_id, timestamp,
        location, speed, acceleration, braking_events, 
        acceleration_events, night_driving, distance_travelled,
        fuel_consumption, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
    `, [
      dataId, req.workspace_id, device_id, device.policy_id, timestamp,
      location, speed, acceleration, braking_events, 
      acceleration_events, night_driving, distance_travelled, fuel_consumption
    ]);

    // Update device last seen timestamp
    await db.query(`
      UPDATE telematics_devices 
      SET last_seen = NOW()
      WHERE device_id = $1 AND workspace_id = $2
    `, [device_id, req.workspace_id]);

    // Process driving behavior analysis
    const behaviorScore = calculateDrivingScore(speed, acceleration, braking_events, night_driving);
    
    // Store behavior analysis
    await db.query(`
      INSERT INTO driving_behavior (
        analysis_id, workspace_id, device_id, policy_id, analysis_date,
        speed_score, acceleration_score, braking_score, night_driving_score,
        overall_score, risk_level, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
    `, [
      uuidv4(), req.workspace_id, device_id, device.policy_id, timestamp,
      speed, acceleration, braking_events, night_driving,
      behaviorScore.score, behaviorScore.riskLevel
    ]);

    res.json({
      success: true,
      data: { 
        data_id: dataId,
        behavior_score: behaviorScore
      }
    });
  } catch (error) {
    console.error('Error processing telematics data:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process telematics data'
    });
  }
});

// Calculate driving score based on telematics data
function calculateDrivingScore(speed, acceleration, braking, nightDriving) {
  let score = 100;
  
  // Speed violations
  if (speed > 80) score -= 30;
  else if (speed > 70) score -= 15;
  else if (speed > 65) score -= 5;
  
  // Acceleration patterns
  if (acceleration > 8) score -= 25;
  else if (acceleration > 6) score -= 15;
  else if (acceleration > 4) score -= 8;
  
  // Braking events
  if (braking > 10) score -= 20;
  else if (braking > 5) score -= 10;
  else if (braking > 2) score -= 5;
  
  // Night driving (higher risk)
  if (nightDriving > 0.3) score -= 10;
  
  // Ensure score stays within bounds
  score = Math.max(0, Math.min(100, score));
  
  let riskLevel = 'LOW';
  if (score < 40) riskLevel = 'HIGH';
  else if (score < 70) riskLevel = 'MEDIUM';
  
  return { score, riskLevel };
}

// Get driving behavior analysis for policy
router.get('/behavior/:policy_id', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { policy_id } = req.params;
    const { period = '30' } = req.query; // days

    // Get recent behavior analysis
    const behaviorQuery = await db.query(`
      SELECT 
        analysis_date,
        speed_score,
        acceleration_score,
        braking_score,
        night_driving_score,
        overall_score,
        risk_level
      FROM driving_behavior 
      WHERE workspace_id = $1 AND policy_id = $2
        AND analysis_date >= NOW() - INTERVAL '${period} days'
      ORDER BY analysis_date DESC
    `, [req.workspace_id, policy_id]);

    // Calculate average scores
    if (behaviorQuery.rows.length > 0) {
      const scores = behaviorQuery.rows;
      const averages = {
        overall: scores.reduce((sum, row) => sum + parseFloat(row.overall_score), 0) / scores.length,
        speed: scores.reduce((sum, row) => sum + parseFloat(row.speed_score), 0) / scores.length,
        acceleration: scores.reduce((sum, row) => sum + parseFloat(row.acceleration_score), 0) / scores.length,
        braking: scores.reduce((sum, row) => sum + parseFloat(row.braking_score), 0) / scores.length,
        night_driving: scores.reduce((sum, row) => sum + parseFloat(row.night_driving_score), 0) / scores.length
      };

      // Determine current risk level
      let currentRiskLevel = 'LOW';
      if (averages.overall < 40) currentRiskLevel = 'HIGH';
      else if (averages.overall < 70) currentRiskLevel = 'MEDIUM';

      res.json({
        success: true,
        data: {
          period_days: parseInt(period),
          current_risk_level: currentRiskLevel,
          average_scores: averages,
          total_analysis_points: scores.length,
          recent_analysis: scores.slice(0, 30) // Last 30 data points
        }
      });
    } else {
      res.json({
        success: true,
        data: {
          period_days: parseInt(period),
          current_risk_level: 'UNKNOWN',
          average_scores: null,
          total_analysis_points: 0,
          recent_analysis: []
        }
      });
    }
  } catch (error) {
    console.error('Error fetching driving behavior:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch driving behavior analysis'
    });
  }
});

// Calculate usage-based premium adjustments
router.post('/premium-adjustment/:policy_id', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { policy_id } = req.params;
    const { adjustment_period = '30' } = req.body; // days

    // Get driving behavior scores for the period
    const behaviorQuery = await db.query(`
      SELECT 
        AVG(overall_score) as avg_score,
        COUNT(*) as analysis_points
      FROM driving_behavior 
      WHERE workspace_id = $1 AND policy_id = $2
        AND analysis_date >= NOW() - INTERVAL '${adjustment_period} days'
    `, [req.workspace_id, policy_id]);

    if (behaviorQuery.rows.length === 0 || !behaviorQuery.rows[0].avg_score) {
      return res.status(404).json({
        success: false,
        error: 'No driving behavior data available for this period'
      });
    }

    const avgScore = parseFloat(behaviorQuery.rows[0].avg_score);
    const analysisPoints = parseInt(behaviorQuery.rows[0].analysis_points);

    // Get current premium
    const policyQuery = await db.query(`
      SELECT premium_amount, policy_type
      FROM policies 
      WHERE policy_id = $1 AND workspace_id = $2
    `, [policy_id, req.workspace_id]);

    if (policyQuery.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Policy not found'
      });
    }

    const policy = policyQuery.rows[0];
    const currentPremium = parseFloat(policy.premium_amount);

    // Calculate premium adjustment
    let adjustmentPercentage = 0;
    let adjustmentReason = '';

    if (avgScore >= 85) {
      adjustmentPercentage = -15; // 15% discount for excellent driving
      adjustmentReason = 'Excellent driving behavior';
    } else if (avgScore >= 70) {
      adjustmentPercentage = -10; // 10% discount for good driving
      adjustmentReason = 'Good driving behavior';
    } else if (avgScore >= 50) {
      adjustmentPercentage = 0; // No adjustment for average driving
      adjustmentReason = 'Average driving behavior';
    } else if (avgScore >= 30) {
      adjustmentPercentage = 15; // 15% surcharge for poor driving
      adjustmentReason = 'Poor driving behavior';
    } else {
      adjustmentPercentage = 25; // 25% surcharge for very poor driving
      adjustmentReason = 'Very poor driving behavior';
    }

    const adjustedPremium = currentPremium * (1 + adjustmentPercentage / 100);
    const premiumChange = adjustedPremium - currentPremium;

    // Create premium adjustment record
    const adjustmentId = uuidv4();
    await db.query(`
      INSERT INTO premium_adjustments (
        adjustment_id, workspace_id, policy_id, adjustment_type,
        original_premium, adjusted_premium, adjustment_percentage,
        reason, driving_score, analysis_points, period_days,
        effective_date, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())
    `, [
      adjustmentId, req.workspace_id, policy_id, 'TELematics',
      currentPremium, adjustedPremium, adjustmentPercentage,
      adjustmentReason, avgScore, analysisPoints, adjustment_period
    ]);

    res.json({
      success: true,
      data: {
        adjustment_id: adjustmentId,
        original_premium: currentPremium,
        adjusted_premium: adjustedPremium,
        adjustment_percentage: adjustmentPercentage,
        premium_change: premiumChange,
        reason: adjustmentReason,
        driving_score: avgScore,
        analysis_points: analysisPoints
      }
    });
  } catch (error) {
    console.error('Error calculating premium adjustment:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to calculate premium adjustment'
    });
  }
});

// Get telematics dashboard
router.get('/dashboard', authenticateToken, async (req: Request, res: Response) => {
  try {
    // Device status summary
    const deviceStatusQuery = await db.query(`
      SELECT 
        status,
        COUNT(*) as count,
        COUNT(CASE WHEN last_seen >= NOW() - INTERVAL '24 hours' THEN 1 END) as active_24h
      FROM telematics_devices 
      WHERE workspace_id = $1
      GROUP BY status
    `, [req.workspace_id]);

    // Driving behavior distribution
    const behaviorDistributionQuery = await db.query(`
      SELECT 
        risk_level,
        COUNT(*) as count,
        AVG(overall_score) as avg_score
      FROM driving_behavior 
      WHERE workspace_id = $1 AND analysis_date >= NOW() - INTERVAL '30 days'
      GROUP BY risk_level
    `, [req.workspace_id]);

    // Premium adjustments summary
    const premiumAdjustmentsQuery = await db.query(`
      SELECT 
        COUNT(*) as total_adjustments,
        COUNT(CASE WHEN adjustment_percentage < 0 THEN 1 END) as discounts,
        COUNT(CASE WHEN adjustment_percentage > 0 THEN 1 END) as surcharges,
        AVG(adjustment_percentage) as avg_adjustment
      FROM premium_adjustments 
      WHERE workspace_id = $1 AND adjustment_type = 'TELematics'
        AND effective_date >= NOW() - INTERVAL '30 days'
    `, [req.workspace_id]);

    // Recent telematics data volume
    const dataVolumeQuery = await db.query(`
      SELECT 
        DATE_TRUNC('hour', created_at) as hour,
        COUNT(*) as data_points
      FROM telematics_data 
      WHERE workspace_id = $1 AND created_at >= NOW() - INTERVAL '24 hours'
      GROUP BY DATE_TRUNC('hour', created_at)
      ORDER BY hour
    `, [req.workspace_id]);

    res.json({
      success: true,
      data: {
        device_status: deviceStatusQuery.rows,
        behavior_distribution: behaviorDistributionQuery.rows,
        premium_adjustments: premiumAdjustmentsQuery.rows[0] || {
          total_adjustments: 0,
          discounts: 0,
          surcharges: 0,
          avg_adjustment: 0
        },
        data_volume_24h: dataVolumeQuery.rows
      }
    });
  } catch (error) {
    console.error('Error fetching telematics dashboard:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch telematics dashboard data'
    });
  }
});

// Simulate telematics data (for testing)
router.post('/simulate-data/:device_id', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { device_id } = req.params;

    // Generate realistic telematics data
    const mockData = {
      timestamp: new Date().toISOString(),
      location: {
        latitude: 40.7128 + (Math.random() - 0.5) * 0.1,
        longitude: -74.0060 + (Math.random() - 0.5) * 0.1
      },
      speed: Math.floor(30 + Math.random() * 60), // 30-90 mph
      acceleration: Math.random() * 8, // 0-8 m/s²
      braking_events: Math.floor(Math.random() * 8),
      acceleration_events: Math.floor(Math.random() * 5),
      night_driving: Math.random() * 0.5, // 0-50% night driving
      distance_travelled: Math.random() * 100, // 0-100 miles
      fuel_consumption: Math.random() * 30 // 0-30 gallons
    };

    // Use the existing data processing endpoint
    const simulateReq = {
      ...req,
      body: {
        device_id,
        ...mockData
      }
    };

    const simulateRes = {
      json: (data) => res.json(data),
      status: (code) => ({ json: (data) => res.status(code).json(data) })
    };

    // Call the process data endpoint
    const originalReq = req;
    const originalRes = res;

    req = simulateReq as any;
    res = simulateRes as any;

    // Temporarily override req/res for this call
    await router.handle({ method: 'POST', url: '/data', headers: req.headers, body: mockData }, res);

    // Restore original req/res
    req = originalReq;
    res = originalRes;

    res.json({
      success: true,
      message: 'Simulated telematics data processed successfully',
      data: mockData
    });
  } catch (error) {
    console.error('Error simulating telematics data:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to simulate telematics data'
    });
  }
});

export default router;