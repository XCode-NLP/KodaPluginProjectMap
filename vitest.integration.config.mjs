import path from "node:path";
import { defineConfig } from "vitest/config";

const desktopRoot = path.resolve(process.env.KODA_DESKTOP_ROOT ?? "../koda-app");

export default defineConfig({
  resolve: { alias: { "@desktop": desktopRoot } },
  test: { include: ["integration/**/*.test.ts"] },
});
