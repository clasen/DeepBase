---
id: xzwjssey0w
type: pattern
title: 'Pattern: Drizzle docs use zero-config table setup'
created: '2026-03-27 23:15:55'
---
# Pattern: Drizzle docs use zero-config table setup

**What**: In user-facing docs/examples for `deepbase-drizzle`, do not require passing table creation from outside. Preferred snippet is `new DrizzleDriver({ db, client })` and `await connect()`; the driver infers a default schema and auto-creates the physical table.

**Where used**: `packages/driver-drizzle/src/DrizzleDriver.js` (default table inference), `packages/core/README.md`, `packages/driver-drizzle/README.md`, `examples/14-drizzle-sqlite.js`, `examples/README.md`, `packages/driver-drizzle/test/sqlite-fixture.js`.

**When to apply**: Any new Drizzle integration snippet, migration guide, or README section in DeepBase.

**Exception**: Use explicit `table` only for advanced/custom schemas or unsupported dialects.
