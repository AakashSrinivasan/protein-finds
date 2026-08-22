'use strict';

module.exports = [
  {
    version: 1,
    name: 'catalog-snapshots-and-import-receipts',
    up(database) {
      database.exec(`
        CREATE TABLE catalog_snapshots (
          revision INTEGER PRIMARY KEY AUTOINCREMENT,
          catalog_version TEXT NOT NULL,
          generated_at TEXT NOT NULL,
          catalog_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          reason TEXT NOT NULL
        ) STRICT;
        CREATE TABLE import_receipts (
          id TEXT PRIMARY KEY,
          imported_at TEXT NOT NULL,
          receipt_json TEXT NOT NULL,
          catalog_revision INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          FOREIGN KEY (catalog_revision) REFERENCES catalog_snapshots(revision)
        ) STRICT;
      `);
    },
    down(database) {
      database.exec('DROP TABLE import_receipts; DROP TABLE catalog_snapshots;');
    }
  }
];
