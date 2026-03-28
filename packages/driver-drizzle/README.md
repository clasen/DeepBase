# deepbase-drizzle

[DeepBase](https://github.com/clasen/DeepBase) driver on top of [Drizzle ORM](https://orm.drizzle.team/). **This package does not depend on any specific database** — you pass a Drizzle `db` built from your dialect (`drizzle-orm/better-sqlite3`, `drizzle-orm/node-postgres`, etc.).

## Install

```bash
npm install deepbase deepbase-drizzle
```

Install your driver separately (e.g. `better-sqlite3`, `pg`, `mysql2`).

`deepbase-drizzle` creates the target table automatically on `connect()` by default.

## API

`DrizzleDriver` expects:

| Option | Purpose |
|--------|---------|
| `db` | `drizzle({ client })` (or equivalent) for your dialect |
| `table` | *(optional)* Custom Drizzle table with **`key`** (PK), **`value`** (text/JSON string), **`seq`** (integer, monotonic insert order) |
| `tableName` | *(optional, default `deepbase_main`)* Used only when `table` is omitted |
| `client` | *(optional)* Underlying handle; if it has `.close()`, it is closed on `disconnect()` |
| `reopen` | *(optional)* Factory returning `{ db, client? }` after a disconnect that cleared `db` — used to reopen file DBs |
| `onDisconnect` | *(optional)* Replaces default close behavior |
| `ensureTable` | *(optional, default `true`)* `true` auto-creates table, `false` disables, function provides custom bootstrap |

If `table` is omitted, the driver infers a default schema from the dialect (`sqlite`, `postgres`, `mysql`) with columns `key`, `value`, `seq`.
Recommended table naming convention: `deepbase_<name>` (for example `deepbase_main`, `deepbase_storybot`) to separate datasets clearly.

## Example: SQLite (better-sqlite3)

```javascript
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import DeepBase from 'deepbase';
import DrizzleDriver from 'deepbase-drizzle';

const sqlite = new Database('app.db');
const db = drizzle({ client: sqlite });

const store = new DeepBase(
  new DrizzleDriver({ db, client: sqlite }),
);
await store.connect(); // creates table automatically if it does not exist
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
