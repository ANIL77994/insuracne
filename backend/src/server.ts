import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { authenticateToken } from './middleware/auth';
import { errorHandler } from './middleware/errorHandler';
import { requestLogger } from './middleware/requestLogger';
import { connectPrisma, disconnectPrisma } from './lib/prisma';


// Import all engine routes
import authRoutes from './routes/auth';
import workspaceRoutes from './routes/workspaces';
import policyRoutes from './routes/policies';
import claimsRoutes from './routes/claims';
import underwritingRoutes from './routes/underwriting';
import quotesRoutes from './routes/quotes';
import billingRoutes from './routes/billing';
import documentsRoutes from './routes/documents';
import analyticsRoutes from './routes/analytics';
import adminRoutes from './routes/admin';

// Import new engine routes
import riskScoringRoutes from './routes/risk-scoring';
import fraudDetectionRoutes from './routes/fraud-detection';
import crmRoutes from './routes/crm';
import telematicsRoutes from './routes/telematics';
import workflowRoutes from './routes/workflow';
import complianceRoutes from './routes/compliance';
import reinsuranceRoutes from './routes/reinsurance';
import partnerMarketplaceRoutes from './routes/partner-marketplace';
import apisSdkRoutes from './routes/apis-sdks';
import securityRoutes from './routes/security';
import sandboxRoutes from './routes/sandbox';
import testingRoutes from './routes/testing';
import userPermissionsRouter from './routes/userPermissions';

const app = express();
const PORT = process.env.PORT || 3001;

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
  crossOriginEmbedderPolicy: false
}));

// CORS configuration
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Requested-With']
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // Limit each IP to 1000 requests per windowMs
  message: {
    error: 'Too many requests from this IP, please try again later.',
    retryAfter: 15 * 60 // 15 minutes in seconds
  },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', limiter);

// General middleware
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging
app.use(requestLogger);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'development'
  });
});

// API version info
app.get('/api', (req, res) => {
  res.json({
    name: 'Insurance Automation Platform API',
    version: '1.0.0',
    documentation: '/api/docs',
    engines: [
      'Authentication', 'Workspace', 'Policy', 'Claims', 'Underwriting',
      'Quote & Pricing', 'Billing', 'Document Management', 'Analytics',
      'Risk Scoring', 'Fraud Detection', 'CRM', 'Telematics', 
      'Workflow Orchestration', 'Compliance', 'Reinsurance', 
      'Partner Marketplace', 'APIs/SDKs', 'Security', 'Sandbox', 'Testing'
    ],
    timestamp: new Date().toISOString()
  });
});

// Authentication routes (no auth required)
app.use('/api/auth', authRoutes);

// Protected API routes (require authentication)
app.use('/api/workspaces', authenticateToken, workspaceRoutes);
app.use('/api/policies', authenticateToken, policyRoutes);
app.use('/api/claims', authenticateToken, claimsRoutes);
app.use('/api/underwriting', authenticateToken, underwritingRoutes);
app.use('/api/quotes', authenticateToken, quotesRoutes);
app.use('/api/billing', authenticateToken, billingRoutes);
app.use('/api/documents', authenticateToken, documentsRoutes);
app.use('/api/analytics', authenticateToken, analyticsRoutes);
app.use('/api/admin', authenticateToken, adminRoutes);

// Additional engine routes
app.use('/api/risk-scoring', authenticateToken, riskScoringRoutes);
app.use('/api/fraud-detection', authenticateToken, fraudDetectionRoutes);
app.use('/api/crm', authenticateToken, crmRoutes);
app.use('/api/telematics', authenticateToken, telematicsRoutes);
app.use('/api/workflow', authenticateToken, workflowRoutes);
app.use('/api/compliance', authenticateToken, complianceRoutes);
app.use('/api/reinsurance', authenticateToken, reinsuranceRoutes);
app.use('/api/partner-marketplace', authenticateToken, partnerMarketplaceRoutes);
app.use('/api/apis-sdks', authenticateToken, apisSdkRoutes);
app.use('/api/security', authenticateToken, securityRoutes);
app.use('/api/sandbox', authenticateToken, sandboxRoutes);
app.use('/api/testing', authenticateToken, testingRoutes);
app.use('/api/admin/users', authenticateToken, userPermissionsRouter);

// API documentation endpoint
app.get('/api/docs', (req, res) => {
  res.json({
    openapi: '3.0.0',
    info: {
      title: 'Insurance Automation Platform API',
      version: '1.0.0',
      description: 'Comprehensive insurance platform API with 21 core engines'
    },
    servers: [
      {
        url: `${req.protocol}://${req.get('host')}/api`,
        description: 'Current version'
      }
    ],
    paths: {
      '/health': {
        get: {
          summary: 'Health check',
          responses: {
            '200': { description: 'Service is healthy' }
          }
        }
      },
      '/auth/{endpoint}': {
        post: {
          summary: 'Authentication endpoints',
          parameters: [{ name: 'endpoint', in: 'path', required: true }]
        }
      }
      // Add more paths as needed
    }
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    path: req.originalUrl,
    method: req.method,
    timestamp: new Date().toISOString()
  });
});

// Global error handler
app.use(errorHandler);

// Graceful shutdown
const gracefulShutdown = async () => {
  console.log('\nReceived shutdown signal. Closing HTTP server and database connections...');
  
  try {
    await disconnectPrisma();
    console.log('Prisma client disconnected.');
  } catch (err) {
    console.error('Error disconnecting Prisma client:', err);
  }

  server.close(() => {
    console.log('HTTP server closed.');
    process.exit(0);
  });

  // Force close server after 10 seconds
  setTimeout(() => {
    console.error('Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Start server
const server = app.listen(PORT, async () => {
  console.log(`🚀 Insurance Automation Platform API Server`);
  console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🌐 Port: ${PORT}`);
  console.log(`🔗 Health check: http://localhost:${PORT}/health`);
  console.log(`📚 API docs: http://localhost:${PORT}/api/docs`);
  console.log(`⚡ Engines: 21/20 implemented`);
  console.log(`🔒 Security: Rate limiting, CORS, Helmet enabled`);

  // Establish and verify Prisma connection
  try {
    await connectPrisma();
    console.log(` Prisma connected successfully to PostgreSQL database`);
  } catch (err) {
    console.error(`❌ Prisma database connection error:`, err);
  }

  console.log(`📊 Status: Running`);
  console.log('==========================================');
});

export default app;
