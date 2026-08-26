// `runMigrations` is Node-only (reads schema.sql via node:fs) but sits in the
// same barrel as pure domain functions like `groupTotal` — a web client
// component importing anything from `core` pulls this module into the same
// dependency graph. That's what `"sideEffects": false` in package.json is
// for: it lets bundlers tree-shake this export away when unused, which is
// the only thing standing between a client bundle and a fatal "node:fs in
// the browser" build error (see the Task 13-15 report). The real fix is
// splitting Node-only exports like this one into a separate `core/db`
// subpath so a client bundle never sees them in the same module graph at
// all — that's a `core` API change and out of scope for the web milestone
// that surfaced it; filed as a follow-up.
export { runMigrations } from "./db/migrate.js";
export * from "./roles/index.js";
export * from "./cohorts/index.js";
export * from "./itemTypes/index.js";
export * from "./cycles/index.js";
export * from "./ledger/index.js";
