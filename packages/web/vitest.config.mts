import { defineConfig } from "vitest/config";

// `.mts`, not `.ts`: packages/web is not `"type": "module"`, so a .ts config gets
// loaded as CommonJS and Vite warns about the ESM syntax.
// No env-file layering here, unlike packages/core's config: these tests inject a
// fake UserRoleStore and never open a Postgres connection.
export default defineConfig({
  resolve: {
    // Vite resolves tsconfig `paths` natively now; the vite-tsconfig-paths
    // plugin the plan called for is obsolete.
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
  },
});
