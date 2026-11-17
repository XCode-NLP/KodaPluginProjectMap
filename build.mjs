import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const root = path.dirname(fileURLToPath(import.meta.url));
await build({
  configFile: false,
  build: {
    lib: { entry: path.join(root, "src/main.ts"), formats: ["cjs"], fileName: () => "main.js" },
    outDir: path.join(root, "bundle"),
    emptyOutDir: true,
    minify: true,
    sourcemap: false,
  },
});
