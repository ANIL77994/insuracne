import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../database/connection';
import { authenticateToken, requireRole } from '../middleware/auth';

const router = Router();

// Get all workflow definitions
router.get('/workflows', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { status, category } = req.query;

    let whereClause = 'WHERE workspace_id = $1';
    const queryParams = [req.workspace_id];
    let paramCount = 1;

    if (status) {
      paramCount++;
      whereClause += ` AND status = $${paramCount}`;
      queryParams.push(status);
    }

    if (category) {
      paramCount++;
      whereClause += ` AND category = $${paramCount}`;
      queryParams.push(category);
    }

    const workflowsQuery = await db.query(`
      SELECT 
        workflow_id, name, description, category, version,
        status, is_active, created_by, created_at, updated_at
      FROM workflow_definitions 
      ${whereClause}
      ORDER BY created_at DESC
    `, queryParams);

    res.json({
      success: true,
      data: workflowsQuery.rows
    });
  } catch (error) {
    console.error('Error fetching workflows:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch workflows'
    });
  }
});

// Create new workflow definition
router.post('/workflows', authenticateToken, requireRole(['admin', 'manager']), async (req: Request, res: Response) => {
  try {
    const {
      name, description, category, version, workflow_steps,
      approval_rules, escalation_rules, sla_config
    } = req.body;

    const workflowId = uuidv4();

    await db.query(`
      INSERT INTO workflow_definitions (
        workflow_id, workspace_id, name, description, category, version,
        workflow_steps, approval_rules, escalation_rules, sla_config,
        status, is_active, created_by, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
    `, [
      workflowId, req.workspace_id, name, description, category, version,
      JSON.stringify(workflow_steps), JSON.stringify(approval_rules),
      JSON.stringify(escalation_rules), JSON.stringify(sla_config),
      'DRAFT', true, req.user.id
    ]);

    res.status(201).json({
      success: true,
      data: { workflow_id: workflowId }
    });
  } catch (error) {
    console.error('Error creating workflow:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create workflow'
    });
  }
});

// Start workflow instance
router.post('/instances', authenticateToken, async (req: Request, res: Response) => {
  try {
    const {
      workflow_id, entity_type, entity_id, 
      priority = 'normal', initiated_by, context_data
    } = req.body;

    // Get workflow definition
    const workflowQuery = await db.query(`
      SELECT workflow_steps, approval_rules, escalation_rules, sla_config
      FROM workflow_definitions 
      WHERE workflow_id = $1 AND workspace_id = $2 AND is_active = true
    `, [workflow_id, req.workspace_id]);

    if (workflowQuery.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Workflow definition not found'
      });
    }

    const workflow = workflowQuery.rows[0];
    const workflowSteps = JSON.parse(workflow.workflow_steps);
    
    const instanceId = uuidv4();

    // Create workflow instance
    await db.query(`
      INSERT INTO workflow_instances (
        instance_id, workspace_id, workflow_id, entity_type, entity_id,
        status, priority, current_step, context_data,
        initiated_by, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
    `, [
      instanceId, req.workspace_id, workflow_id, entity_type, entity_id,
      'RUNNING', priority, workflowSteps[0]?.step_id || null,
      JSON.stringify(context_data), initiated_by || req.user.id
    ]);

    // Create initial workflow step instance
    if (workflowSteps.length > 0) {
      const firstStep = workflowSteps[0];
      await createWorkflowStepInstance(instanceId, firstStep, req.workspace_id);
    }

    res.status(201).json({
      success: true,
      data: { instance_id: instanceId }
    });
  } catch (error) {
    console.error('Error starting workflow:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to start workflow'
    });
  }
});

// Get workflow instances
router.get('/instances', authenticateToken, async (req: Request, res: Response) => {
  try {
    const {
      status, entity_type, workflow_id, priority,
      page = 1, limit = 20
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);
    
    let whereClause = 'WHERE wi.workspace_id = $1';
    const queryParams = [req.workspace_id];
    let paramCount = 1;

    if (status) {
      paramCount++;
      whereClause += ` AND wi.status = $${paramCount}`;
      queryParams.push(status);
    }

    if (entity_type) {
      paramCount++;
      whereClause += ` AND wi.entity_type = $${paramCount}`;
      queryParams.push(entity_type);
    }

    if (workflow_id) {
      paramCount++;
      whereClause += ` AND wi.workflow_id = $${paramCount}`;
      queryParams.push(workflow_id);
    }

    if (priority) {
      paramCount++;
      whereClause += ` AND wi.priority = $${paramCount}`;
      queryParams.push(priority);
    }

    const instancesQuery = await db.query(`
      SELECT 
        wi.instance_id, wi.status, wi.priority, wi.current_step,
        wi.context_data, wi.created_at, wi.updated_at,
        wd.name as workflow_name, wd.category as workflow_category,
        wi.entity_type, wi.entity_id,
        u1.first_name as initiated_by_name,
        u2.first_name as current_assignee_name
      FROM workflow_instances wi
      JOIN workflow_definitions wd ON wi.workflow_id = wd.workflow_id
      LEFT JOIN users u1 ON wi.initiated_by = u1.user_id
      LEFT JOIN users u2 ON wi.current_assignee = u2.user_id
      ${whereClause}
      ORDER BY wi.created_at DESC
      LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}
    `, [...queryParams, parseInt(limit), offset]);

    const countQuery = await db.query(`
      SELECT COUNT(*) as total
      FROM workflow_instances wi
      ${whereClause}
    `, queryParams);

    res.json({
      success: true,
      data: {
        instances: instancesQuery.rows,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: parseInt(countQuery.rows[0].total),
          pages: Math.ceil(parseInt(countQuery.rows[0].total) / parseInt(limit))
        }
      }
    });
  } catch (error) {
    console.error('Error fetching workflow instances:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch workflow instances'
    });
  }
});

// Get workflow instance details
router.get('/instances/:instance_id', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { instance_id } = req.params;

    // Get workflow instance
    const instanceQuery = await db.query(`
      SELECT 
        wi.instance_id, wi.status, wi.priority, wi.current_step,
        wi.context_data, wi.created_at, wi.updated_at,
        wd.name as workflow_name, wd.description as workflow_description,
        wd.category as workflow_category, wd.version,
        wi.entity_type, wi.entity_id,
        u1.first_name as initiated_by_name, u1.email as initiated_by_email
      FROM workflow_instances wi
      JOIN workflow_definitions wd ON wi.workflow_id = wd.workflow_id
      LEFT JOIN users u1 ON wi.initiated_by = u1.user_id
      WHERE wi.instance_id = $1 AND wi.workspace_id = $2
    `, [instance_id, req.workspace_id]);

    if (instanceQuery.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Workflow instance not found'
      });
    }

    // Get workflow step instances
    const stepsQuery = await db.query(`
      SELECT 
        wsi.step_id, wsi.step_name, wsi.status, wsi.assigned_to,
        wsi.due_date, wsi.completed_at, wsi.comments, wsi.step_data,
        u.first_name as assignee_name, u.email as assignee_email,
        wsi.created_at
      FROM workflow_step_instances wsi
      LEFT JOIN users u ON wsi.assigned_to = u.user_id
      WHERE wsi.instance_id = $1 AND wsi.workspace_id = $2
      ORDER BY wsi.step_order
    `, [instance_id, req.workspace_id]);

    // Get workflow history
    const historyQuery = await db.query(`
      SELECT 
        wh.action_type, wh.step_name, wh.performed_by,
        wh.timestamp, wh.details, wh.comments,
        u.first_name as performed_by_name
      FROM workflow_history wh
      LEFT JOIN users u ON wh.performed_by = u.user_id
      WHERE wh.instance_id = $1 AND wh.workspace_id = $2
      ORDER BY wh.timestamp DESC
    `, [instance_id, req.workspace_id]);

    res.json({
      success: true,
      data: {
        instance: instanceQuery.rows[0],
        steps: stepsQuery.rows,
        history: historyQuery.rows
      }
    });
  } catch (error) {
    console.error('Error fetching workflow instance:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch workflow instance details'
    });
  }
});

// Complete workflow step
router.post('/instances/:instance_id/steps/:step_id/complete', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { instance_id, step_id } = req.params;
    const { action, comments, step_data, next_assignee } = req.body;

    // Get workflow step instance
    const stepQuery = await db.query(`
      SELECT wsi.step_id, wsi.status, wsi.step_name, wi.workflow_id,
             wi.entity_type, wi.entity_id, wd.workflow_steps
      FROM workflow_step_instances wsi
      JOIN workflow_instances wi ON wsi.instance_id = wi.instance_id
      JOIN workflow_definitions wd ON wi.workflow_id = wd.workflow_id
      WHERE wsi.instance_id = $1 AND wsi.step_id = $2 AND wsi.workspace_id = $3
    `, [instance_id, step_id, req.workspace_id]);

    if (stepQuery.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Workflow step not found'
      });
    }

    const step = stepQuery.rows[0];
    const workflowSteps = JSON.parse(step.workflow_steps);

    // Update step instance
    await db.query(`
      UPDATE workflow_step_instances 
      SET status = $1, completed_at = NOW(), comments = $2, 
          step_data = $3, updated_at = NOW()
      WHERE instance_id = $4 AND step_id = $5 AND workspace_id = $6
    `, [action === 'approve' ? 'COMPLETED' : action === 'reject' ? 'REJECTED' : 'COMPLETED',
       comments, JSON.stringify(step_data), instance_id, step_id, req.workspace_id]);

    // Log workflow history
    await db.query(`
      INSERT INTO workflow_history (
        history_id, workspace_id, instance_id, step_name,
        action_type, performed_by, timestamp, details, comments
      ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7, $8)
    `, [
      uuidv4(), req.workspace_id, instance_id, step.step_name,
      action.toUpperCase(), req.user.id, JSON.stringify(step_data), comments
    ]);

    // Determine next steps
    const currentStepIndex = workflowSteps.findIndex(s => s.step_id === step_id);
    let workflowStatus = 'RUNNING';
    let nextStep = null;

    if (action === 'approve') {
      // Move to next step
      if (currentStepIndex < workflowSteps.length - 1) {
        nextStep = workflowSteps[currentStepIndex + 1];
        await createWorkflowStepInstance(instance_id, nextStep, req.workspace_id);
        
        // Update instance current step
        await db.query(`
          UPDATE workflow_instances 
          SET current_step = $1, current_assignee = $2, updated_at = NOW()
          WHERE instance_id = $3 AND workspace_id = $4
        `, [nextStep.step_id, next_assignee || null, instance_id, req.workspace_id]);
      } else {
        // Workflow completed
        workflowStatus = 'COMPLETED';
        await db.query(`
          UPDATE workflow_instances 
          SET status = $1, current_step = NULL, current_assignee = NULL, 
              completed_at = NOW(), updated_at = NOW()
          WHERE instance_id = $2 AND workspace_id = $3
        `, [workflowStatus, instance_id, req.workspace_id]);
      }
    } else if (action === 'reject') {
      // Workflow rejected
      workflowStatus = 'REJECTED';
      await db.query(`
        UPDATE workflow_instances 
        SET status = $1, current_step = NULL, current_assignee = NULL,
            completed_at = NOW(), updated_at = NOW()
        WHERE instance_id = $2 AND workspace_id = $3
      `, [workflowStatus, instance_id, req.workspace_id]);
    }

    res.json({
      success: true,
      data: {
        workflow_status: workflowStatus,
        next_step: nextStep
      }
    });
  } catch (error) {
    console.error('Error completing workflow step:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to complete workflow step'
    });
  }
});

// Helper function to create workflow step instance
async function createWorkflowStepInstance(instanceId, step, workspaceId) {
  const stepInstanceId = uuidv4();
  
  await db.query(`
    INSERT INTO workflow_step_instances (
      step_instance_id, workspace_id, instance_id, step_id, step_name,
      step_order, status, assigned_to, due_date, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
  `, [
    stepInstanceId, workspaceId, instanceId, step.step_id, step.step_name,
    step.step_order || 1, 'PENDING', step.assigned_to || null,
    step.due_date ? new Date(step.due_date) : null
  ]);
}

// Get workflow dashboard
router.get('/dashboard', authenticateToken, async (req: Request, res: Response) => {
  try {
    // Workflow instance counts by status
    const statusCountsQuery = await db.query(`
      SELECT 
        status,
        COUNT(*) as count,
        COUNT(CASE WHEN priority = 'high' THEN 1 END) as high_priority_count
      FROM workflow_instances 
      WHERE workspace_id = $1
      GROUP BY status
    `, [req.workspace_id]);

    // Overdue workflow steps
    const overdueStepsQuery = await db.query(`
      SELECT 
        wsi.step_instance_id, wsi.step_name, wsi.due_date,
        wi.instance_id, wi.entity_type, wi.entity_id,
        u.first_name as assignee_name
      FROM workflow_step_instances wsi
      JOIN workflow_instances wi ON wsi.instance_id = wi.instance_id
      LEFT JOIN users u ON wsi.assigned_to = u.user_id
      WHERE wsi.workspace_id = $1 
        AND wsi.status = 'PENDING' 
        AND wsi.due_date < NOW()
      ORDER BY wsi.due_date ASC
      LIMIT 10
    `, [req.workspace_id]);

    // Workflow performance metrics
    const performanceQuery = await db.query(`
      SELECT 
        wd.name as workflow_name,
        wd.category,
        COUNT(wi.instance_id) as total_instances,
        COUNT(CASE WHEN wi.status = 'COMPLETED' THEN 1 END) as completed_instances,
        AVG(EXTRACT(EPOCH FROM (wi.completed_at - wi.created_at))/3600) as avg_completion_hours
      FROM workflow_definitions wd
      LEFT JOIN workflow_instances wi ON wd.workflow_id = wi.workflow_id
      WHERE wd.workspace_id = $1
        AND wi.created_at >= NOW() - INTERVAL '30 days'
      GROUP BY wd.workflow_id, wd.name, wd.category
      ORDER BY total_instances DESC
    `, [req.workspace_id]);

    // Recent workflow activity
    const recentActivityQuery = await db.query(`
      SELECT 
        wh.instance_id, wh.action_type, wh.step_name, wh.timestamp,
        wd.name as workflow_name, wi.entity_type, wi.entity_id,
        u.first_name as performed_by_name
      FROM workflow_history wh
      JOIN workflow_instances wi ON wh.instance_id = wi.instance_id
      JOIN workflow_definitions wd ON wi.workflow_id = wd.workflow_id
      LEFT JOIN users u ON wh.performed_by = u.user_id
      WHERE wh.workspace_id = $1
      ORDER BY wh.timestamp DESC
      LIMIT 10
    `, [req.workspace_id]);

    res.json({
      success: true,
      data: {
        status_counts: statusCountsQuery.rows,
        overdue_steps: overdueStepsQuery.rows,
        performance_metrics: performanceQuery.rows,
        recent_activity: recentActivityQuery.rows
      }
    });
  } catch (error) {
    console.error('Error fetching workflow dashboard:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch workflow dashboard data'
    });
  }
});

// Cancel workflow instance
router.post('/instances/:instance_id/cancel', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { instance_id } = req.params;
    const { reason } = req.body;

    // Update workflow instance status
    await db.query(`
      UPDATE workflow_instances 
      SET status = 'CANCELLED', completed_at = NOW(), updated_at = NOW()
      WHERE instance_id = $1 AND workspace_id = $2
    `, [instance_id, req.workspace_id]);

    // Log cancellation in history
    await db.query(`
      INSERT INTO workflow_history (
        history_id, workspace_id, instance_id, step_name,
        action_type, performed_by, timestamp, details, comments
      ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7, $8)
    `, [
      uuidv4(), req.workspace_id, instance_id, 'Workflow Cancelled',
      'CANCEL', req.user.id, JSON.stringify({ reason }), reason
    ]);

    res.json({
      success: true,
      message: 'Workflow instance cancelled successfully'
    });
  } catch (error) {
    console.error('Error cancelling workflow:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to cancel workflow instance'
    });
  }
});

export default router;