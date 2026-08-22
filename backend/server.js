'use strict';

const crypto = require('node:crypto');
const http = require('node:http');
const {stageCatalogImport, applyAcceptedImport} = require('../catalog-import.js');
const {publicCatalog} = require('./public-catalog.js');

function authorized(header, token) {
  if (!token || typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
  const supplied = Buffer.from(header.slice(7));
  const expected = Buffer.from(token);
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

function readJson(request, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on('data', chunk => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new TypeError('Request body is too large.'), {statusCode: 413}));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(Object.assign(new TypeError('Request body must be valid JSON.'), {statusCode: 400})); }
    });
    request.on('error', reject);
  });
}

function createBackendServer({config, repository, now = () => new Date().toISOString()}) {
  const server = http.createServer(async (request, response) => {
    const origin = request.headers.origin;
    if (origin === config.allowedOrigin) response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
    response.setHeader('X-Content-Type-Options', 'nosniff');

    const send = (status, body, extraHeaders = {}) => {
      response.writeHead(status, {'content-type': 'application/json; charset=utf-8', ...extraHeaders});
      response.end(JSON.stringify(body));
    };

    if (request.method === 'OPTIONS') {
      if (origin !== config.allowedOrigin) return send(403, {error: 'origin_not_allowed'});
      response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      return send(204, null);
    }

    const url = new URL(request.url, 'http://backend.local');
    if (request.method === 'GET' && url.pathname === '/health') return send(200, {status: 'ok'});

    if (request.method === 'GET' && url.pathname === '/api/v1/catalog') {
      const current = repository.current();
      if (!current) return send(503, {error: 'catalog_unavailable'});
      const body = publicCatalog(current.catalog, {revision: current.revision, servedAt: now()});
      const etag = `"${crypto.createHash('sha256').update(JSON.stringify({revision: current.revision, catalog: current.catalog})).digest('base64url')}"`;
      if (request.headers['if-none-match'] === etag) {
        response.writeHead(304, {ETag: etag, 'Cache-Control': `public, max-age=${config.publicCacheSeconds}, stale-if-error=86400`});
        return response.end();
      }
      return send(200, body, {ETag: etag, 'Cache-Control': `public, max-age=${config.publicCacheSeconds}, stale-if-error=86400`});
    }

    if (request.method === 'POST' && url.pathname === '/api/v1/admin/import') {
      response.setHeader('Cache-Control', 'no-store');
      if (!authorized(request.headers.authorization, config.adminToken)) return send(401, {error: 'unauthorized'});
      if (!/^application\/json(?:;|$)/i.test(request.headers['content-type'] || '')) return send(415, {error: 'json_required'});
      try {
        const payload = await readJson(request, config.maxRequestBytes);
        const current = repository.current();
        if (!current) return send(503, {error: 'catalog_unavailable'});
        const receiptId = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
        const replay = repository.receipt(receiptId);
        if (replay) return send(200, {...replay, replayed: true});
        const receipt = stageCatalogImport({...payload, canonical: current.catalog});
        const nextCatalog = applyAcceptedImport(current.catalog, receipt);
        const committed = repository.commitImport(receipt, nextCatalog, {createdAt: now(), receiptId});
        return send(201, {revision: committed.revision, receiptId: committed.receiptId, summary: receipt.summary, results: receipt.results});
      } catch (error) {
        return send(error.statusCode || 400, {error: 'import_rejected', message: error.message});
      }
    }

    return send(404, {error: 'not_found'});
  });

  return {
    listen: () => new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(config.port, config.host, () => { server.off('error', reject); resolve(); });
    }),
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
    address: () => server.address()
  };
}

module.exports = {createBackendServer};
