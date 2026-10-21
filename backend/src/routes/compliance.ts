import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../database/connection';
import { authenticateToken, requireRole } from '../middleware/auth';

const router = Router();

// Get compliance requirements
router.get('/requirements', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { jurisdiction, category, status } = req.query;

    let whereClause = 'WHERE workspace_id = $1';
    const queryParams = [req.workspace_id];
    let paramCount = 1;

    if (jurisdiction) {
      paramCount++;
      whereClause += ` AND jurisdiction = $${paramCount}`;
      queryParams.push(jurisdiction);
    }

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

    const requirementsQuery = await db.query(`
      SELECT 
        requirement_id, title, description, jurisdiction, category,
        regulatory_body, effective_date, due_date, frequency,
        status, compliance_level, created_at
      FROM compliance_requirements 
      ${whereClause}
      ORDER BY due_date ASC
    `, queryParams);

    res.json({
      success: true,
      data: requirementsQuery.rows
    });
  } catch (error) {
    console.error('Error fetching compliance requirements:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch compliance requirements'
    });
  }
});

// Create compliance requirement
router.post('/requirements', authenticateToken, requireRole(['admin']), async (req: Request, res: Response) => {
  try {
    const {
      title, description, jurisdiction, category,
      regulatory_body, effective_date, due_date, frequency,
      compliance_level, submission_format
    } = req.body;

    const requirementId = uuidv4();

    await db.query(`
      INSERT INTO compliance_requirements (
        requirement_id, workspace_id, title, description, jurisdiction,
        category, regulatory_body, effective_date, due_date, frequency,
        compliance_level, submission_format, status, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
    `, [
      requirementId, req.workspace_id, title, description, jurisdiction,
      category, regulatory_body, effective_date, due_date, frequency,
      compliance_level, submission_format, 'ACTIVE'
    ]);

    res.status(201).json({
      success: true,
      data: { requirement_id: requirementId }
    });
  } catch (error) {
    console.error('Error creating compliance requirement:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create compliance requirement'
    });
  }
});

// Submit compliance report
router.post('/reports', authenticateToken, async (req: Request, res: Response) => {
  try {
    const {
      requirement_id, report_period, data, 
      attachments, submitted_by, notes
    } = req.body;

    // Verify requirement exists
    const requirementQuery = await db.query(`
      SELECT requirement_id, title, due_date, compliance_level
      FROM compliance_requirements 
      WHERE requirement_id = $1 AND workspace_id = $2
    `, [requirement_id, req.workspace_id]);

    if (requirementQuery.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Compliance requirement not found'
      });
    }

    const requirement = requirementQuery.rows[0];
    const reportId = uuidv4();

    // Determine submission status
    let submissionStatus = 'SUBMITTED';
    let isCompliant = true;
    let overdue = false;

    if (new Date() > new Date(requirement.due_date)) {
      submissionStatus = 'LATE_SUBMISSION';
      isCompliant = false;
      overdue = true;
    }

    await db.query(`
      INSERT INTO compliance_reports (
        report_id, workspace_id, requirement_id, report_period,
        submission_data, attachments, submission_status, is_compliant,
        overdue, submitted_by, notes, submitted_at, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())
    `, [
      reportId, req.workspace_id, requirement_id, report_period,
      JSON.stringify(data), JSON.stringify(attachments), submissionStatus,
      isCompliant, overdue, submitted_by || req.user.id, notes
    ]);

    // Create compliance task for review
    await db.query(`
      INSERT INTO compliance_tasks (
        task_id, workspace_id, requirement_id, report_id, task_type,
        priority, status, assigned_to, due_date, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
    `, [
      uuidv4(), req.workspace_id, requirement_id, reportId,
      'REVIEW_SUBMISSION', 'normal', 'PENDING', req.user.id,
      new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days from now
    ]);

    res.status(201).json({
      success: true,
      data: { report_id: reportId, submission_status: submissionStatus }
    });
  } catch (error) {
    console.error('Error submitting compliance report:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to submit compliance report'
    });
  }
});

// Get compliance reports
router.get('/reports', authenticateToken, async (req: Request, res: Response) => {
  try {
    const {
      requirement_id, status, period_start, period_end,
      page = 1, limit = 20
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);

    let whereClause = 'WHERE cr.workspace_id = $1';
    const queryParams = [req.workspace_id];
    let paramCount = 1;

    if (requirement_id) {
      paramCount++;
      whereClause += ` AND cr.requirement_id = $${paramCount}`;
      queryParams.push(requirement_id);
    }

    if (status) {
      paramCount++;
      whereClause += ` AND cr.submission_status = $${paramCount}`;
      queryParams.push(status);
    }

    if (period_start) {
      paramCount++;
      whereClause += ` AND cr.report_period >= $${paramCount}`;
      queryParams.push(period_start);
    }

    if (period_end) {
      paramCount++;
      whereClause += ` AND cr.report_period <= $${paramCount}`;
      queryParams.push(period_end);
    }

    const reportsQuery = await db.query(`
      SELECT 
        cr.report_id, cr.report_period, cr.submission_status,
        cr.is_compliant, cr.overdue, cr.submitted_at,
        crt.title as requirement_title, crt.jurisdiction,
        u.first_name as submitted_by_name
      FROM compliance_reports cr
      JOIN compliance_requirements crt ON cr.requirement_id = crt.requirement_id
      LEFT JOIN users u ON cr.submitted_by = u.user_id
      ${whereClause}
      ORDER BY cr.submitted_at DESC
      LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}
    `, [...queryParams, parseInt(limit), offset]);

    const countQuery = await db.query(`
      SELECT COUNT(*) as total
      FROM compliance_reports cr
      ${whereClause}
    `, queryParams);

    res.json({
      success: true,
      data: {
        reports: reportsQuery.rows,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: parseInt(countQuery.rows[0].total),
          pages: Math.ceil(parseInt(countQuery.rows[0].total) / parseInt(limit))
        }
      }
    });
  } catch (error) {
    console.error('Error fetching compliance reports:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch compliance reports'
    });
  }
});

// Get compliance dashboard
router.get('/dashboard', authenticateToken, async (req: Request, res: Response) => {
  try {
    // Compliance status overview
    const statusOverviewQuery = await db.query(`
      SELECT 
        COUNT(*) as total_requirements,
        COUNT(CASE WHEN status = 'ACTIVE' THEN 1 END) as active_requirements,
        COUNT(CASE WHEN due_date < NOW() AND status = 'ACTIVE' THEN 1 END) as overdue_requirements,
        COUNT(CASE WHEN due_date >= NOW() AND due_date <= NOW() + INTERVAL '30 days' THEN 1 END) as upcoming_requirements
      FROM compliance_requirements 
      WHERE workspace_id = $1
    `, [req.workspace_id]);

    // Recent submissions status
    const submissionStatusQuery = await db.query(`
      SELECT 
        submission_status,
        COUNT(*) as count,
        COUNT(CASE WHEN is_compliant = true THEN 1 END) as compliant_count
      FROM compliance_reports 
      WHERE workspace_id = $1 AND submitted_at >= NOW() - INTERVAL '90 days'
      GROUP BY submission_status
    `, [req.workspace_id]);

    // Compliance tasks
    const tasksQuery = await db.query(`
      SELECT 
        ct.task_type, ct.priority, ct.status, ct.due_date,
        crt.title as requirement_title,
        u.first_name as assigned_to_name
      FROM compliance_tasks ct
      JOIN compliance_requirements crt ON ct.requirement_id = crt.requirement_id
      LEFT JOIN users u ON ct.assigned_to = u.user_id
      WHERE ct.workspace_id = $1 AND ct.status != 'COMPLETED'
      ORDER BY ct.due_date ASC
      LIMIT 10
    `, [req.workspace_id]);

    // Compliance score by jurisdiction
    const jurisdictionScoreQuery = await db.query(`
      SELECT 
        crt.jurisdiction,
        COUNT(cr.report_id) as total_reports,
        COUNT(CASE WHEN cr.is_compliant = true THEN 1 END) as compliant_reports,
        ROUND(
          COUNT(CASE WHEN cr.is_compliant = true THEN 1 END) * 100.0 / 
          NULLIF(COUNT(cr.report_id), 0), 2
        ) as compliance_percentage
      FROM compliance_reports cr
      JOIN compliance_requirements crt ON cr.requirement_id = crt.requirement_id
      WHERE cr.workspace_id = $1 AND cr.submitted_at >= NOW() - INTERVAL '365 days'
      GROUP BY crt.jurisdiction
      ORDER BY compliance_percentage DESC
    `, [req.workspace_id]);

    // Upcoming deadlines
    const upcomingDeadlinesQuery = await db.query(`
      SELECT 
        requirement_id, title, due_date, jurisdiction, category,
        CASE 
          WHEN due_date < NOW() THEN 'OVERDUE'
          WHEN due_date <= NOW() + INTERVAL '7 days' THEN 'URGENT'
          WHEN due_date <= NOW() + INTERVAL '30 days' THEN 'UPCOMING'
          ELSE 'FUTURE'
        END as urgency_level
      FROM compliance_requirements 
      WHERE workspace_id = $1 AND status = 'ACTIVE'
        AND due_date >= NOW() - INTERVAL '1 day'
      ORDER BY due_date ASC
      LIMIT 20
    `, [req.workspace_id]);

    res.json({
      success: true,
      data: {
        status_overview: statusOverviewQuery.rows[0],
        submission_status: submissionStatusQuery.rows,
        pending_tasks: tasksQuery.rows,
        jurisdiction_scores: jurisdictionScoreQuery.rows,
        upcoming_deadlines: upcomingDeadlinesQuery.rows
      }
    });
  } catch (error) {
    console.error('Error fetching compliance dashboard:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch compliance dashboard data'
    });
  }
});

// Get compliance tasks
router.get('/tasks', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { status, priority, assigned_to } = req.query;

    let whereClause = 'WHERE ct.workspace_id = $1';
    const queryParams = [req.workspace_id];
    let paramCount = 1;

    if (status) {
      paramCount++;
      whereClause += ` AND ct.status = $${paramCount}`;
      queryParams.push(status);
    }

    if (priority) {
      paramCount++;
      whereClause += ` AND ct.priority = $${paramCount}`;
      queryParams.push(priority);
    }

    if (assigned_to) {
      paramCount++;
      whereClause += ` AND ct.assigned_to = $${paramCount}`;
      queryParams.push(assigned_to);
    }

    const tasksQuery = await db.query(`
      SELECT 
        ct.task_id, ct.task_type, ct.priority, ct.status,
        ct.due_date, ct.created_at,
        crt.title as requirement_title, crt.jurisdiction,
        u1.first_name as assigned_to_name, u1.email as assigned_to_email,
        u2.first_name as created_by_name
      FROM compliance_tasks ct
      JOIN compliance_requirements crt ON ct.requirement_id = crt.requirement_id
      LEFT JOIN users u1 ON ct.assigned_to = u1.user_id
      LEFT JOIN users u2 ON ct.created_by = u2.user_id
      ${whereClause}
      ORDER BY ct.due_date ASC
    `, queryParams);

    res.json({
      success: true,
      data: tasksQuery.rows
    });
  } catch (error) {
    console.error('Error fetching compliance tasks:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch compliance tasks'
    });
  }
});

// Update compliance task
router.put('/tasks/:task_id', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { task_id } = req.params;
    const { status, assigned_to, notes, completion_notes } = req.body;

    // Build dynamic update query
    const setClause = [];
    const queryParams = [req.workspace_id, task_id];
    let paramCount = 2;

    if (status) {
      paramCount++;
      setClause.push(`status = $${paramCount}`);
      queryParams.push(status);
      
      if (status === 'COMPLETED') {
        paramCount++;
        setClause.push(`completed_at = $${paramCount}`);
        queryParams.push(new Date());
      }
    }

    if (assigned_to) {
      paramCount++;
      setClause.push(`assigned_to = $${paramCount}`);
      queryParams.push(assigned_to);
    }

    if (notes) {
      paramCount++;
      setClause.push(`notes = $${paramCount}`);
      queryParams.push(notes);
    }

    if (completion_notes) {
      paramCount++;
      setClause.push(`completion_notes = $${paramCount}`);
      queryParams.push(completion_notes);
    }

    setClause.push('updated_at = NOW()');

    const updateQuery = await db.query(`
      UPDATE compliance_tasks 
      SET ${setClause.join(', ')}
      WHERE task_id = $2 AND workspace_id = $1
    `, queryParams);

    if (updateQuery.rowCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'Compliance task not found'
      });
    }

    res.json({
      success: true,
      message: 'Compliance task updated successfully'
    });
  } catch (error) {
    console.error('Error updating compliance task:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update compliance task'
    });
  }
});

// Generate compliance report
router.post('/generate-report', authenticateToken, async (req: Request, res: Response) => {
  try {
    const {
      report_type, jurisdiction, date_range, include_attachments = false
    } = req.body;

    const reportId = uuidv4();

    // Generate different types of compliance reports
    let reportData = {};

    switch (report_type) {
      case 'compliance_overview':
        reportData = await generateComplianceOverview(req.workspace_id, date_range);
        break;
      case 'regulatory_summary':
        reportData = await generateRegulatorySummary(req.workspace_id, jurisdiction, date_range);
        break;
      case 'audit_trail':
        reportData = await generateAuditTrail(req.workspace_id, date_range);
        break;
      default:
        throw new Error('Invalid report type');
    }

    // Store generated report
    await db.query(`
      INSERT INTO generated_reports (
        report_id, workspace_id, report_type, report_data,
        jurisdiction, date_range, include_attachments,
        generated_by, generated_at, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
    `, [
      reportId, req.workspace_id, report_type, JSON.stringify(reportData),
      jurisdiction, JSON.stringify(date_range), include_attachments,
      req.user.id
    ]);

    res.json({
      success: true,
      data: {
        report_id: reportId,
        report_data: reportData
      }
    });
  } catch (error) {
    console.error('Error generating compliance report:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate compliance report'
    });
  }
});

// Helper functions for report generation
async function generateComplianceOverview(workspaceId, dateRange) {
  const query = await db.query(`
    SELECT 
      crt.jurisdiction,
      COUNT(cr.report_id) as total_reports,
      COUNT(CASE WHEN cr.is_compliant = true THEN 1 END) as compliant_reports,
      COUNT(CASE WHEN cr.overdue = true THEN 1 END) as overdue_reports,
      AVG(CASE WHEN cr.is_compliant THEN 100 ELSE 0 END) as avg_compliance_score
    FROM compliance_reports cr
    JOIN compliance_requirements crt ON cr.requirement_id = crt.requirement_id
    WHERE cr.workspace_id = $1
      AND cr.submitted_at >= $2 
      AND cr.submitted_at <= $3
    GROUP BY crt.jurisdiction
    ORDER BY total_reports DESC
  `, [workspaceId, dateRange.start, dateRange.end]);

  return {
    summary: query.rows,
    generated_at: new Date().toISOString(),
    date_range: dateRange
  };
}

async function generateRegulatorySummary(workspaceId, jurisdiction, dateRange) {
  const query = await db.query(`
    SELECT 
      crt.title, crt.category, crt.regulatory_body,
      cr.submission_status, cr.is_compliant, cr.submitted_at
    FROM compliance_reports cr
    JOIN compliance_requirements crt ON cr.requirement_id = crt.requirement_id
    WHERE cr.workspace_id = $1
      AND crt.jurisdiction = $2
      AND cr.submitted_at >= $3
      AND cr.submitted_at <= $4
    ORDER BY cr.submitted_at DESC
  `, [workspaceId, jurisdiction, dateRange.start, dateRange.end]);

  return {
    jurisdiction,
    reports: query.rows,
    generated_at: new Date().toISOString(),
    date_range: dateRange
  };
}

async function generateAuditTrail(workspaceId, dateRange) {
  const query = await db.query(`
    SELECT 
      al.table_name, al.action_type, al.record_id,
      al.old_values, al.new_values, al.timestamp,
      u.first_name as performed_by_name
    FROM audit_logs al
    LEFT JOIN users u ON al.performed_by = u.user_id
    WHERE al.workspace_id = $1
      AND al.timestamp >= $2
      AND al.timestamp <= $3
    ORDER BY al.timestamp DESC
    LIMIT 1000
  `, [workspaceId, dateRange.start, dateRange.end]);

  return {
    audit_entries: query.rows,
    generated_at: new Date().toISOString(),
    date_range: dateRange
  };
}

export default router;