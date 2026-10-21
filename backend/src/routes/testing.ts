import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../database/connection';
import { authenticateToken, requireRole } from '../middleware/auth';

const router = Router();

// Get test suites
router.get('/suites', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { test_type, status, category } = req.query;

    let whereClause = 'WHERE workspace_id = $1';
    const queryParams = [req.workspace_id];
    let paramCount = 1;

    if (test_type) {
      paramCount++;
      whereClause += ` AND test_type = $${paramCount}`;
      queryParams.push(test_type);
    }

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

    const suitesQuery = await db.query(`
      SELECT 
        suite_id, suite_name, test_type, category,
        description, status, total_tests, passed_tests,
        failed_tests, skipped_tests, execution_time,
        created_at, last_run_at
      FROM test_suites 
      ${whereClause}
      ORDER BY created_at DESC
    `, queryParams);

    res.json({
      success: true,
      data: suitesQuery.rows
    });
  } catch (error) {
    console.error('Error fetching test suites:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch test suites'
    });
  }
});

// Create test suite
router.post('/suites', authenticateToken, requireRole(['admin', 'developer']), async (req: Request, res: Response) => {
  try {
    const {
      suite_name, test_type, category, description,
      test_cases, configuration, environment_id
    } = req.body;

    const suiteId = uuidv4();

    await db.query(`
      INSERT INTO test_suites (
        suite_id, workspace_id, suite_name, test_type, category,
        description, test_cases, configuration, environment_id,
        status, created_at, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), $11)
    `, [
      suiteId, req.workspace_id, suite_name, test_type, category,
      description, JSON.stringify(test_cases), JSON.stringify(configuration),
      environment_id, 'DRAFT', req.user.id
    ]);

    res.status(201).json({
      success: true,
      data: { suite_id: suiteId }
    });
  } catch (error) {
    console.error('Error creating test suite:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create test suite'
    });
  }
});

// Run test suite
router.post('/suites/:suite_id/run', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { suite_id } = req.params;
    const { environment_id, parallel_execution = false, timeout = 300 } = req.body;

    // Get test suite
    const suiteQuery = await db.query(`
      SELECT * FROM test_suites 
      WHERE suite_id = $1 AND workspace_id = $2
    `, [suite_id, req.workspace_id]);

    if (suiteQuery.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Test suite not found'
      });
    }

    const suite = suiteQuery.rows[0];
    const testCases = JSON.parse(suite.test_cases);
    const executionId = uuidv4();

    // Create execution record
    await db.query(`
      INSERT INTO test_executions (
        execution_id, workspace_id, suite_id, environment_id,
        status, started_at, execution_config, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [
      executionId, req.workspace_id, suite_id, environment_id,
      'RUNNING', new Date(), JSON.stringify({
        parallel_execution, timeout
      }), req.user.id
    ]);

    // Update suite status
    await db.query(`
      UPDATE test_suites 
      SET status = $1, last_run_at = NOW()
      WHERE suite_id = $2 AND workspace_id = $3
    `, ['RUNNING', suite_id, req.workspace_id]);

    // Execute tests
    executeTestSuite(executionId, suite, testCases, req.workspace_id);

    res.json({
      success: true,
      data: {
        execution_id: executionId,
        status: 'RUNNING',
        estimated_duration: `${Math.ceil(testCases.length * 2)} minutes`
      }
    });
  } catch (error) {
    console.error('Error running test suite:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to run test suite'
    });
  }
});

// Get test execution results
router.get('/executions/:execution_id', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { execution_id } = req.params;

    // Get execution details
    const executionQuery = await db.query(`
      SELECT 
        te.execution_id, te.status, te.started_at, te.completed_at,
        te.execution_time, te.execution_config, te.error_message,
        ts.suite_name, ts.test_type, ts.category,
        se.environment_name, u.first_name as executed_by_name
      FROM test_executions te
      JOIN test_suites ts ON te.suite_id = ts.suite_id
      LEFT JOIN sandbox_environments se ON te.environment_id = se.environment_id
      LEFT JOIN users u ON te.created_by = u.user_id
      WHERE te.execution_id = $1 AND te.workspace_id = $2
    `, [execution_id, req.workspace_id]);

    if (executionQuery.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Test execution not found'
      });
    }

    // Get test results
    const resultsQuery = await db.query(`
      SELECT 
        result_id, test_case_name, test_case_id, status,
        execution_time, error_message, screenshots, logs,
        metadata, started_at, completed_at
      FROM test_results 
      WHERE workspace_id = $1 AND execution_id = $2
      ORDER BY test_case_name
    `, [req.workspace_id, execution_id]);

    // Calculate summary statistics
    const summary = {
      total_tests: resultsQuery.rows.length,
      passed_tests: resultsQuery.rows.filter(r => r.status === 'PASSED').length,
      failed_tests: resultsQuery.rows.filter(r => r.status === 'FAILED').length,
      skipped_tests: resultsQuery.rows.filter(r => r.status === 'SKIPPED').length,
      total_execution_time: resultsQuery.rows.reduce((sum, r) => sum + (r.execution_time || 0), 0)
    };

    summary.pass_rate = summary.total_tests > 0 ? 
      (summary.passed_tests / summary.total_tests * 100).toFixed(2) : 0;

    res.json({
      success: true,
      data: {
        execution: {
          ...executionQuery.rows[0],
          execution_config: JSON.parse(executionQuery.rows[0].execution_config || '{}')
        },
        summary,
        results: resultsQuery.rows.map(result => ({
          ...result,
          screenshots: JSON.parse(result.screenshots || '[]'),
          logs: JSON.parse(result.logs || '{}'),
          metadata: JSON.parse(result.metadata || '{}')
        }))
      }
    });
  } catch (error) {
    console.error('Error fetching test execution results:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch test execution results'
    });
  }
});

// Get test executions
router.get('/executions', authenticateToken, async (req: Request, res: Response) => {
  try {
    const {
      suite_id, status, test_type, date_from, date_to,
      page = 1, limit = 20
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);

    let whereClause = 'WHERE te.workspace_id = $1';
    const queryParams = [req.workspace_id];
    let paramCount = 1;

    if (suite_id) {
      paramCount++;
      whereClause += ` AND te.suite_id = $${paramCount}`;
      queryParams.push(suite_id);
    }

    if (status) {
      paramCount++;
      whereClause += ` AND te.status = $${paramCount}`;
      queryParams.push(status);
    }

    if (test_type) {
      paramCount++;
      whereClause += ` AND ts.test_type = $${paramCount}`;
      queryParams.push(test_type);
    }

    if (date_from) {
      paramCount++;
      whereClause += ` AND te.started_at >= $${paramCount}`;
      queryParams.push(date_from);
    }

    if (date_to) {
      paramCount++;
      whereClause += ` AND te.started_at <= $${paramCount}`;
      queryParams.push(date_to);
    }

    const executionsQuery = await db.query(`
      SELECT 
        te.execution_id, te.status, te.started_at, te.completed_at,
        te.execution_time, ts.suite_name, ts.test_type, ts.category,
        se.environment_name, u.first_name as executed_by_name
      FROM test_executions te
      JOIN test_suites ts ON te.suite_id = ts.suite_id
      LEFT JOIN sandbox_environments se ON te.environment_id = se.environment_id
      LEFT JOIN users u ON te.created_by = u.user_id
      ${whereClause}
      ORDER BY te.started_at DESC
      LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}
    `, [...queryParams, parseInt(limit), offset]);

    const countQuery = await db.query(`
      SELECT COUNT(*) as total
      FROM test_executions te
      JOIN test_suites ts ON te.suite_id = ts.suite_id
      ${whereClause}
    `, queryParams);

    res.json({
      success: true,
      data: {
        executions: executionsQuery.rows,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: parseInt(countQuery.rows[0].total),
          pages: Math.ceil(parseInt(countQuery.rows[0].total) / parseInt(limit))
        }
      }
    });
  } catch (error) {
    console.error('Error fetching test executions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch test executions'
    });
  }
});

// Generate test report
router.post('/reports/generate', authenticateToken, async (req: Request, res: Response) => {
  try {
    const {
      report_type = 'summary', date_range, test_suites,
      include_details = false, format = 'json'
    } = req.body;

    const reportId = uuidv4();
    let reportData = {};

    switch (report_type) {
      case 'summary':
        reportData = await generateSummaryReport(req.workspace_id, date_range, test_suites);
        break;
      case 'trends':
        reportData = await generateTrendsReport(req.workspace_id, date_range);
        break;
      case 'coverage':
        reportData = await generateCoverageReport(req.workspace_id, date_range);
        break;
      case 'performance':
        reportData = await generatePerformanceReport(req.workspace_id, date_range);
        break;
      default:
        throw new Error('Invalid report type');
    }

    // Store report
    await db.query(`
      INSERT INTO test_reports (
        report_id, workspace_id, report_type, report_data,
        date_range, include_details, format, generated_at,
        generated_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8)
    `, [
      reportId, req.workspace_id, report_type, JSON.stringify(reportData),
      JSON.stringify(date_range), include_details, format, req.user.id
    ]);

    res.json({
      success: true,
      data: {
        report_id: reportId,
        report_type,
        data: reportData
      }
    });
  } catch (error) {
    console.error('Error generating test report:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate test report'
    });
  }
});

// Get test dashboard
router.get('/dashboard', authenticateToken, async (req: Request, res: Response) => {
  try {
    // Test suite statistics
    const suiteStatsQuery = await db.query(`
      SELECT 
        test_type,
        COUNT(*) as total_suites,
        COUNT(CASE WHEN status = 'ACTIVE' THEN 1 END) as active_suites,
        AVG(total_tests) as avg_tests_per_suite,
        AVG(passed_tests) as avg_passed_tests
      FROM test_suites 
      WHERE workspace_id = $1
      GROUP BY test_type
    `, [req.workspace_id]);

    // Recent execution summary
    const executionSummaryQuery = await db.query(`
      SELECT 
        te.status,
        COUNT(*) as execution_count,
        AVG(te.execution_time) as avg_execution_time,
        COUNT(CASE WHEN te.started_at >= NOW() - INTERVAL '24 hours' THEN 1 END) as last_24h
      FROM test_executions te
      WHERE te.workspace_id = $1 AND te.started_at >= NOW() - INTERVAL '7 days'
      GROUP BY te.status
    `, [req.workspace_id]);

    // Test trends
    const trendsQuery = await db.query(`
      SELECT 
        DATE_TRUNC('day', te.started_at) as date,
        COUNT(*) as total_executions,
        COUNT(CASE WHEN te.status = 'COMPLETED' THEN 1 END) as completed_executions,
        AVG(
          CASE WHEN te.status = 'COMPLETED' 
          THEN te.execution_time 
          END
        ) as avg_execution_time
      FROM test_executions te
      WHERE te.workspace_id = $1 
        AND te.started_at >= NOW() - INTERVAL '30 days'
      GROUP BY DATE_TRUNC('day', te.started_at)
      ORDER BY date
    `, [req.workspace_id]);

    // Top failing test cases
    const failingTestsQuery = await db.query(`
      SELECT 
        tr.test_case_name,
        COUNT(*) as failure_count,
        COUNT(CASE WHEN tr.started_at >= NOW() - INTERVAL '7 days' THEN 1 END) as recent_failures,
        tr.error_message
      FROM test_results tr
      WHERE tr.workspace_id = $1 
        AND tr.status = 'FAILED'
        AND tr.started_at >= NOW() - INTERVAL '30 days'
      GROUP BY tr.test_case_name, tr.error_message
      ORDER BY failure_count DESC
      LIMIT 10
    `, [req.workspace_id]);

    // Coverage metrics
    const coverageQuery = await db.query(`
      SELECT 
        category,
        COUNT(DISTINCT ts.suite_id) as total_suites,
        COUNT(DISTINCT tr.test_case_name) as total_test_cases,
        COUNT(CASE WHEN tr.status = 'PASSED' THEN 1 END) as passed_tests,
        ROUND(
          COUNT(CASE WHEN tr.status = 'PASSED' THEN 1 END) * 100.0 /
          NULLIF(COUNT(tr.test_case_name), 0), 2
        ) as pass_rate
      FROM test_suites ts
      LEFT JOIN test_executions te ON ts.suite_id = te.suite_id
      LEFT JOIN test_results tr ON te.execution_id = tr.execution_id
      WHERE ts.workspace_id = $1 
        AND te.started_at >= NOW() - INTERVAL '30 days'
      GROUP BY category
      ORDER BY total_test_cases DESC
    `, [req.workspace_id]);

    res.json({
      success: true,
      data: {
        suite_statistics: suiteStatsQuery.rows,
        execution_summary: executionSummaryQuery.rows,
        test_trends: trendsQuery.rows,
        top_failing_tests: failingTestsQuery.rows,
        coverage_metrics: coverageQuery.rows
      }
    });
  } catch (error) {
    console.error('Error fetching test dashboard:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch test dashboard data'
    });
  }
});

// Create performance test
router.post('/performance-tests', authenticateToken, async (req: Request, res: Response) => {
  try {
    const {
      test_name, target_endpoint, load_profile,
      ramp_up_time, peak_load, duration, environment_id
    } = req.body;

    const testId = uuidv4();

    await db.query(`
      INSERT INTO performance_tests (
        test_id, workspace_id, test_name, target_endpoint,
        load_profile, ramp_up_time, peak_load, duration,
        environment_id, status, created_at, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), $11)
    `, [
      testId, req.workspace_id, test_name, target_endpoint,
      JSON.stringify(load_profile), ramp_up_time, peak_load,
      duration, environment_id, 'SCHEDULED', req.user.id
    ]);

    res.status(201).json({
      success: true,
      data: { test_id: testId }
    });
  } catch (error) {
    console.error('Error creating performance test:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create performance test'
    });
  }
});

// Helper functions
async function executeTestSuite(executionId, suite, testCases, workspaceId) {
  const startTime = Date.now();

  try {
    for (const testCase of testCases) {
      const resultId = uuidv4();
      const testStartTime = Date.now();

      // Simulate test execution
      const isPassed = Math.random() > 0.1; // 90% pass rate
      const executionTime = Math.random() * 5000 + 1000; // 1-6 seconds
      const errorMessage = isPassed ? null : 'Simulated test failure';

      await new Promise(resolve => setTimeout(resolve, executionTime));

      // Store test result
      await db.query(`
        INSERT INTO test_results (
          result_id, workspace_id, execution_id, test_case_name,
          test_case_id, status, execution_time, error_message,
          logs, metadata, started_at, completed_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      `, [
        resultId, workspaceId, executionId, testCase.name,
        testCase.id, isPassed ? 'PASSED' : 'FAILED', executionTime,
        errorMessage, JSON.stringify({}), JSON.stringify(testCase),
        new Date(testStartTime), new Date(Date.now())
      ]);
    }

    const totalExecutionTime = (Date.now() - startTime) / 1000;

    // Update execution status
    await db.query(`
      UPDATE test_executions 
      SET status = $1, completed_at = NOW(), execution_time = $2
      WHERE execution_id = $3 AND workspace_id = $4
    `, ['COMPLETED', totalExecutionTime, executionId, workspaceId]);

    // Update suite statistics
    await updateSuiteStatistics(suite.suite_id, workspaceId);

  } catch (error) {
    console.error('Error executing test suite:', error);
    
    await db.query(`
      UPDATE test_executions 
      SET status = $1, error_message = $2
      WHERE execution_id = $3 AND workspace_id = $4
    `, ['FAILED', error.message, executionId, workspaceId]);
  }
}

async function updateSuiteStatistics(suiteId, workspaceId) {
  const statsQuery = await db.query(`
    SELECT 
      COUNT(*) as total_tests,
      COUNT(CASE WHEN tr.status = 'PASSED' THEN 1 END) as passed_tests,
      COUNT(CASE WHEN tr.status = 'FAILED' THEN 1 END) as failed_tests,
      COUNT(CASE WHEN tr.status = 'SKIPPED' THEN 1 END) as skipped_tests,
      AVG(tr.execution_time) as avg_execution_time
    FROM test_results tr
    JOIN test_executions te ON tr.execution_id = te.execution_id
    WHERE te.suite_id = $1 AND te.workspace_id = $2
  `, [suiteId, workspaceId]);

  if (statsQuery.rows.length > 0) {
    const stats = statsQuery.rows[0];
    
    await db.query(`
      UPDATE test_suites 
      SET total_tests = $1, passed_tests = $2, failed_tests = $3,
          skipped_tests = $4, execution_time = $5, status = $6
      WHERE suite_id = $7 AND workspace_id = $8
    `, [
      stats.total_tests, stats.passed_tests, stats.failed_tests,
      stats.skipped_tests, stats.avg_execution_time, 'READY',
      suiteId, workspaceId
    ]);
  }
}

async function generateSummaryReport(workspaceId, dateRange, testSuites) {
  const query = await db.query(`
    SELECT 
      ts.test_type, ts.category,
      COUNT(DISTINCT te.execution_id) as total_executions,
      COUNT(CASE WHEN te.status = 'COMPLETED' THEN 1 END) as completed_executions,
      COUNT(CASE WHEN te.status = 'FAILED' THEN 1 END) as failed_executions,
      AVG(te.execution_time) as avg_execution_time,
      AVG(
        CASE WHEN te.status = 'COMPLETED'
        THEN (
          SELECT COUNT(*) FROM test_results tr 
          WHERE tr.execution_id = te.execution_id AND tr.status = 'PASSED'
        ) * 100.0 / NULLIF(
          (SELECT COUNT(*) FROM test_results tr 
           WHERE tr.execution_id = te.execution_id), 0
        )
        END
      ) as avg_pass_rate
    FROM test_suites ts
    JOIN test_executions te ON ts.suite_id = te.suite_id
    WHERE ts.workspace_id = $1
      AND te.started_at >= $2 AND te.started_at <= $3
    GROUP BY ts.test_type, ts.category
    ORDER BY total_executions DESC
  `, [workspaceId, dateRange.start, dateRange.end]);

  return {
    report_type: 'summary',
    date_range: dateRange,
    generated_at: new Date().toISOString(),
    summary: query.rows
  };
}

async function generateTrendsReport(workspaceId, dateRange) {
  const query = await db.query(`
    SELECT 
      DATE_TRUNC('day', te.started_at) as date,
      ts.test_type,
      COUNT(te.execution_id) as executions,
      AVG(
        CASE WHEN te.status = 'COMPLETED'
        THEN (
          SELECT COUNT(*) FROM test_results tr 
          WHERE tr.execution_id = te.execution_id AND tr.status = 'PASSED'
        ) * 100.0 / NULLIF(
          (SELECT COUNT(*) FROM test_results tr 
           WHERE tr.execution_id = te.execution_id), 0
        )
        END
      ) as pass_rate
    FROM test_executions te
    JOIN test_suites ts ON te.suite_id = ts.suite_id
    WHERE te.workspace_id = $1
      AND te.started_at >= $2 AND te.started_at <= $3
    GROUP BY DATE_TRUNC('day', te.started_at), ts.test_type
    ORDER BY date, ts.test_type
  `, [workspaceId, dateRange.start, dateRange.end]);

  return {
    report_type: 'trends',
    date_range: dateRange,
    generated_at: new Date().toISOString(),
    trends: query.rows
  };
}

async function generateCoverageReport(workspaceId, dateRange) {
  const query = await db.query(`
    SELECT 
      ts.category,
      COUNT(DISTINCT ts.suite_id) as total_suites,
      COUNT(DISTINCT tr.test_case_name) as unique_test_cases,
      COUNT(tr.result_id) as total_test_executions,
      COUNT(CASE WHEN tr.status = 'PASSED' THEN 1 END) as passed_tests,
      ROUND(
        COUNT(CASE WHEN tr.status = 'PASSED' THEN 1 END) * 100.0 /
        NULLIF(COUNT(tr.result_id), 0), 2
      ) as pass_rate
    FROM test_suites ts
    JOIN test_executions te ON ts.suite_id = te.suite_id
    JOIN test_results tr ON te.execution_id = tr.execution_id
    WHERE ts.workspace_id = $1
      AND te.started_at >= $2 AND te.started_at <= $3
    GROUP BY ts.category
    ORDER BY total_test_executions DESC
  `, [workspaceId, dateRange.start, dateRange.end]);

  return {
    report_type: 'coverage',
    date_range: dateRange,
    generated_at: new Date().toISOString(),
    coverage: query.rows
  };
}

async function generatePerformanceReport(workspaceId, dateRange) {
  const query = await db.query(`
    SELECT 
      ts.test_type,
      MIN(te.execution_time) as min_execution_time,
      MAX(te.execution_time) as max_execution_time,
      AVG(te.execution_time) as avg_execution_time,
      PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY te.execution_time) as p95_execution_time,
      COUNT(te.execution_id) as total_executions
    FROM test_executions te
    JOIN test_suites ts ON te.suite_id = ts.suite_id
    WHERE te.workspace_id = $1
      AND te.started_at >= $2 AND te.started_at <= $3
      AND te.status = 'COMPLETED'
    GROUP BY ts.test_type
    ORDER BY avg_execution_time DESC
  `, [workspaceId, dateRange.start, dateRange.end]);

  return {
    report_type: 'performance',
    date_range: dateRange,
    generated_at: new Date().toISOString(),
    performance: query.rows
  };
}

export default router;