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

export default defineConfig({
  test: {
    environment: "node",
  },
});
