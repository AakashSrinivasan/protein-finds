'use strict';

const crypto = require('node:crypto');
const {validateCatalog} = require('../catalog-contract.js');
const {transaction} = require('./database.js');

function validCatalog(catalog) {
  const errors = validateCatalog(catalog);
  if (errors.length) throw new TypeError(`Catalog is invalid: ${errors.join('; ')}`);
}

class CatalogRepository {
  constructor(database) {
    this.database = database;
  }

  current() {
    const row = this.database.prepare(`SELECT revision, catalog_json FROM catalog_snapshots ORDER BY revision DESC LIMIT 1`).get();
    return row ? {revision: Number(row.revision), catalog: JSON.parse(row.catalog_json)} : null;
  }

  initializeCatalog(catalog, {reason = 'initial-seed', createdAt = new Date().toISOString()} = {}) {
    validCatalog(catalog);
    return transaction(this.database, () => {
      const existing = this.current();
      if (existing) return existing;
      const result = this.database.prepare(`
        INSERT INTO catalog_snapshots (catalog_version, generated_at, catalog_json, created_at, reason)
        VALUES (?, ?, ?, ?, ?)
      `).run(catalog.version, catalog.generatedAt, JSON.stringify(catalog), createdAt, reason);
      return {revision: Number(result.lastInsertRowid), catalog: structuredClone(catalog)};
    });
  }

  commitImport(receipt, catalog, {createdAt = new Date().toISOString(), receiptId} = {}) {
    validCatalog(catalog);
    const receiptJson = JSON.stringify(receipt);
    receiptId ||= crypto.createHash('sha256').update(receiptJson).digest('hex');
    return transaction(this.database, () => {
      const snapshot = this.database.prepare(`
        INSERT INTO catalog_snapshots (catalog_version, generated_at, catalog_json, created_at, reason)
        VALUES (?, ?, ?, ?, ?)
      `).run(catalog.version, catalog.generatedAt, JSON.stringify(catalog), createdAt, `import:${receiptId}`);
      const revision = Number(snapshot.lastInsertRowid);
      this.database.prepare(`
        INSERT INTO import_receipts (id, imported_at, receipt_json, catalog_revision, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(receiptId, receipt.importedAt, receiptJson, revision, createdAt);
      return {revision, receiptId};
    });
  }

  receiptCount() {
    return Number(this.database.prepare('SELECT COUNT(*) AS count FROM import_receipts').get().count);
  }

  receipt(receiptId) {
    const row = this.database.prepare('SELECT catalog_revision FROM import_receipts WHERE id = ?').get(receiptId);
    return row ? {receiptId, revision: Number(row.catalog_revision)} : null;
  }
}

module.exports = {CatalogRepository};
