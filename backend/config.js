'use strict';

const path = require('node:path');

const ENVIRONMENTS = new Set(['local', 'test', 'production']);

function integer(value, fallback, name) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) throw new TypeError(`${name} must be an integer from 0 to 65535.`);
  return parsed;
}

function loadConfig(environment = process.env) {
  const name = environment.PF_ENV || 'local';
  if (!ENVIRONMENTS.has(name)) throw new TypeError('PF_ENV must be local, test, or production.');
  const production = name === 'production';
  if (production && !environment.PF_DATABASE_PATH) throw new TypeError('PF_DATABASE_PATH is required in production.');
  if (production && !environment.PF_ADMIN_TOKEN) throw new TypeError('PF_ADMIN_TOKEN is required in production.');
  if (environment.PF_ADMIN_TOKEN && environment.PF_ADMIN_TOKEN.length < 32) throw new TypeError('PF_ADMIN_TOKEN must contain at least 32 characters.');
  if (production && !environment.PF_ALLOWED_ORIGIN) throw new TypeError('PF_ALLOWED_ORIGIN is required in production.');
  if (production && !/^https:\/\//.test(environment.PF_ALLOWED_ORIGIN)) throw new TypeError('PF_ALLOWED_ORIGIN must use https in production.');

  const defaultDatabase = name === 'test' ? ':memory:' : path.resolve('.data', 'protein-finds-local.sqlite');
  const databasePath = environment.PF_DATABASE_PATH || defaultDatabase;
  if (production && !path.isAbsolute(databasePath)) throw new TypeError('PF_DATABASE_PATH must be absolute in production.');
  if (production && environment.PF_INITIAL_CATALOG_PATH && !path.isAbsolute(environment.PF_INITIAL_CATALOG_PATH)) {
    throw new TypeError('PF_INITIAL_CATALOG_PATH must be absolute in production.');
  }

  return Object.freeze({
    environment: name,
    host: environment.PF_HOST || '127.0.0.1',
    port: integer(environment.PF_PORT, name === 'test' ? 0 : 8787, 'PF_PORT'),
    databasePath,
    adminToken: environment.PF_ADMIN_TOKEN || null,
    allowedOrigin: environment.PF_ALLOWED_ORIGIN || 'http://127.0.0.1:4173',
    publicCacheSeconds: integer(environment.PF_PUBLIC_CACHE_SECONDS, 60, 'PF_PUBLIC_CACHE_SECONDS'),
    maxRequestBytes: 1024 * 1024,
    seedFixture: name !== 'production' && environment.PF_SEED_FIXTURE !== 'false',
    initialCatalogPath: environment.PF_INITIAL_CATALOG_PATH || null
  });
}

module.exports = {loadConfig};
