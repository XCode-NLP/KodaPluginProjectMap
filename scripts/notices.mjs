// Collects the licenses of third-party packages that end up inside the plugin bundle.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const PACKAGE = /^(.*[\\/]node_modules[\\/](?:@[^\\/]+[\\/])?[^\\/]+)[\\/]/;
const LICENSE_FILE = /^(licen[cs]e|copying|notice|third_party_notices)(\.(md|txt))?$/i;

/** Write license texts of every package whose files appear in `inputs` (absolute or relative paths). */
export function writeNotices(inputs, outFile) {
  const roots = new Set();
  for (const input of inputs) {
    const match = PACKAGE.exec(path.resolve(input.replace(/^\0/, "").replace(/\?.*$/, "")));
    if (match) roots.add(match[1]);
  }
  const sections = [];
  for (const root of [...roots].sort()) {
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
    } catch {
      continue;
    }
    const texts = readdirSync(root)
      .filter((file) => LICENSE_FILE.test(file))
      .sort()
      .map((file) => readFileSync(path.join(root, file), "utf8").trim());
    const license = typeof manifest.license === "string" ? manifest.license : "see package";
    const header = `${manifest.name}@${manifest.version} (${license})`;
    sections.push([header, "-".repeat(header.length), texts.join("\n\n") || `License: ${license}`].join("\n"));
  }
  const unique = [...new Map(sections.map((section) => [section.split("\n")[0], section])).values()];
  writeFileSync(
    outFile,
    `Third-party software bundled into this plugin.\n\n${unique.join("\n\n\n")}\n`,
  );
  return unique.length;
}
