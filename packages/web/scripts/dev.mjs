import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";

// `next dev` reads .env files relative to packages/web, so it never sees the
// repo-root .env.dev that holds the local DATABASE_URL. This layers them in the
// same order as `npm run migrate -w core`: later file wins over earlier, and a
// real shell variable beats both.
//
// Loaded here in JS rather than with node's --env-file-if-exists flag, the way
// migrate does it: `next dev` forks a child server and rebuilds NODE_OPTIONS
// from the parent's execArgv, and node rejects --env-file-if-exists inside
// NODE_OPTIONS. Spawning a clean child sidesteps that; the child still inherits
// process.env, which is where the values actually matter.
//
// Not `process.loadEnvFile` — called twice, that resolves the *first* file's
// value, inverting the precedence (same trap noted in core's vitest.config.ts).
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");

const fileEnv = {};
for (const name of [".env.dev", ".env"]) {
  const file = path.join(repoRoot, name);
  if (existsSync(file)) {
    Object.assign(fileEnv, parseEnv(readFileSync(file, "utf8")));
  }
}
for (const [key, value] of Object.entries(fileEnv)) {
  if (process.env[key] === undefined && value !== undefined) {
    process.env[key] = value;
  }
}

const nextBin = path.join(repoRoot, "node_modules/next/dist/bin/next");
const child = spawn(process.execPath, [nextBin, "dev", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: process.env,
});
child.on("exit", (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});
