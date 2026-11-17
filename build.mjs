import { copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import { build } from "vite";
import { writeNotices } from "./scripts/notices.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
// Every module that ends up in either bundle; its packages get their licenses into the UI folder.
const bundled = new Set();

await build({
  configFile: false,
  logLevel: "warn",
  plugins: [
    {
      name: "collect-modules",
      generateBundle() {
        for (const id of this.getModuleIds()) bundled.add(id);
      },
    },
  ],
  build: {
    lib: { entry: path.join(root, "src/main.ts"), formats: ["cjs"], fileName: () => "main.js" },
    outDir: path.join(root, "bundle"),
    emptyOutDir: true,
    minify: true,
    sourcemap: false,
    rollupOptions: { output: { exports: "named" } },
  },
});

const ui = await esbuild({
  absWorkingDir: root,
  entryPoints: ["src/ui/app.ts"],
  outfile: "bundle/ui/app.js",
  bundle: true,
  format: "iife",
  target: "es2022",
  minify: true,
  metafile: true,
});
for (const input of Object.keys(ui.metafile.inputs)) bundled.add(path.join(root, input));
for (const file of ["index.html", "style.css"]) await copyFile(path.join(root, "src/ui", file), path.join(root, "bundle/ui", file));
writeNotices([...bundled], path.join(root, "bundle/ui/THIRD_PARTY_NOTICES.txt"));
