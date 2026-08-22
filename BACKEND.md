# Protein Finds backend boundary

This is the durable, model-free V0 catalog boundary. It uses Node's built-in SQLite driver, so it adds no hosted database SDK or recurring service cost. The existing GitHub Pages PWA remains installable and useful from its cached, explicitly dated demo snapshot when the backend is absent or the device is offline.

The backend is not deployed by this repository change. A production host, paid tier, or wider permission grant remains an owner gate.

## Environments

`PF_ENV` is mandatory only when overriding the safe `local` default.

| Setting | local | test | production |
| --- | --- | --- | --- |
| database | `.data/protein-finds-local.sqlite` | `:memory:` | absolute `PF_DATABASE_PATH` required |
| bind | `127.0.0.1:8787` | ephemeral port | explicit host/port recommended |
| initial catalog | source-honest contract fixture | test fixture | empty, or operator-supplied `PF_INITIAL_CATALOG_PATH` |
| admin writes | disabled without `PF_ADMIN_TOKEN` | explicit test token | 32+ character token required |
| browser origin | `http://127.0.0.1:4173` | test-defined | HTTPS `PF_ALLOWED_ORIGIN` required |

Supported variables:

- `PF_ENV=local|test|production`
- `PF_DATABASE_PATH` (must be absolute in production)
- `PF_ADMIN_TOKEN` (at least 32 characters; never place it in a URL or client code)
- `PF_ALLOWED_ORIGIN`
- `PF_HOST`, `PF_PORT`, and `PF_PUBLIC_CACHE_SECONDS`
- `PF_SEED_FIXTURE=false` to start local/test empty
- `PF_INITIAL_CATALOG_PATH=/absolute/catalog.json` for a one-time operator-controlled production bootstrap

No `.env` loader is included. Pass secrets through the host's secret store. SQLite files, WAL files, and `.data/` are ignored by Git.

## Run locally

```bash
npm run backend:migrate -- up
npm run backend:serve
curl http://127.0.0.1:8787/api/v1/catalog
```

Local reads work immediately from the reviewed fixture. Local writes fail closed until a token is explicit:

```bash
PF_ADMIN_TOKEN='replace-with-a-random-32-plus-character-local-token' npm run backend:serve
```

`POST /api/v1/admin/import` accepts the existing deterministic staging shape (`format`, `input`, `source`, `importedAt`, `maxAgeDays`). It requires `Authorization: Bearer …` and JSON content. Staging is rerun against the current catalog, then the complete import receipt and new catalog revision commit in one SQLite transaction. A duplicate receipt or failed receipt write rolls back the catalog revision.

Identical authorized request bodies are idempotent: the first request returns `201`; a replay returns `200` with `replayed: true` and the original revision without another durable write.

`GET /api/v1/catalog` is public and cacheable. Its response is constructed from an allowlist: catalog identity, store, provenance, media, observations, and conflict state. Raw import rows, receipts, review notes, reviewer identity, admin configuration, and tokens are never serialized. CORS permits the configured app origin; CORS is not treated as write authorization.

## Migrations and recovery

Migration versions live in `backend/migrations.js`; each version has explicit `up` and `down` operations and is tracked in `schema_migrations`.

```bash
npm run backend:migrate -- status
npm run backend:migrate -- up
# destructive: back up the SQLite file first
PF_CONFIRM_MIGRATION_DOWN=yes npm run backend:migrate -- down
```

For backup, stop the single process and copy the SQLite database (or use SQLite's online backup tooling). Restore by replacing the database with the backup before restart. Production boot with `PF_INITIAL_CATALOG_PATH` validates the complete catalog contract before its first write.

## Offline and freshness behavior

The backend returns `generatedAt`, per-observation `observedAt`, `servedAt`, catalog `revision`, an ETag, and `Cache-Control: public, max-age=60, stale-if-error=86400` by default. These fields let a later client adapter distinguish source age from response age. The current PWA deliberately keeps its dated demo catalog and explicit offline/stale labels in the service-worker cache; it does not imply that cached price or inventory became live because an API exists.

## Free-tier limits and exit path

This design is appropriate for one low-traffic process with a persistent disk:

- SQLite has one write authority and no multi-region replication or automatic high availability.
- Host free tiers may sleep, cap disk/egress, or erase ephemeral disks; use only a host that provides persistent storage and backups.
- The API performs no model calls and has a 1 MiB request cap.
- Do not run multiple writers against copied SQLite files.

The exit boundary is intentionally portable. `catalog_snapshots.catalog_json` and `import_receipts.receipt_json` preserve complete versioned JSON documents; copy/export those rows, load them into the replacement database, and keep the same public/admin HTTP contracts. Migrate to managed Postgres/Turso/D1 only when traffic, multi-writer needs, or durability requirements justify it. The source contract and importer do not depend on SQLite-specific record shapes.
