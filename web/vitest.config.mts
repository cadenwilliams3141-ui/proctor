/* Vitest needs the same "@/" alias tsconfig gives the app.
 *
 * Without this, an aliased import only works when it is `import type`, because
 * those are erased before anything tries to resolve them. Every aliased import
 * in a tested module happened to be type-only until technique.ts imported a
 * runtime constant, at which point the suite failed to load the file at all.
 * Pointing the alias at the repo root here means a test resolves modules the
 * same way `next build` does, rather than by accident.
 *
 * .mts because the file uses ESM syntax and the nearest package.json has no
 * "type": "module"; loaded as .ts, Vite warns that it is reading ESM as CJS. */

import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
});
