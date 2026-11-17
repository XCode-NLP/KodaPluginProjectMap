// Собирает dist/<id>-<version>.kodaplugin и печатает SHA-256 для каталога.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync("koda-plugin.json", "utf8"));
const archive = `${manifest.id}-${manifest.version}.kodaplugin`;
const out = `dist/${archive}`;
mkdirSync("dist", { recursive: true });
execFileSync("npx", ["koda-plugin", "pack", ".", "--out", out], { stdio: "inherit" });
const sha256 = createHash("sha256").update(readFileSync(out)).digest("hex");
writeFileSync("dist/SHA256SUMS", `${sha256}  ${archive}\n`);
console.log(`\n${out}\nsha256: ${sha256}`);
