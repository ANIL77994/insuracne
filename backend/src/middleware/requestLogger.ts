import { Request, Response, NextFunction } from 'express';
import { db } from '../database/connection';

export const requestLogger = (req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  const { method, url, ip } = req;
  const userAgent = req.get('User-Agent') || 'Unknown';
  
  // Log request start
  console.log(`🚀 ${method} ${url} - ${ip} - ${userAgent}`);

  // Capture original response methods
  const originalSend = res.send;
  const originalJson = res.json;

  let responseBody: any;

  // Override res.send to capture response
  res.send = function(body: any) {
    responseBody = body;
    return originalSend.call(this, body);
  };

  // Override res.json to capture response
  res.json = function(body: any) {
    responseBody = body;
    return originalJson.call(this, body);
  };

  // Log response when finished
  res.on('finish', async () => {
    const duration = Date.now() - start;
    const { statusCode } = res;
    
    const logLevel = statusCode >= 400 ? 'error' : 'info';
    const emoji = statusCode >= 400 ? '❌' : '✅';
    
    console.log(`${emoji} ${method} ${url} - ${statusCode} - ${duration}ms`);

    // Log API request to database for analytics
    try {
      // Extract workspace_id from authenticated request if available
      const workspace_id = (req as any).workspace_id;
      const user_id = (req as any).user?.id;
      
      // Only log API requests (not static files)
      if (url.startsWith('/api/')) {
        await db.query(
          `INSERT INTO api_requests 
           (workspace_id, endpoint, http_method, client_id, user_id, ip_address, 
            user_agent, status_code, response_time_ms, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
          [
            workspace_id,
            url,
            method,
            req.get('X-API-Key') || null,
            user_id || null,
            ip,
            userAgent,
            statusCode,
            duration
          ]
        );
      }
    } catch (error) {
      // Don't fail the request if logging fails
      console.error('Failed to log API request:', error);
    }
  });

  next();
};

export const logSecurityEvent = async (
  workspaceId: string,
  eventType: string,
  severity: string,
  description: string,
  sourceIp?: string,
  userId?: string,
  metadata?: any
) => {
  try {
    await db.query(
      `INSERT INTO security_events 
       (workspace_id, event_type, severity, source_ip, user_id, description, metadata, success, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
      [
        workspaceId,
        eventType,
        severity,
        sourceIp || null,
        userId || null,
        description,
        metadata ? JSON.stringify(metadata) : '{}',
        true,
      ]
    );
  } catch (error) {
    console.error('Failed to log security event:', error);
  }
};

export const logAuditEvent = async (
  workspaceId: string,
  tableName: string,
  actionType: string,
  recordId: string,
  oldValues?: any,
  newValues?: any,
  performedBy?: string,
  ipAddress?: string,
  userAgent?: string
) => {
  try {
    await db.query(
      `INSERT INTO audit_logs 
       (workspace_id, table_name, action_type, record_id, old_values, new_values, 
        performed_by, ip_address, user_agent, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
      [
        workspaceId,
        tableName,
        actionType,
        recordId,
        oldValues ? JSON.stringify(oldValues) : null,
        newValues ? JSON.stringify(newValues) : null,
        performedBy || null,
        ipAddress || null,
        userAgent || null,
      ]
    );
  } catch (error) {
    console.error('Failed to log audit event:', error);
  }
};