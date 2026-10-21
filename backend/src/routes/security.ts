import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../database/connection';
import { authenticateToken, requireRole } from '../middleware/auth';

const router = Router();

// Get security dashboard
router.get('/dashboard', authenticateToken, requireRole(['admin', 'security_officer']), async (req: Request, res: Response) => {
  try {
    // Security alerts summary
    const alertsQuery = await db.query(`
      SELECT 
        severity,
        COUNT(*) as alert_count,
        COUNT(CASE WHEN status = 'OPEN' THEN 1 END) as open_alerts,
        COUNT(CASE WHEN created_at >= NOW() - INTERVAL '24 hours' THEN 1 END) as last_24h
      FROM security_alerts 
      WHERE workspace_id = $1
      GROUP BY severity
      ORDER BY 
        CASE severity 
          WHEN 'CRITICAL' THEN 1 
          WHEN 'HIGH' THEN 2 
          WHEN 'MEDIUM' THEN 3 
          WHEN 'LOW' THEN 4 
        END
    `, [req.workspace_id]);

    // Authentication events
    const authEventsQuery = await db.query(`
      SELECT 
        event_type,
        COUNT(*) as event_count,
        COUNT(CASE WHEN success = true THEN 1 END) as successful_events,
        COUNT(CASE WHEN success = false THEN 1 END) as failed_events,
        COUNT(CASE WHEN created_at >= NOW() - INTERVAL '24 hours' THEN 1 END) as last_24h
      FROM security_events 
      WHERE workspace_id = $1 AND event_type IN ('LOGIN', 'LOGOUT', 'FAILED_LOGIN')
      GROUP BY event_type
    `, [req.workspace_id]);

    // Access control summary
    const accessControlQuery = await db.query(`
      SELECT 
        COUNT(*) as total_permissions,
        COUNT(CASE WHEN granted = true THEN 1 END) as granted_permissions,
        COUNT(CASE WHEN granted = false THEN 1 END) as denied_permissions,
        COUNT(CASE WHEN created_at >= NOW() - INTERVAL '7 days' THEN 1 END) as recent_changes
      FROM access_control_logs 
      WHERE workspace_id = $1
    `, [req.workspace_id]);

    // System health metrics
    const systemHealthQuery = await db.query(`
      SELECT 
        component,
        status,
        last_check,
        response_time_ms,
        uptime_percentage
      FROM system_health_checks 
      WHERE workspace_id = $1 AND last_check >= NOW() - INTERVAL '1 hour'
      ORDER BY component
    `, [req.workspace_id]);

    // Recent security events timeline
    const recentEventsQuery = await db.query(`
      SELECT 
        event_id, event_type, severity, source_ip, user_id,
        description, created_at
      FROM security_events 
      WHERE workspace_id = $1 
        AND created_at >= NOW() - INTERVAL '24 hours'
      ORDER BY created_at DESC
      LIMIT 20
    `, [req.workspace_id]);

    res.json({
      success: true,
      data: {
        security_alerts: alertsQuery.rows,
        authentication_events: authEventsQuery.rows,
        access_control: accessControlQuery.rows[0] || {
          total_permissions: 0,
          granted_permissions: 0,
          denied_permissions: 0,
          recent_changes: 0
        },
        system_health: systemHealthQuery.rows,
        recent_events: recentEventsQuery.rows
      }
    });
  } catch (error) {
    console.error('Error fetching security dashboard:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch security dashboard data'
    });
  }
});

// Get security alerts
router.get('/alerts', authenticateToken, requireRole(['admin', 'security_officer']), async (req: Request, res: Response) => {
  try {
    const { severity, status, alert_type, limit = 50 } = req.query;

    let whereClause = 'WHERE workspace_id = $1';
    const queryParams = [req.workspace_id];
    let paramCount = 1;

    if (severity) {
      paramCount++;
      whereClause += ` AND severity = $${paramCount}`;
      queryParams.push(severity);
    }

    if (status) {
      paramCount++;
      whereClause += ` AND status = $${paramCount}`;
      queryParams.push(status);
    }

    if (alert_type) {
      paramCount++;
      whereClause += ` AND alert_type = $${paramCount}`;
      queryParams.push(alert_type);
    }

    const alertsQuery = await db.query(`
      SELECT 
        alert_id, alert_type, severity, title, description,
        affected_resources, source_ip, user_id, status,
        assigned_to, resolved_at, created_at
      FROM security_alerts 
      ${whereClause}
      ORDER BY 
        CASE severity 
          WHEN 'CRITICAL' THEN 1 
          WHEN 'HIGH' THEN 2 
          WHEN 'MEDIUM' THEN 3 
          WHEN 'LOW' THEN 4 
        END,
        created_at DESC
      LIMIT $${paramCount + 1}
    `, [...queryParams, parseInt(limit)]);

    res.json({
      success: true,
      data: alertsQuery.rows
    });
  } catch (error) {
    console.error('Error fetching security alerts:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch security alerts'
    });
  }
});

// Create security alert
router.post('/alerts', authenticateToken, requireRole(['admin', 'security_officer']), async (req: Request, res: Response) => {
  try {
    const {
      alert_type, severity, title, description,
      affected_resources, source_ip, user_id
    } = req.body;

    const alertId = uuidv4();

    await db.query(`
      INSERT INTO security_alerts (
        alert_id, workspace_id, alert_type, severity, title,
        description, affected_resources, source_ip, user_id,
        status, created_at, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), $11)
    `, [
      alertId, req.workspace_id, alert_type, severity, title,
      description, JSON.stringify(affected_resources), source_ip,
      user_id, 'OPEN', req.user.id
    ]);

    res.status(201).json({
      success: true,
      data: { alert_id: alertId }
    });
  } catch (error) {
    console.error('Error creating security alert:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create security alert'
    });
  }
});

// Update security alert
router.put('/alerts/:alert_id', authenticateToken, requireRole(['admin', 'security_officer']), async (req: Request, res: Response) => {
  try {
    const { alert_id } = req.params;
    const { status, assigned_to, resolution_notes } = req.body;

    let updateClause = 'status = $1';
    const queryParams = [status, req.workspace_id, alert_id];
    let paramCount = 3;

    if (assigned_to) {
      paramCount++;
      updateClause += `, assigned_to = $${paramCount}`;
      queryParams.push(assigned_to);
    }

    if (status === 'RESOLVED') {
      paramCount++;
      updateClause += `, resolved_at = $${paramCount}`;
      queryParams.push(new Date());
    }

    if (resolution_notes) {
      paramCount++;
      updateClause += `, resolution_notes = $${paramCount}`;
      queryParams.push(resolution_notes);
    }

    updateClause += ', updated_at = NOW()';

    const updateQuery = await db.query(`
      UPDATE security_alerts 
      SET ${updateClause}
      WHERE alert_id = $2 AND workspace_id = $1
    `, queryParams);

    if (updateQuery.rowCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'Security alert not found'
      });
    }

    res.json({
      success: true,
      message: 'Security alert updated successfully'
    });
  } catch (error) {
    console.error('Error updating security alert:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update security alert'
    });
  }
});

// Get security events
router.get('/events', authenticateToken, requireRole(['admin', 'security_officer']), async (req: Request, res: Response) => {
  try {
    const { event_type, severity, source_ip, user_id, date_from, date_to, limit = 100 } = req.query;

    let whereClause = 'WHERE workspace_id = $1';
    const queryParams = [req.workspace_id];
    let paramCount = 1;

    if (event_type) {
      paramCount++;
      whereClause += ` AND event_type = $${paramCount}`;
      queryParams.push(event_type);
    }

    if (severity) {
      paramCount++;
      whereClause += ` AND severity = $${paramCount}`;
      queryParams.push(severity);
    }

    if (source_ip) {
      paramCount++;
      whereClause += ` AND source_ip = $${paramCount}`;
      queryParams.push(source_ip);
    }

    if (user_id) {
      paramCount++;
      whereClause += ` AND user_id = $${paramCount}`;
      queryParams.push(user_id);
    }

    if (date_from) {
      paramCount++;
      whereClause += ` AND created_at >= $${paramCount}`;
      queryParams.push(date_from);
    }

    if (date_to) {
      paramCount++;
      whereClause += ` AND created_at <= $${paramCount}`;
      queryParams.push(date_to);
    }

    const eventsQuery = await db.query(`
      SELECT 
        event_id, event_type, severity, source_ip, user_id,
        description, metadata, success, created_at
      FROM security_events 
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${paramCount + 1}
    `, [...queryParams, parseInt(limit)]);

    res.json({
      success: true,
      data: eventsQuery.rows
    });
  } catch (error) {
    console.error('Error fetching security events:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch security events'
    });
  }
});

// Log security event
router.post('/events', authenticateToken, async (req: Request, res: Response) => {
  try {
    const {
      event_type, severity = 'LOW', source_ip, user_id,
      description, metadata, success = true
    } = req.body;

    const eventId = uuidv4();

    await db.query(`
      INSERT INTO security_events (
        event_id, workspace_id, event_type, severity, source_ip,
        user_id, description, metadata, success, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
    `, [
      eventId, req.workspace_id, event_type, severity, source_ip,
      user_id, description, JSON.stringify(metadata), success
    ]);

    // Auto-alert for critical security events
    if (severity === 'CRITICAL' && !success) {
      await createAutoAlert(req.workspace_id, event_type, source_ip, user_id, description);
    }

    res.status(201).json({
      success: true,
      data: { event_id: eventId }
    });
  } catch (error) {
    console.error('Error logging security event:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to log security event'
    });
  }
});

// Get access control logs
router.get('/access-control', authenticateToken, requireRole(['admin', 'security_officer']), async (req: Request, res: Response) => {
  try {
    const { resource_type, action, user_id, date_from, date_to, limit = 100 } = req.query;

    let whereClause = 'WHERE workspace_id = $1';
    const queryParams = [req.workspace_id];
    let paramCount = 1;

    if (resource_type) {
      paramCount++;
      whereClause += ` AND resource_type = $${paramCount}`;
      queryParams.push(resource_type);
    }

    if (action) {
      paramCount++;
      whereClause += ` AND action = $${paramCount}`;
      queryParams.push(action);
    }

    if (user_id) {
      paramCount++;
      whereClause += ` AND user_id = $${paramCount}`;
      queryParams.push(user_id);
    }

    if (date_from) {
      paramCount++;
      whereClause += ` AND created_at >= $${paramCount}`;
      queryParams.push(date_from);
    }

    if (date_to) {
      paramCount++;
      whereClause += ` AND created_at <= $${paramCount}`;
      queryParams.push(date_to);
    }

    const accessLogsQuery = await db.query(`
      SELECT 
        log_id, resource_type, resource_id, action, user_id,
        permissions_requested, permissions_granted, granted,
        source_ip, user_agent, created_at
      FROM access_control_logs 
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${paramCount + 1}
    `, [...queryParams, parseInt(limit)]);

    res.json({
      success: true,
      data: accessLogsQuery.rows
    });
  } catch (error) {
    console.error('Error fetching access control logs:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch access control logs'
    });
  }
});

// Run security scan
router.post('/scan', authenticateToken, requireRole(['admin', 'security_officer']), async (req: Request, res: Response) => {
  try {
    const { scan_type = 'comprehensive', target_areas = [] } = req.body;

    const scanId = uuidv4();
    const startTime = new Date();

    // Initialize scan record
    await db.query(`
      INSERT INTO security_scans (
        scan_id, workspace_id, scan_type, target_areas,
        status, started_at, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [
      scanId, req.workspace_id, scan_type, JSON.stringify(target_areas),
      'RUNNING', startTime, req.user.id
    ]);

    // Run different types of security scans
    const scanResults = {
      scan_id: scanId,
      started_at: startTime,
      scan_type,
      results: {}
    };

    if (scan_type === 'comprehensive' || target_areas.includes('authentication')) {
      scanResults.results.authentication = await runAuthenticationScan();
    }

    if (scan_type === 'comprehensive' || target_areas.includes('authorization')) {
      scanResults.results.authorization = await runAuthorizationScan();
    }

    if (scan_type === 'comprehensive' || target_areas.includes('data_protection')) {
      scanResults.results.data_protection = await runDataProtectionScan();
    }

    if (scan_type === 'comprehensive' || target_areas.includes('infrastructure')) {
      scanResults.results.infrastructure = await runInfrastructureScan();
    }

    // Calculate overall security score
    const securityScore = calculateSecurityScore(scanResults.results);

    const endTime = new Date();
    const duration = (endTime.getTime() - startTime.getTime()) / 1000;

    // Update scan record with results
    await db.query(`
      UPDATE security_scans 
      SET status = $1, results = $2, security_score = $3,
          completed_at = $4, duration_seconds = $5
      WHERE scan_id = $6 AND workspace_id = $7
    `, [
      'COMPLETED', JSON.stringify(scanResults.results), securityScore,
      endTime, duration, scanId, req.workspace_id
    ]);

    res.json({
      success: true,
      data: {
        scan_id: scanId,
        security_score: securityScore,
        duration_seconds: duration,
        results: scanResults.results
      }
    });
  } catch (error) {
    console.error('Error running security scan:', error);
    
    // Update scan status to failed
    await db.query(`
      UPDATE security_scans 
      SET status = $1, error_message = $2
      WHERE scan_id = $3 AND workspace_id = $4
    `, ['FAILED', error.message, scanId, req.workspace_id]);

    res.status(500).json({
      success: false,
      error: 'Failed to run security scan'
    });
  }
});

// Get security scans
router.get('/scans', authenticateToken, requireRole(['admin', 'security_officer']), async (req: Request, res: Response) => {
  try {
    const { scan_type, status, limit = 20 } = req.query;

    let whereClause = 'WHERE workspace_id = $1';
    const queryParams = [req.workspace_id];
    let paramCount = 1;

    if (scan_type) {
      paramCount++;
      whereClause += ` AND scan_type = $${paramCount}`;
      queryParams.push(scan_type);
    }

    if (status) {
      paramCount++;
      whereClause += ` AND status = $${paramCount}`;
      queryParams.push(status);
    }

    const scansQuery = await db.query(`
      SELECT 
        scan_id, scan_type, status, security_score,
        target_areas, started_at, completed_at, duration_seconds,
        error_message, created_by
      FROM security_scans 
      ${whereClause}
      ORDER BY started_at DESC
      LIMIT $${paramCount + 1}
    `, [...queryParams, parseInt(limit)]);

    res.json({
      success: true,
      data: scansQuery.rows
    });
  } catch (error) {
    console.error('Error fetching security scans:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch security scans'
    });
  }
});

// Get compliance status
router.get('/compliance', authenticateToken, requireRole(['admin', 'security_officer']), async (req: Request, res: Response) => {
  try {
    const { framework = 'SOC2', period = '90' } = req.query;

    // Get compliance controls for the framework
    const controlsQuery = await db.query(`
      SELECT 
        control_id, control_name, control_category,
        implementation_status, last_assessed, assessed_by,
        evidence_location, notes
      FROM compliance_controls 
      WHERE workspace_id = $1 AND framework = $2
      ORDER BY control_category, control_name
    `, [req.workspace_id, framework]);

    // Calculate compliance score
    const totalControls = controlsQuery.rows.length;
    const implementedControls = controlsQuery.rows.filter(c => c.implementation_status === 'IMPLEMENTED').length;
    const complianceScore = totalControls > 0 ? (implementedControls / totalControls) * 100 : 0;

    // Get recent compliance assessments
    const assessmentsQuery = await db.query(`
      SELECT 
        assessment_id, assessment_type, overall_score,
        assessment_date, assessor_name, key_findings,
        recommendations, next_assessment_date
      FROM compliance_assessments 
      WHERE workspace_id = $1 AND framework = $2
        AND assessment_date >= NOW() - INTERVAL '${period} days'
      ORDER BY assessment_date DESC
    `, [req.workspace_id, framework]);

    res.json({
      success: true,
      data: {
        framework,
        period_days: parseInt(period),
        compliance_score: Math.round(complianceScore),
        total_controls: totalControls,
        implemented_controls: implementedControls,
        controls: controlsQuery.rows,
        recent_assessments: assessmentsQuery.rows
      }
    });
  } catch (error) {
    console.error('Error fetching compliance status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch compliance status'
    });
  }
});

// Helper functions
async function createAutoAlert(workspaceId, eventType, sourceIp, userId, description) {
  const alertId = uuidv4();
  
  await db.query(`
    INSERT INTO security_alerts (
      alert_id, workspace_id, alert_type, severity, title,
      description, source_ip, user_id, status, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
  `, [
    alertId, workspaceId, eventType, 'CRITICAL',
    `Critical Security Event: ${eventType}`, description,
    sourceIp, userId, 'OPEN'
  ]);
}

async function runAuthenticationScan() {
  // Simulate authentication security scan
  return {
    vulnerabilities_found: Math.floor(Math.random() * 3),
    recommendations: [
      'Enable multi-factor authentication for all admin accounts',
      'Implement account lockout after failed login attempts',
      'Review and update password policies'
    ],
    score: 85 + Math.floor(Math.random() * 10)
  };
}

async function runAuthorizationScan() {
  // Simulate authorization security scan
  return {
    vulnerabilities_found: Math.floor(Math.random() * 2),
    recommendations: [
      'Review user permissions and remove unnecessary access',
      'Implement principle of least privilege',
      'Regular access reviews for all users'
    ],
    score: 80 + Math.floor(Math.random() * 15)
  };
}

async function runDataProtectionScan() {
  // Simulate data protection scan
  return {
    vulnerabilities_found: Math.floor(Math.random() * 4),
    recommendations: [
      'Encrypt sensitive data at rest',
      'Implement data classification policies',
      'Regular backup and recovery testing'
    ],
    score: 75 + Math.floor(Math.random() * 20)
  };
}

async function runInfrastructureScan() {
  // Simulate infrastructure security scan
  return {
    vulnerabilities_found: Math.floor(Math.random() * 5),
    recommendations: [
      'Keep all systems updated with latest security patches',
      'Implement network segmentation',
      'Enable logging and monitoring for all systems'
    ],
    score: 70 + Math.floor(Math.random() * 25)
  };
}

function calculateSecurityScore(results) {
  const scores = Object.values(results).map(result => result.score);
  return scores.length > 0 ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : 0;
}

export default router;