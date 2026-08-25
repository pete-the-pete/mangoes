import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Mirrors `npm run migrate -w core`'s `--env-file-if-exists` layering: later file
// wins over earlier, and a real shell variable beats both. Not `process.loadEnvFile`
// — called twice, that resolves the *first* file's value, inverting the precedence.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fileEnv: Record<string, string | undefined> = {};
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

// Mutating process.env at config module scope rather than `test: { env }` —
// workers inherit the parent's env at spawn. Verified across all three layers,
// but it's the undocumented path: if a Vitest bump ever breaks env loading,
// start here.
export default defineConfig({
  test: {
    environment: "node",
    // Every DB test file here shares one local Postgres and deletes rows from
    // it. Vitest runs files in parallel by default, which turns that sharing
    // into FK violations and rows vanishing mid-test. Sequential files, always
    // — this is correctness, not a speed knob.
    fileParallelism: false,
  },
});
