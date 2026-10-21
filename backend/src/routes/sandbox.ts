import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../database/connection';
import { authenticateToken, requireRole } from '../middleware/auth';

const router = Router();

// Get sandbox environments
router.get('/environments', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { status, environment_type } = req.query;

    let whereClause = 'WHERE workspace_id = $1';
    const queryParams = [req.workspace_id];
    let paramCount = 1;

    if (status) {
      paramCount++;
      whereClause += ` AND status = $${paramCount}`;
      queryParams.push(status);
    }

    if (environment_type) {
      paramCount++;
      whereClause += ` AND environment_type = $${paramCount}`;
      queryParams.push(environment_type);
    }

    const environmentsQuery = await db.query(`
      SELECT 
        environment_id, environment_name, environment_type,
        status, configuration, resources, last_used,
        created_at, expires_at
      FROM sandbox_environments 
      ${whereClause}
      ORDER BY created_at DESC
    `, queryParams);

    res.json({
      success: true,
      data: environmentsQuery.rows
    });
  } catch (error) {
    console.error('Error fetching sandbox environments:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch sandbox environments'
    });
  }
});

// Create sandbox environment
router.post('/environments', authenticateToken, async (req: Request, res: Response) => {
  try {
    const {
      environment_name, environment_type, configuration,
      resources, expiration_hours = 24, clone_from_production = false
    } = req.body;

    const environmentId = uuidv4();
    const expiresAt = new Date(Date.now() + expiration_hours * 60 * 60 * 1000);

    // Default configurations for different environment types
    const defaultConfigs = {
      development: {
        database: { instances: 1, size: 'small' },
        api: { instances: 1, timeout: 30 },
        storage: { size: '10GB' },
        features: ['debug_mode', 'detailed_logging']
      },
      testing: {
        database: { instances: 1, size: 'medium' },
        api: { instances: 2, timeout: 15 },
        storage: { size: '25GB' },
        features: ['mock_data', 'performance_testing']
      },
      staging: {
        database: { instances: 2, size: 'large' },
        api: { instances: 3, timeout: 10 },
        storage: { size: '100GB' },
        features: ['production_like', 'load_testing']
      }
    };

    const config = { ...defaultConfigs[environment_type], ...configuration };

    await db.query(`
      INSERT INTO sandbox_environments (
        environment_id, workspace_id, environment_name, environment_type,
        configuration, resources, status, expires_at, created_at,
        created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9)
    `, [
      environmentId, req.workspace_id, environment_name, environment_type,
      JSON.stringify(config), JSON.stringify(resources), 'CREATING',
      expiresAt, req.user.id
    ]);

    // Simulate environment provisioning
    setTimeout(async () => {
      try {
        await db.query(`
          UPDATE sandbox_environments 
          SET status = $1, last_used = NOW()
          WHERE environment_id = $2 AND workspace_id = $3
        `, ['ACTIVE', environmentId, req.workspace_id]);

        // If cloning from production, simulate data copy
        if (clone_from_production) {
          await provisionEnvironmentData(environmentId, req.workspace_id);
        }
      } catch (error) {
        console.error('Error provisioning sandbox environment:', error);
        await db.query(`
          UPDATE sandbox_environments 
          SET status = $1, error_message = $2
          WHERE environment_id = $3 AND workspace_id = $4
        `, ['FAILED', error.message, environmentId, req.workspace_id]);
      }
    }, 5000);

    res.status(201).json({
      success: true,
      data: {
        environment_id: environmentId,
        status: 'CREATING',
        estimated_provisioning_time: '2-5 minutes',
        expires_at: expiresAt
      }
    });
  } catch (error) {
    console.error('Error creating sandbox environment:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create sandbox environment'
    });
  }
});

// Get sandbox environment details
router.get('/environments/:environment_id', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { environment_id } = req.params;

    // Get environment details
    const environmentQuery = await db.query(`
      SELECT 
        environment_id, environment_name, environment_type,
        status, configuration, resources, access_urls,
        last_used, created_at, expires_at, error_message
      FROM sandbox_environments 
      WHERE environment_id = $1 AND workspace_id = $2
    `, [environment_id, req.workspace_id]);

    if (environmentQuery.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Sandbox environment not found'
      });
    }

    const environment = environmentQuery.rows[0];

    // Get environment activity logs
    const logsQuery = await db.query(`
      SELECT 
        log_id, activity_type, description, status,
        created_at, metadata
      FROM sandbox_activity_logs 
      WHERE workspace_id = $1 AND environment_id = $2
      ORDER BY created_at DESC
      LIMIT 50
    `, [req.workspace_id, environment_id]);

    // Get environment metrics
    const metricsQuery = await db.query(`
      SELECT 
        metric_type, metric_value, recorded_at
      FROM sandbox_metrics 
      WHERE workspace_id = $1 AND environment_id = $2
        AND recorded_at >= NOW() - INTERVAL '24 hours'
      ORDER BY recorded_at DESC
      LIMIT 100
    `, [req.workspace_id, environment_id]);

    res.json({
      success: true,
      data: {
        environment: {
          ...environment,
          configuration: JSON.parse(environment.configuration),
          resources: JSON.parse(environment.resources),
          access_urls: JSON.parse(environment.access_urls || '{}')
        },
        activity_logs: logsQuery.rows.map(log => ({
          ...log,
          metadata: JSON.parse(log.metadata || '{}')
        })),
        metrics: metricsQuery.rows
      }
    });
  } catch (error) {
    console.error('Error fetching sandbox environment details:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch sandbox environment details'
    });
  }
});

// Start sandbox environment
router.post('/environments/:environment_id/start', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { environment_id } = req.params;

    // Update environment status
    await db.query(`
      UPDATE sandbox_environments 
      SET status = $1, last_used = NOW(), updated_at = NOW()
      WHERE environment_id = $2 AND workspace_id = $3
    `, ['STARTING', environment_id, req.workspace_id]);

    // Log activity
    await logSandboxActivity(req.workspace_id, environment_id, 'START', 
      'Environment start initiated', req.user.id);

    // Simulate environment startup
    setTimeout(async () => {
      try {
        await db.query(`
          UPDATE sandbox_environments 
          SET status = $1, last_used = NOW()
          WHERE environment_id = $2 AND workspace_id = $3
        `, ['ACTIVE', environment_id, req.workspace_id]);

        await logSandboxActivity(req.workspace_id, environment_id, 'START_SUCCESS', 
          'Environment started successfully', req.user.id);
      } catch (error) {
        await db.query(`
          UPDATE sandbox_environments 
          SET status = $1, error_message = $2
          WHERE environment_id = $3 AND workspace_id = $4
        `, ['FAILED', error.message, environment_id, req.workspace_id]);

        await logSandboxActivity(req.workspace_id, environment_id, 'START_FAILED', 
          `Environment start failed: ${error.message}`, req.user.id);
      }
    }, 3000);

    res.json({
      success: true,
      message: 'Environment start initiated',
      estimated_startup_time: '30-60 seconds'
    });
  } catch (error) {
    console.error('Error starting sandbox environment:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to start sandbox environment'
    });
  }
});

// Stop sandbox environment
router.post('/environments/:environment_id/stop', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { environment_id } = req.params;

    await db.query(`
      UPDATE sandbox_environments 
      SET status = $1, updated_at = NOW()
      WHERE environment_id = $2 AND workspace_id = $3
    `, ['STOPPING', environment_id, req.workspace_id]);

    await logSandboxActivity(req.workspace_id, environment_id, 'STOP', 
      'Environment stop initiated', req.user.id);

    setTimeout(async () => {
      await db.query(`
        UPDATE sandbox_environments 
        SET status = $1
        WHERE environment_id = $2 AND workspace_id = $3
      `, ['STOPPED', environment_id, req.workspace_id]);

      await logSandboxActivity(req.workspace_id, environment_id, 'STOP_SUCCESS', 
        'Environment stopped successfully', req.user.id);
    }, 2000);

    res.json({
      success: true,
      message: 'Environment stop initiated'
    });
  } catch (error) {
    console.error('Error stopping sandbox environment:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to stop sandbox environment'
    });
  }
});

// Delete sandbox environment
router.delete('/environments/:environment_id', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { environment_id } = req.params;

    await db.query(`
      UPDATE sandbox_environments 
      SET status = $1, deleted_at = NOW()
      WHERE environment_id = $2 AND workspace_id = $3
    `, ['DELETING', environment_id, req.workspace_id]);

    await logSandboxActivity(req.workspace_id, environment_id, 'DELETE', 
      'Environment deletion initiated', req.user.id);

    // Actually delete after a delay
    setTimeout(async () => {
      await db.query(`
        DELETE FROM sandbox_environments 
        WHERE environment_id = $1 AND workspace_id = $2
      `, [environment_id, req.workspace_id]);
    }, 10000);

    res.json({
      success: true,
      message: 'Environment deletion initiated',
      permanent_deletion_in: '10 seconds'
    });
  } catch (error) {
    console.error('Error deleting sandbox environment:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete sandbox environment'
    });
  }
});

// Clone production data to sandbox
router.post('/environments/:environment_id/clone-data', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { environment_id } = req.params;
    const { data_types = ['policies', 'customers'], exclude_sensitive = true } = req.body;

    await logSandboxActivity(req.workspace_id, environment_id, 'CLONE_START', 
      `Data clone initiated for: ${data_types.join(', ')}`, req.user.id);

    // Simulate data cloning process
    const cloneId = uuidv4();
    const cloneResults = {
      clone_id: cloneId,
      data_types: data_types,
      records_copied: {},
      estimated_completion: '5-10 minutes'
    };

    data_types.forEach(dataType => {
      cloneResults.records_copied[dataType] = Math.floor(Math.random() * 10000) + 1000;
    });

    // Store clone job
    await db.query(`
      INSERT INTO data_clone_jobs (
        job_id, workspace_id, environment_id, data_types,
        status, records_copied, started_at, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7)
    `, [
      cloneId, req.workspace_id, environment_id, JSON.stringify(data_types),
      'RUNNING', JSON.stringify(cloneResults.records_copied), req.user.id
    ]);

    // Simulate completion
    setTimeout(async () => {
      await db.query(`
        UPDATE data_clone_jobs 
        SET status = $1, completed_at = NOW()
        WHERE job_id = $2 AND workspace_id = $3
      `, ['COMPLETED', cloneId, req.workspace_id]);

      await logSandboxActivity(req.workspace_id, environment_id, 'CLONE_SUCCESS', 
        'Data clone completed successfully', req.user.id);
    }, 8000);

    res.json({
      success: true,
      data: cloneResults
    });
  } catch (error) {
    console.error('Error cloning data to sandbox:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to clone data to sandbox'
    });
  }
});

// Get sandbox templates
router.get('/templates', authenticateToken, async (req: Request, res: Response) => {
  try {
    const templatesQuery = await db.query(`
      SELECT 
        template_id, template_name, description, environment_type,
        configuration, resources, estimated_cost, popularity_score,
        created_at, is_public
      FROM sandbox_templates 
      WHERE is_public = true OR workspace_id = $1
      ORDER BY popularity_score DESC, created_at DESC
    `, [req.workspace_id]);

    res.json({
      success: true,
      data: templatesQuery.rows.map(template => ({
        ...template,
        configuration: JSON.parse(template.configuration),
        resources: JSON.parse(template.resources)
      }))
    });
  } catch (error) {
    console.error('Error fetching sandbox templates:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch sandbox templates'
    });
  }
});

// Create sandbox from template
router.post('/from-template/:template_id', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { template_id } = req.params;
    const { environment_name, expiration_hours = 24 } = req.body;

    // Get template
    const templateQuery = await db.query(`
      SELECT * FROM sandbox_templates 
      WHERE template_id = $1 AND (is_public = true OR workspace_id = $2)
    `, [template_id, req.workspace_id]);

    if (templateQuery.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Sandbox template not found'
      });
    }

    const template = templateQuery.rows[0];
    const environmentId = uuidv4();
    const expiresAt = new Date(Date.now() + expiration_hours * 60 * 60 * 1000);

    await db.query(`
      INSERT INTO sandbox_environments (
        environment_id, workspace_id, environment_name, environment_type,
        configuration, resources, status, expires_at, created_at,
        created_by, template_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9, $10)
    `, [
      environmentId, req.workspace_id, environment_name, template.environment_type,
      template.configuration, template.resources, 'CREATING',
      expiresAt, req.user.id, template_id
    ]);

    // Simulate provisioning
    setTimeout(async () => {
      await db.query(`
        UPDATE sandbox_environments 
        SET status = $1, last_used = NOW()
        WHERE environment_id = $2 AND workspace_id = $3
      `, ['ACTIVE', environmentId, req.workspace_id]);
    }, 3000);

    res.status(201).json({
      success: true,
      data: {
        environment_id: environmentId,
        template_name: template.template_name,
        status: 'CREATING'
      }
    });
  } catch (error) {
    console.error('Error creating environment from template:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create environment from template'
    });
  }
});

// Get sandbox dashboard
router.get('/dashboard', authenticateToken, async (req: Request, res: Response) => {
  try {
    // Environment summary
    const environmentSummaryQuery = await db.query(`
      SELECT 
        environment_type,
        COUNT(*) as total_environments,
        COUNT(CASE WHEN status = 'ACTIVE' THEN 1 END) as active_environments,
        COUNT(CASE WHEN expires_at < NOW() THEN 1 END) as expired_environments,
        AVG(EXTRACT(EPOCH FROM (expires_at - created_at))/3600) as avg_lifetime_hours
      FROM sandbox_environments 
      WHERE workspace_id = $1 AND status != 'DELETED'
      GROUP BY environment_type
    `, [req.workspace_id]);

    // Usage statistics
    const usageStatsQuery = await db.query(`
      SELECT 
        COUNT(*) as total_environments_created,
        COUNT(CASE WHEN created_at >= NOW() - INTERVAL '30 days' THEN 1 END) as created_last_30d,
        COUNT(CASE WHEN last_used >= NOW() - INTERVAL '7 days' THEN 1 END) as used_last_7d,
        AVG(EXTRACT(EPOCH FROM (COALESCE(last_used, expires_at) - created_at))/3600) as avg_usage_hours
      FROM sandbox_environments 
      WHERE workspace_id = $1
    `, [req.workspace_id]);

    // Resource utilization
    const resourceUtilizationQuery = await db.query(`
      SELECT 
        resource_type,
        SUM(CASE WHEN status = 'ACTIVE' THEN allocated_amount ELSE 0 END) as total_allocated,
        SUM(CASE WHEN status = 'ACTIVE' THEN used_amount ELSE 0 END) as total_used,
        ROUND(
          SUM(CASE WHEN status = 'ACTIVE' THEN used_amount ELSE 0 END) * 100.0 /
          NULLIF(SUM(CASE WHEN status = 'ACTIVE' THEN allocated_amount ELSE 0 END), 0), 2
        ) as utilization_percentage
      FROM resource_usage 
      WHERE workspace_id = $1 AND date_recorded >= NOW() - INTERVAL '24 hours'
      GROUP BY resource_type
    `, [req.workspace_id]);

    // Recent activity
    const recentActivityQuery = await db.query(`
      SELECT 
        se.environment_name, se.environment_type, sal.activity_type,
        sal.description, sal.created_at, u.first_name as performed_by_name
      FROM sandbox_activity_logs sal
      JOIN sandbox_environments se ON sal.environment_id = se.environment_id
      LEFT JOIN users u ON sal.performed_by = u.user_id
      WHERE sal.workspace_id = $1
      ORDER BY sal.created_at DESC
      LIMIT 10
    `, [req.workspace_id]);

    res.json({
      success: true,
      data: {
        environment_summary: environmentSummaryQuery.rows,
        usage_statistics: usageStatsQuery.rows[0] || {
          total_environments_created: 0,
          created_last_30d: 0,
          used_last_7d: 0,
          avg_usage_hours: 0
        },
        resource_utilization: resourceUtilizationQuery.rows,
        recent_activity: recentActivityQuery.rows
      }
    });
  } catch (error) {
    console.error('Error fetching sandbox dashboard:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch sandbox dashboard data'
    });
  }
});

// Helper functions
async function provisionEnvironmentData(environmentId, workspaceId) {
  // Simulate provisioning sample data
  const sampleData = {
    policies: Math.floor(Math.random() * 100) + 50,
    customers: Math.floor(Math.random() * 200) + 100,
    claims: Math.floor(Math.random() * 50) + 25,
    documents: Math.floor(Math.random() * 500) + 200
  };

  await db.query(`
    INSERT INTO sandbox_data_snapshots (
      snapshot_id, workspace_id, environment_id, data_type,
      record_count, snapshot_date
    ) VALUES ($1, $2, $3, $4, $5, NOW())
  `, [
    uuidv4(), workspaceId, environmentId, 'SAMPLE_DATA',
    JSON.stringify(sampleData)
  ]);
}

async function logSandboxActivity(workspaceId, environmentId, activityType, description, userId) {
  await db.query(`
    INSERT INTO sandbox_activity_logs (
      log_id, workspace_id, environment_id, activity_type,
      description, performed_by, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
  `, [
    uuidv4(), workspaceId, environmentId, activityType,
    description, userId
  ]);
}

export default router;