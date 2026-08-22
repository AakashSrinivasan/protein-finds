'use strict';

const fs = require('node:fs');
const {loadConfig} = require('./config.js');
const {openDatabase, migrate} = require('./database.js');
const {CatalogRepository} = require('./catalog-repository.js');
const {createBackendServer} = require('./server.js');

const config = loadConfig();
const database = openDatabase(config.databasePath);
migrate(database, 'up');
const repository = new CatalogRepository(database);

if (!repository.current()) {
  if (config.seedFixture) {
    repository.initializeCatalog(require('../catalog-fixtures.js'), {reason: 'local-fixture-seed'});
  } else if (config.initialCatalogPath) {
    repository.initializeCatalog(JSON.parse(fs.readFileSync(config.initialCatalogPath, 'utf8')), {reason: 'operator-bootstrap'});
  }
}

const backend = createBackendServer({config, repository});
backend.listen().then(() => {
  const address = backend.address();
  process.stdout.write(`Protein Finds backend listening on http://${address.address}:${address.port} (${config.environment})\n`);
}).catch(error => {
  database.close();
  throw error;
});

async function shutdown() {
  await backend.close();
  database.close();
}
process.once('SIGINT', () => shutdown().then(() => process.exit(0)));
process.once('SIGTERM', () => shutdown().then(() => process.exit(0)));
