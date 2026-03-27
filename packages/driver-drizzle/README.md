# deepbase-drizzle

[DeepBase](https://github.com/clasen/DeepBase) driver on top of [Drizzle ORM](https://orm.drizzle.team/). **This package does not depend on any specific database** — you pass a Drizzle `db` built from your dialect (`drizzle-orm/better-sqlite3`, `drizzle-orm/node-postgres`, etc.) and a matching table schema.

## Install

```bash
npm install deepbase deepbase-drizzle drizzle-orm
```

Install your driver separately (e.g. `better-sqlite3`, `pg`, `mysql2`).

## API

`DrizzleDriver` expects:

| Option | Purpose |
|--------|---------|
| `db` | `drizzle({ client })` (or equivalent) for your dialect |
| `table` | Drizzle table with **`key`** (PK), **`value`** (text/JSON string), **`seq`** (integer, monotonic insert order) |
| `client` | *(optional)* Underlying handle; if it has `.close()`, it is closed on `disconnect()` |
| `reopen` | *(optional)* Factory returning `{ db, client? }` after a disconnect that cleared `db` — used to reopen file DBs |
| `onDisconnect` | *(optional)* Replaces default close behavior |

You must create/migrate the table in your app. Example DDL for SQLite:

```sql
CREATE TABLE deepbase (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  seq INTEGER NOT NULL DEFAULT 0
);
```

## Example: SQLite (better-sqlite3)

```javascript
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import DeepBase from 'deepbase';
import DrizzleDriver from 'deepbase-drizzle';

const deepbase = sqliteTable('deepbase', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  seq: integer('seq').notNull().default(0),
});

const sqlite = new Database('app.db');
// … run CREATE TABLE / migrations …
const db = drizzle({ client: sqlite });

const store = new DeepBase(
  new DrizzleDriver({ db, table: deepbase, client: sqlite }),
);
await store.connect();
await store.set('user', 'alice', { age: 30 });
```

The monorepo tests use [`test/sqlite-fixture.js`](test/sqlite-fixture.js) (`createSqliteDrizzleDriver`) as a **dev-only** helper; it is not part of the published API.

## Semantics

- Same nested-key behavior as `deepbase-sqlite` (dot paths, `LIKE` escape, `seq` for stable `Object.keys` / `shift` / `pop`).
- Upserts: new rows get `seq = MAX(seq)+1`; updates to an existing `key` only change `value` (`seq` unchanged).

## Benchmarks

Repo benchmarks build SQLite via the test fixture; your app wires whatever Drizzle dialect you use.

```bash
npm run bench:drizzle
```
