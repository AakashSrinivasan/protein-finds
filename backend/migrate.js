'use strict';

const {loadConfig} = require('./config.js');
const {openDatabase, migrate, migrationStatus} = require('./database.js');

const direction = process.argv[2] || 'status';
const config = loadConfig();
const database = openDatabase(config.databasePath);
try {
  if (direction === 'status') {
    process.stdout.write(`${JSON.stringify(migrationStatus(database))}\n`);
  } else if (direction === 'up') {
    process.stdout.write(`${JSON.stringify(migrate(database, 'up'))}\n`);
  } else if (direction === 'down') {
    if (process.env.PF_CONFIRM_MIGRATION_DOWN !== 'yes') {
      throw new TypeError('Set PF_CONFIRM_MIGRATION_DOWN=yes after taking a backup to reverse the latest migration.');
    }
    process.stdout.write(`${JSON.stringify(migrate(database, 'down'))}\n`);
  } else {
    throw new TypeError('Usage: npm run backend:migrate -- [status|up|down]');
  }
} finally {
  database.close();
}
