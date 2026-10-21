import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { db } from '../database/connection';
import { authenticateToken, requireRole } from '../middleware/auth';

const router = Router();

// ---------------------------------------------------------------------------
// Types & helpers
// ---------------------------------------------------------------------------

// Local view of what auth middleware attaches to the request.
interface AuthedRequest extends Request {
  workspace_id: string;
  user: { id: string };
}

interface EndpointRow {
  endpoint_path: string;
  http_method: string;
  category: string;
  description?: string;
  parameters?: unknown;
  request_schema?: unknown;
  response_schema?: unknown;
  examples?: unknown;
}

/** Query-string values can be string | string[] | object; accept only a non-empty string. */
const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.length > 0 ? v : undefined;

/** pg returns jsonb as objects but text/json-as-text as strings; handle both. */
const parseJson = (v: unknown, fallback: any = undefined) => {
  if (v === null || v === undefined || v === '') return fallback;
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v);
  } catch {
    return fallback;
  }
};

const toPascal = (s: string) =>
  s
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');

const toSnake = (s: string) =>
  s
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();

/** Returns a unique identifier by appending a counter on collision. */
const makeUnique = (used: Set<string>, name: string) => {
  let candidate = name || 'method';
  let i = 2;
  while (used.has(candidate)) candidate = `${name}${i++}`;
  used.add(candidate);
  return candidate;
};

const isPrivateHost = (host: string) =>
  /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[?::1\]?$)/i.test(host);

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

// ---------------------------------------------------------------------------
// API documentation
// ---------------------------------------------------------------------------

router.get('/docs', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { workspace_id } = req as AuthedRequest;
    const version = str(req.query.version) ?? 'v1';
    const category = str(req.query.category);

    const params: any[] = [workspace_id, version];
    let whereClause = 'WHERE workspace_id = $1 AND version = $2';

    if (category) {
      params.push(category);
      whereClause += ` AND category = $${params.length}`;
    }

    const docsQuery = await db.query(
      `
      SELECT
        endpoint_id, endpoint_path, http_method, category,
        description, parameters, request_schema, response_schema,
        examples, rate_limits, version, created_at
      FROM api_endpoints
      ${whereClause}
      ORDER BY category, endpoint_path
    `,
      params
    );

    const openApiSpec = generateOpenAPISpec(docsQuery.rows, version);

    res.json({
      success: true,
      data: {
        version,
        openapi: '3.0.0',
        info: {
          title: 'Insurance Automation Platform API',
          version,
          description:
            'Comprehensive insurance platform API for policy management, claims processing, and underwriting'
        },
        servers: [
          {
            url: `${req.protocol}://${req.get('host')}/api/${version}`,
            description: 'Production server'
          }
        ],
        paths: openApiSpec.paths,
        components: openApiSpec.components
      }
    });
  } catch (error) {
    console.error('Error fetching API documentation:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch API documentation' });
  }
});

// ---------------------------------------------------------------------------
// SDK generation
// ---------------------------------------------------------------------------

const SDK_GENERATORS: Record<
  string,
  (endpoints: EndpointRow[], version: string, includeExamples: boolean) => string
> = {
  javascript: (e, v, i) => generateJavaScriptSDK(e, v, i),
  python: (e, v, i) => generatePythonSDK(e, v, i),
  java: (e, v, i) => generateJavaSDK(e, v, i)
};

router.post(
  '/generate-sdk',
  authenticateToken,
  requireRole(['admin', 'developer']),
  async (req: Request, res: Response) => {
    try {
      const { workspace_id, user } = req as AuthedRequest;
      const language = str(req.body.language) ?? 'javascript';
      const version = str(req.body.version) ?? 'v1';
      const includeExamples = req.body.include_examples !== false;

      const generator = SDK_GENERATORS[language];
      if (!generator) {
        return res.status(400).json({
          success: false,
          error: `Unsupported SDK language. Supported: ${Object.keys(SDK_GENERATORS).join(', ')}`
        });
      }

      const endpointsQuery = await db.query(
        `
        SELECT endpoint_path, http_method, category, description,
               parameters, request_schema, response_schema, examples
        FROM api_endpoints
        WHERE workspace_id = $1 AND version = $2
        ORDER BY category, endpoint_path
      `,
        [workspace_id, version]
      );

      const sdkCode = generator(endpointsQuery.rows, version, includeExamples);

      const sdkId = uuidv4();
      await db.query(
        `
        INSERT INTO sdk_generations (
          sdk_id, workspace_id, language, version, code,
          include_examples, generated_at, generated_by
        ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7)
      `,
        [sdkId, workspace_id, language, version, sdkCode, includeExamples, user.id]
      );

      res.json({
        success: true,
        data: {
          sdk_id: sdkId,
          language,
          version,
          code: sdkCode,
          download_url: `/api/${version}/sdk/${sdkId}/download`
        }
      });
    } catch (error) {
      console.error('Error generating SDK:', error);
      res.status(500).json({ success: false, error: 'Failed to generate SDK' });
    }
  }
);

// The download_url returned above previously pointed at a route that didn't exist.
router.get('/sdk/:sdkId/download', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { workspace_id } = req as AuthedRequest;
    const result = await db.query(
      `SELECT language, version, code FROM sdk_generations WHERE sdk_id = $1 AND workspace_id = $2`,
      [req.params.sdkId, workspace_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'SDK not found' });
    }

    const { language, version, code } = result.rows[0];
    const ext: Record<string, string> = { javascript: 'js', python: 'py', java: 'java' };
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="insurance-sdk-${version}.${ext[language] ?? 'txt'}"`
    );
    res.send(code);
  } catch (error) {
    console.error('Error downloading SDK:', error);
    res.status(500).json({ success: false, error: 'Failed to download SDK' });
  }
});

// ---------------------------------------------------------------------------
// Usage statistics
// ---------------------------------------------------------------------------

router.get('/usage-stats', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { workspace_id } = req as AuthedRequest;
    const endpoint = str(req.query.endpoint);
    const clientId = str(req.query.client_id);

    // Validate and clamp the period instead of interpolating it into SQL (was SQL injection).
    const parsed = parseInt(str(req.query.period) ?? '30', 10);
    const days = Math.min(Math.max(Number.isFinite(parsed) ? parsed : 30, 1), 365);

    const params: any[] = [workspace_id];
    let whereClause = 'WHERE workspace_id = $1';

    if (endpoint) {
      params.push(endpoint);
      whereClause += ` AND endpoint = $${params.length}`;
    }

    if (clientId) {
      params.push(clientId);
      whereClause += ` AND client_id = $${params.length}`;
    }

    params.push(days);
    whereClause += ` AND created_at >= NOW() - ($${params.length}::int * INTERVAL '1 day')`;

    const [volumeQuery, trendsQuery, clientsQuery] = await Promise.all([
      db.query(
        `
        SELECT
          endpoint,
          COUNT(*) as request_count,
          COUNT(CASE WHEN status_code < 400 THEN 1 END) as success_count,
          COUNT(CASE WHEN status_code >= 400 THEN 1 END) as error_count,
          AVG(response_time_ms) as avg_response_time,
          MAX(response_time_ms) as max_response_time
        FROM api_requests
        ${whereClause}
        GROUP BY endpoint
        ORDER BY request_count DESC
      `,
        params
      ),
      db.query(
        `
        SELECT
          DATE_TRUNC('day', created_at) as date,
          COUNT(*) as daily_requests,
          COUNT(DISTINCT client_id) as unique_clients,
          AVG(response_time_ms) as avg_response_time
        FROM api_requests
        ${whereClause}
        GROUP BY DATE_TRUNC('day', created_at)
        ORDER BY date
      `,
        params
      ),
      db.query(
        `
        SELECT
          client_id,
          COUNT(*) as request_count,
          COUNT(CASE WHEN status_code < 400 THEN 1 END) as success_count,
          AVG(response_time_ms) as avg_response_time,
          MAX(created_at) as last_request
        FROM api_requests
        ${whereClause}
        GROUP BY client_id
        ORDER BY request_count DESC
        LIMIT 10
      `,
        params
      )
    ]);

    res.json({
      success: true,
      data: {
        period_days: days,
        endpoint_volume: volumeQuery.rows,
        usage_trends: trendsQuery.rows,
        top_clients: clientsQuery.rows
      }
    });
  } catch (error) {
    console.error('Error fetching API usage stats:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch API usage statistics' });
  }
});

// ---------------------------------------------------------------------------
// API keys
// ---------------------------------------------------------------------------

router.post(
  '/api-keys',
  authenticateToken,
  requireRole(['admin', 'developer']), // was open to any authenticated user
  async (req: Request, res: Response) => {
    try {
      const { workspace_id, user } = req as AuthedRequest;
      const { key_name, permissions, rate_limit, expires_at, allowed_ips, description } = req.body;

      if (typeof key_name !== 'string' || !key_name.trim()) {
        return res.status(400).json({ success: false, error: 'key_name is required' });
      }
      if (permissions !== undefined && !Array.isArray(permissions)) {
        return res.status(400).json({ success: false, error: 'permissions must be an array' });
      }
      if (allowed_ips !== undefined && !Array.isArray(allowed_ips)) {
        return res.status(400).json({ success: false, error: 'allowed_ips must be an array' });
      }
      if (rate_limit !== undefined && (!Number.isInteger(rate_limit) || rate_limit <= 0)) {
        return res.status(400).json({ success: false, error: 'rate_limit must be a positive integer' });
      }
      if (expires_at !== undefined && (isNaN(Date.parse(expires_at)) || Date.parse(expires_at) <= Date.now())) {
        return res.status(400).json({ success: false, error: 'expires_at must be a future date' });
      }

      // Cryptographically secure keys (UUID substrings are not meant for secrets).
      const apiKey = `iap_${crypto.randomBytes(24).toString('hex')}`;
      const secretKey = `ias_${crypto.randomBytes(32).toString('hex')}`;
      const keyId = uuidv4();

      // Only the hash of the secret is stored; the plaintext is shown once, below.
      await db.query(
        `
        INSERT INTO api_keys (
          key_id, workspace_id, key_name, api_key, secret_key,
          permissions, rate_limit, expires_at, allowed_ips,
          description, status, created_at, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), $12)
      `,
        [
          keyId,
          workspace_id,
          key_name.trim(),
          apiKey,
          sha256(secretKey),
          JSON.stringify(permissions ?? []),
          rate_limit ?? null,
          expires_at ?? null,
          JSON.stringify(allowed_ips ?? []),
          description ?? null,
          'ACTIVE',
          user.id
        ]
      );

      res.status(201).json({
        success: true,
        data: {
          key_id: keyId,
          api_key: apiKey,
          secret_key: secretKey, // store it now - it cannot be retrieved later
          permissions: permissions ?? [],
          rate_limit: rate_limit ?? null
        }
      });
    } catch (error) {
      console.error('Error creating API key:', error);
      res.status(500).json({ success: false, error: 'Failed to create API key' });
    }
  }
);

router.get('/api-keys', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { workspace_id } = req as AuthedRequest;
    const status = str(req.query.status);

    const params: any[] = [workspace_id];
    let whereClause = 'WHERE workspace_id = $1';

    if (status) {
      params.push(status);
      whereClause += ` AND status = $${params.length}`;
    }

    const keysQuery = await db.query(
      `
      SELECT
        key_id, key_name, api_key, permissions, rate_limit,
        expires_at, allowed_ips, description, status,
        last_used_at, created_at
      FROM api_keys
      ${whereClause}
      ORDER BY created_at DESC
    `,
      params
    );

    res.json({ success: true, data: keysQuery.rows });
  } catch (error) {
    console.error('Error fetching API keys:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch API keys' });
  }
});

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

router.get('/webhooks', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { workspace_id } = req as AuthedRequest;
    const status = str(req.query.status);
    const eventType = str(req.query.event_type);

    const params: any[] = [workspace_id];
    let whereClause = 'WHERE workspace_id = $1';

    if (status) {
      params.push(status);
      whereClause += ` AND status = $${params.length}`;
    }

    if (eventType) {
      params.push(eventType);
      whereClause += ` AND event_type = $${params.length}`;
    }

    // secret_key intentionally NOT selected - it must not be readable via the list endpoint.
    const webhooksQuery = await db.query(
      `
      SELECT
        webhook_id, webhook_url, event_type, status,
        retry_attempts, timeout_seconds,
        last_triggered_at, failure_count, created_at
      FROM webhook_configurations
      ${whereClause}
      ORDER BY created_at DESC
    `,
      params
    );

    res.json({ success: true, data: webhooksQuery.rows });
  } catch (error) {
    console.error('Error fetching webhooks:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch webhook configurations' });
  }
});

router.post(
  '/webhooks',
  authenticateToken,
  requireRole(['admin', 'developer']),
  async (req: Request, res: Response) => {
    try {
      const { workspace_id, user } = req as AuthedRequest;
      const {
        webhook_url,
        event_type,
        secret_key,
        retry_attempts = 3,
        timeout_seconds = 30,
        filters,
        headers
      } = req.body;

      // Validate URL (basic SSRF protection)
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(webhook_url);
      } catch {
        return res.status(400).json({ success: false, error: 'webhook_url must be a valid URL' });
      }
      const isProd = process.env.NODE_ENV === 'production';
      if (parsedUrl.protocol !== 'https:' && (isProd || parsedUrl.protocol !== 'http:')) {
        return res.status(400).json({ success: false, error: 'webhook_url must use https' });
      }
      if (isProd && isPrivateHost(parsedUrl.hostname)) {
        return res.status(400).json({ success: false, error: 'webhook_url host is not allowed' });
      }
      if (typeof event_type !== 'string' || !event_type) {
        return res.status(400).json({ success: false, error: 'event_type is required' });
      }
      if (!Number.isInteger(retry_attempts) || retry_attempts < 0 || retry_attempts > 10) {
        return res.status(400).json({ success: false, error: 'retry_attempts must be 0-10' });
      }
      if (!Number.isInteger(timeout_seconds) || timeout_seconds < 1 || timeout_seconds > 120) {
        return res.status(400).json({ success: false, error: 'timeout_seconds must be 1-120' });
      }

      const webhookId = uuidv4();
      const secret = typeof secret_key === 'string' && secret_key ? secret_key : crypto.randomBytes(32).toString('hex');

      await db.query(
        `
        INSERT INTO webhook_configurations (
          webhook_id, workspace_id, webhook_url, event_type,
          secret_key, retry_attempts, timeout_seconds, filters,
          headers, status, created_at, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), $11)
      `,
        [
          webhookId,
          workspace_id,
          parsedUrl.toString(),
          event_type,
          secret, // needed in plaintext to sign outgoing payloads
          retry_attempts,
          timeout_seconds,
          JSON.stringify(filters ?? {}),
          JSON.stringify(headers ?? {}),
          'ACTIVE',
          user.id
        ]
      );

      res.status(201).json({
        success: true,
        data: { webhook_id: webhookId, secret_key: secret }
      });
    } catch (error) {
      console.error('Error creating webhook:', error);
      res.status(500).json({ success: false, error: 'Failed to create webhook' });
    }
  }
);

// ---------------------------------------------------------------------------
// Rate limits
// ---------------------------------------------------------------------------

router.get('/rate-limits', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { workspace_id } = req as AuthedRequest;
    const clientId = str(req.query.client_id);
    const endpoint = str(req.query.endpoint);

    const params: any[] = [workspace_id];
    let whereClause = 'WHERE workspace_id = $1';

    if (clientId) {
      params.push(clientId);
      whereClause += ` AND client_id = $${params.length}`;
    }

    if (endpoint) {
      params.push(endpoint);
      whereClause += ` AND endpoint = $${params.length}`;
    }

    const rateLimitsQuery = await db.query(
      `
      SELECT
        client_id, endpoint, rate_limit, window_size,
        current_usage, remaining_requests, reset_time,
        created_at
      FROM rate_limits
      ${whereClause}
      ORDER BY reset_time ASC
    `,
      params
    );

    res.json({ success: true, data: rateLimitsQuery.rows });
  } catch (error) {
    console.error('Error fetching rate limits:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch rate limits' });
  }
});

// ---------------------------------------------------------------------------
// SDK generators
// ---------------------------------------------------------------------------

function generateJavaScriptSDK(endpoints: EndpointRow[], version: string, includeExamples: boolean): string {
  // NOTE: inside this outer template literal, generated backticks and ${} must be
  // escaped as \` and \${ - the original used "\\`" which actually terminated the
  // template early and produced a syntax error.
  let code = `/**
 * Insurance Automation Platform JavaScript SDK
 * Version: ${version}
 * Generated: ${new Date().toISOString()}
 */

class InsuranceAPIClient {
  constructor(config) {
    this.baseURL = config.baseURL || 'https://api.insurance-platform.com/${version}';
    this.apiKey = config.apiKey;
    this.secretKey = config.secretKey;
    this.timeout = config.timeout || 30000;
  }

  async request(method, endpoint, data = null, headers = {}) {
    const url = \`\${this.baseURL}\${endpoint}\`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);
    const config = {
      method,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey,
        'Authorization': \`Bearer \${this.secretKey}\`,
        ...headers
      }
    };

    if (data && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
      config.body = JSON.stringify(data);
    }

    try {
      const response = await fetch(url, config);
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'API request failed');
      }

      return result;
    } catch (error) {
      throw new Error(\`API request failed: \${error.message}\`);
    } finally {
      clearTimeout(timer);
    }
  }
`;

  const used = new Set<string>(['request', 'constructor']);

  endpoints.forEach(endpoint => {
    const method = endpoint.http_method.toUpperCase();
    const name = makeUnique(
      used,
      method.toLowerCase() + toPascal(endpoint.endpoint_path.replace(/:(\w+)/g, 'By_$1'))
    );
    const doc = includeExamples && endpoint.description ? `  // ${endpoint.description.replace(/\s+/g, ' ')}\n` : '';

    code += `
${doc}  async ${name}(params = {}) {
    const body = { ...params };
    const url = ${JSON.stringify(endpoint.endpoint_path)}.replace(/:(\\w+)/g, (_, key) => {
      const value = params[key];
      delete body[key];
      return encodeURIComponent(value);
    });
    return this.request('${method}', url, body);
  }
`;
  });

  code += `}

// Export for different module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = InsuranceAPIClient;
} else if (typeof window !== 'undefined') {
  window.InsuranceAPIClient = InsuranceAPIClient;
}
`;

  return code;
}

function generatePythonSDK(endpoints: EndpointRow[], version: string, includeExamples: boolean): string {
  let code = `"""
Insurance Automation Platform Python SDK
Version: ${version}
Generated: ${new Date().toISOString()}
"""

import requests
from typing import Dict, Any, Optional


class InsuranceAPIClient:
    def __init__(self, config: Dict[str, Any]):
        self.base_url = config.get('base_url', 'https://api.insurance-platform.com/${version}')
        self.api_key = config['api_key']
        self.secret_key = config['secret_key']
        self.timeout = config.get('timeout', 30)

        self.session = requests.Session()
        self.session.headers.update({
            'Content-Type': 'application/json',
            'X-API-Key': self.api_key,
            'Authorization': f'Bearer {self.secret_key}'
        })

    def _request(self, method: str, endpoint: str, data: Optional[Dict] = None) -> Dict[str, Any]:
        url = f"{self.base_url}{endpoint}"

        try:
            response = self.session.request(
                method=method,
                url=url,
                json=data if data else None,
                timeout=self.timeout
            )
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            raise Exception(f"API request failed: {str(e)}")
`;

  const used = new Set<string>(['_request']);
  const categories = [...new Set(endpoints.map(e => e.category))];

  categories.forEach(category => {
    const name = makeUnique(used, `get_${toSnake(category)}`);
    const label = includeExamples ? category.replace(/_/g, ' ') : category;
    code += `
    def ${name}(self) -> Dict[str, Any]:
        """Get all ${label}"""
        return self._request('GET', '/${category}')
`;
  });

  code += `

# Usage example
if __name__ == "__main__":
    config = {
        'api_key': 'your_api_key',
        'secret_key': 'your_secret_key'
    }

    client = InsuranceAPIClient(config)
`;

  return code;
}

function generateJavaSDK(endpoints: EndpointRow[], version: string, includeExamples: boolean): string {
  let code = `/**
 * Insurance Automation Platform Java SDK
 * Version: ${version}
 * Generated: ${new Date().toISOString()}
 */

import java.net.http.*;
import java.net.URI;
import java.time.Duration;
import java.util.concurrent.CompletableFuture;

public class InsuranceAPIClient {
    private final String baseURL;
    private final String apiKey;
    private final String secretKey;
    private final HttpClient httpClient;

    public InsuranceAPIClient(Config config) {
        this.baseURL = config.baseURL != null ? config.baseURL : "https://api.insurance-platform.com/${version}";
        this.apiKey = config.apiKey;
        this.secretKey = config.secretKey;
        this.httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(config.timeout != null ? config.timeout : 30))
            .build();
    }

    public static class Config {
        public String baseURL;
        public String apiKey;
        public String secretKey;
        public Integer timeout;
    }

    private CompletableFuture<String> request(String method, String endpoint, String body) {
        HttpRequest.Builder builder = HttpRequest.newBuilder()
            .uri(URI.create(baseURL + endpoint))
            .header("Content-Type", "application/json")
            .header("X-API-Key", apiKey)
            .header("Authorization", "Bearer " + secretKey)
            .method(method, body != null
                ? HttpRequest.BodyPublishers.ofString(body)
                : HttpRequest.BodyPublishers.noBody());

        return httpClient.sendAsync(builder.build(), HttpResponse.BodyHandlers.ofString())
            .thenApply(response -> {
                if (response.statusCode() >= 400) {
                    throw new RuntimeException("API request failed: " + response.body());
                }
                return response.body();
            });
    }
`;

  const used = new Set<string>(['request']);
  const categories = [...new Set(endpoints.map(e => e.category))];

  categories.forEach(category => {
    const name = makeUnique(used, `get${toPascal(category)}`);
    code += `
    public CompletableFuture<String> ${name}() {
        return request("GET", "/${category}", null);
    }
`;
  });

  code += `}
`;

  return code;
}

// ---------------------------------------------------------------------------
// OpenAPI
// ---------------------------------------------------------------------------

function generateOpenAPISpec(endpoints: EndpointRow[], version: string) {
  const paths: Record<string, Record<string, unknown>> = {};
  const components = {
    schemas: {},
    securitySchemes: {
      ApiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
      BearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }
    }
  };

  endpoints.forEach(endpoint => {
    // OpenAPI uses {id}, not :id
    const path = endpoint.endpoint_path.replace(/:(\w+)/g, '{$1}');
    if (!paths[path]) paths[path] = {};

    const requestSchema = parseJson(endpoint.request_schema);
    const responseSchema = parseJson(endpoint.response_schema, { type: 'object' });

    paths[path][endpoint.http_method.toLowerCase()] = {
      summary: endpoint.description,
      tags: [endpoint.category],
      parameters: parseJson(endpoint.parameters, []),
      requestBody: requestSchema
        ? { required: true, content: { 'application/json': { schema: requestSchema } } }
        : undefined,
      responses: {
        '200': {
          description: 'Success',
          content: { 'application/json': { schema: responseSchema } }
        },
        '400': { description: 'Bad Request' },
        '401': { description: 'Unauthorized' },
        '500': { description: 'Internal Server Error' }
      },
      security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }]
    };
  });

  return { paths, components };
}

export default router;