'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {DatabaseSync} = require('node:sqlite');
const migrations = require('./migrations.js');

function openDatabase(databasePath) {
  if (databasePath !== ':memory:') {
    const absolute = path.resolve(databasePath);
    fs.mkdirSync(path.dirname(absolute), {recursive: true, mode: 0o700});
    try {
      if (fs.lstatSync(absolute).isSymbolicLink()) throw new TypeError('Database path cannot be a symbolic link.');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    databasePath = absolute;
  }
  const database = new DatabaseSync(databasePath);
  database.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  if (databasePath !== ':memory:') fs.chmodSync(databasePath, 0o600);
  return database;
}

function ensureMigrationTable(database) {
  database.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  ) STRICT;`);
}

function migrationStatus(database) {
  ensureMigrationTable(database);
  const applied = database.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map(row => Number(row.version));
  return {applied, pending: migrations.map(item => item.version).filter(version => !applied.includes(version))};
}

function transaction(database, operation) {
  database.exec('BEGIN IMMEDIATE;');
  try {
    const result = operation();
    database.exec('COMMIT;');
    return result;
  } catch (error) {
    database.exec('ROLLBACK;');
    throw error;
  }
}

function migrate(database, direction = 'up', now = new Date().toISOString()) {
  ensureMigrationTable(database);
  if (direction === 'up') {
    const {pending} = migrationStatus(database);
    for (const version of pending) {
      const migration = migrations.find(item => item.version === version);
      transaction(database, () => {
        migration.up(database);
        database.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
          .run(migration.version, migration.name, now);
      });
    }
    return {applied: pending.length};
  }
  if (direction === 'down') {
    const {applied} = migrationStatus(database);
    const version = applied.at(-1);
    if (version === undefined) return {reverted: 0};
    const migration = migrations.find(item => item.version === version);
    if (!migration) throw new TypeError(`Applied migration ${version} is not available for reversal.`);
    transaction(database, () => {
      migration.down(database);
      database.prepare('DELETE FROM schema_migrations WHERE version = ?').run(version);
    });
    return {reverted: 1};
  }
  throw new TypeError('Migration direction must be up or down.');
}

module.exports = {openDatabase, migrate, migrationStatus, transaction};
