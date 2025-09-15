const http = require('http');
const { URL } = require('url');
const { createHash, timingSafeEqual } = require('crypto');
const analyticsStore = require('./analyticsStore');

const DEFAULT_PORT = Number(process.env.PORT) || 3000;
const RAW_ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'ra1ph_';
const ENV_ADMIN_HASH = process.env.ADMIN_PASSWORD_HASH;
const ADMIN_PASSWORD_HASH = isHexHash(ENV_ADMIN_HASH)
  ? ENV_ADMIN_HASH.toLowerCase()
  : sha256(RAW_ADMIN_PASSWORD);
const MAX_BODY_SIZE = 1_000_000; // 1 MB
const DEFAULT_ALLOWED_ORIGINS = parseAllowedOrigins(
  process.env.ALLOWED_ORIGINS,
);

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function isHexHash(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

function parseAllowedOrigins(input) {
  if (!input) {
    return ['*'];
  }
  const origins = Array.isArray(input)
    ? input
    : String(input)
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
  return origins.length ? origins : ['*'];
}

function buildCorsHeaders(origin, allowedOrigins) {
  const headers = {
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (allowedOrigins.includes('*')) {
    headers['Access-Control-Allow-Origin'] = '*';
  } else if (origin && allowedOrigins.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  } else {
    headers['Access-Control-Allow-Origin'] = allowedOrigins[0] || '*';
  }
  return headers;
}

function sendJson(res, status, payload, headers = {}) {
  const body = payload === undefined ? '' : JSON.stringify(payload);
  const baseHeaders = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  };
  if (body) {
    baseHeaders['Content-Length'] = Buffer.byteLength(body);
  }
  res.writeHead(status, baseHeaders);
  res.end(body);
}

function sendNoContent(res, headers = {}) {
  res.writeHead(204, {
    'Content-Length': '0',
    ...headers,
  });
  res.end();
}

function readJsonBody(req, limit = MAX_BODY_SIZE) {
  return new Promise((resolve, reject) => {
    let received = 0;
    let data = '';
    req.on('data', (chunk) => {
      received += chunk.length;
      if (received > limit) {
        const error = new Error('Payload too large');
        error.code = 'PAYLOAD_TOO_LARGE';
        req.destroy();
        reject(error);
        return;
      }
      data += chunk;
    });
    req.on('end', () => {
      if (!data) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        err.code = 'INVALID_JSON';
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function extractSecret(payload) {
  if (!payload || typeof payload !== 'object') return null;
  return (
    payload.password ||
    payload.secret ||
    payload.hash ||
    payload.passwordHash ||
    null
  );
}

function verifySecret(secret, expectedHash) {
  if (!secret) return false;
  const normalized = String(secret).trim();
  if (!normalized) return false;
  const inputHash = isHexHash(normalized)
    ? normalized.toLowerCase()
    : sha256(normalized);
  if (inputHash.length !== expectedHash.length) {
    return false;
  }
  try {
    return timingSafeEqual(
      Buffer.from(inputHash, 'hex'),
      Buffer.from(expectedHash, 'hex'),
    );
  } catch (err) {
    return inputHash === expectedHash;
  }
}

function createServer(options = {}) {
  const allowedOrigins = parseAllowedOrigins(options.allowedOrigins || DEFAULT_ALLOWED_ORIGINS);
  const adminHash = (options.adminPasswordHash && isHexHash(options.adminPasswordHash))
    ? options.adminPasswordHash.toLowerCase()
    : options.adminPassword
    ? sha256(options.adminPassword)
    : ADMIN_PASSWORD_HASH;

  const server = http.createServer(async (req, res) => {
    const origin = req.headers.origin || '';
    const corsHeaders = buildCorsHeaders(origin, allowedOrigins);

    if (req.method === 'OPTIONS') {
      sendNoContent(res, corsHeaders);
      return;
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    } catch (err) {
      sendJson(res, 400, { error: 'Invalid request URL' }, corsHeaders);
      return;
    }

    const { pathname } = parsedUrl;

    try {
      if (req.method === 'GET' && pathname === '/api/analytics') {
        const data = await analyticsStore.getData();
        sendJson(res, 200, { data }, corsHeaders);
        return;
      }

      if (req.method === 'POST' && pathname === '/api/analytics/visit') {
        const body = await readJsonBody(req).catch((err) => err);
        if (body instanceof Error) {
          const status = body.code === 'PAYLOAD_TOO_LARGE' ? 413 : 400;
          sendJson(res, status, { error: body.message }, corsHeaders);
          return;
        }
        await analyticsStore.recordVisit(body || {});
        sendJson(res, 200, { success: true }, corsHeaders);
        return;
      }

      if (req.method === 'POST' && pathname === '/api/analytics/click') {
        const body = await readJsonBody(req).catch((err) => err);
        if (body instanceof Error) {
          const status = body.code === 'PAYLOAD_TOO_LARGE' ? 413 : 400;
          sendJson(res, status, { error: body.message }, corsHeaders);
          return;
        }
        await analyticsStore.recordClick(body || {});
        sendJson(res, 200, { success: true }, corsHeaders);
        return;
      }

      if (req.method === 'POST' && pathname === '/api/analytics/clear') {
        const body = await readJsonBody(req).catch((err) => err);
        if (body instanceof Error) {
          const status = body.code === 'PAYLOAD_TOO_LARGE' ? 413 : 400;
          sendJson(res, status, { error: body.message }, corsHeaders);
          return;
        }
        const secret = extractSecret(body);
        if (!verifySecret(secret, adminHash)) {
          sendJson(res, 401, { error: 'Unauthorized' }, corsHeaders);
          return;
        }
        const data = await analyticsStore.clear();
        sendJson(res, 200, { success: true, data }, corsHeaders);
        return;
      }

      sendJson(res, 404, { error: 'Not Found' }, corsHeaders);
    } catch (err) {
      console.error('[AnalyticsServer] Unhandled error:', err);
      sendJson(res, 500, { error: 'Internal Server Error' }, corsHeaders);
    }
  });

  return server;
}

if (require.main === module) {
  const server = createServer();
  server.listen(DEFAULT_PORT, () => {
    console.log(`Analytics API listening on port ${DEFAULT_PORT}`);
  });
}

module.exports = {
  createServer,
  DEFAULT_PORT,
};
