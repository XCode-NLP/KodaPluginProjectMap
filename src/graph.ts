export interface FileInfo {
  path: string;
  size: number;
  modifiedAt: number;
}
export interface SourceFile extends FileInfo {
  hash: string;
  imports: Array<{ spec: string; line: number; kind?: string }>;
  language: string;
  /** Project files this file imports, resolved; drives folder-level edges in the drill-down map. */
  deps?: string[];
}
export interface Module {
  id: string;
  name: string;
  description: string;
  files: string[];
}
export interface Evidence {
  path: string;
  line: number;
  spec: string;
}
export interface Edge {
  from: string;
  to: string;
  source: "code" | "model";
  evidence: Evidence[];
  reason?: string;
}
export const GROUP_ROLES = [
  "entry",
  "api",
  "domain",
  "data",
  "integration",
  "ui",
  "infra",
  "shared",
  "tests",
  "config",
  "docs",
  "tooling",
] as const;
export type GroupRole = (typeof GROUP_ROLES)[number];
/** A meaningful part of the project named by the agent; leaves own files, parents only group. */
export interface SemanticGroup {
  id: string;
  name: string;
  description: string;
  parent: string | null;
  role: GroupRole | null;
  /** Project-relative folders or files; a file goes to the leaf with the longest matching path. */
  paths: string[];
}
export interface Semantic {
  summary: string;
  groups: SemanticGroup[];
  relations: Array<{ from: string; to: string; reason: string }>;
  builtAt: number;
}
/** Files no leaf claimed. */
export const OTHER_GROUP = "other";
export interface Graph {
  projectPath: string;
  semantic?: Semantic;
  version: string;
  fingerprint: string;
  modules: Module[];
  edges: Edge[];
  files: SourceFile[];
  limitations: string[];
  builtAt: number;
}
export interface Impact {
  version: string;
  task: string;
  items: Array<{ moduleId: string; category: "direct" | "indirect" | "check"; reason: string; evidence: Evidence[] }>;
}

export function hash(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16);
}
export function normalize(p: string): string {
  const parts: string[] = [];
  for (const s of p.replaceAll("\\", "/").split("/")) {
    if (s === "..") parts.pop();
    else if (s && s !== ".") parts.push(s);
  }
  return parts.join("/");
}
const dir = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
const language = (p: string) =>
  /\.[cm]?[jt]sx?$/.test(p) ? "js" : p.endsWith(".py") ? "python" : p.endsWith(".go") ? "go" : "other";

interface Token {
  value: string;
  string: boolean;
  line: number;
}
/** Small import lexer: strings/comments are tokens, never searched as source text. */
function tokens(source: string, lang: string): Token[] {
  const out: Token[] = [];
  let i = 0,
    line = 1;
  while (i < source.length) {
    const c = source[i];
    if (c === "\n") {
      out.push({ value: "\n", string: false, line });
      line++;
      i++;
      continue;
    }
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if ((lang === "python" && c === "#") || (lang === "go" && source.slice(i, i + 2) === "//")) {
      while (i < source.length && source[i] !== "\n") i++;
      continue;
    }
    if (lang === "go" && source.slice(i, i + 2) === "/*") {
      i += 2;
      while (i < source.length && source.slice(i, i + 2) !== "*/") {
        if (source[i++] === "\n") line++;
      }
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || (lang === "go" && c === "`")) {
      const start = line;
      const triple = lang === "python" && source.slice(i, i + 3) === c.repeat(3);
      const quote = triple ? c.repeat(3) : c;
      i += quote.length;
      let value = "";
      while (i < source.length && source.slice(i, i + quote.length) !== quote) {
        if (source[i] === "\n") line++;
        if (source[i] === "\\" && c !== "`") {
          value += source.slice(i, i + 2);
          i += 2;
        } else value += source[i++];
      }
      i += quote.length;
      out.push({ value: triple ? "" : value, string: true, line: start });
      continue;
    }
    const word = /^[A-Za-z_][A-Za-z_0-9]*/.exec(source.slice(i));
    if (word) {
      out.push({ value: word[0], string: false, line });
      i += word[0].length;
    } else {
      out.push({ value: c, string: false, line });
      i++;
    }
  }
  return out;
}

export function extractImports(
  p: string,
  text: string,
  parseJs?: (source: string, typescript: boolean, jsx: boolean) => unknown,
): SourceFile["imports"] {
  const lang = language(p),
    imports: SourceFile["imports"] = [];
  if (lang === "js") {
    if (!parseJs) throw new Error("JavaScript parser unavailable");
    // JSX is off for plain .ts: it would reject `<T>value` assertions and `<T>(x: T) =>` generics.
    const ast = parseJs(text, /\.[cm]?tsx?$/.test(p), !/\.[cm]?ts$/.test(p));
    const visit = (node: any): void => {
      if (!node || typeof node !== "object") return;
      const line = node.loc?.start?.line ?? 1;
      if (
        ["ImportDeclaration", "ExportNamedDeclaration", "ExportAllDeclaration"].includes(node.type) &&
        node.source?.value
      )
        imports.push({ spec: node.source.value, line });
      if (
        node.type === "CallExpression" &&
        ((node.callee?.type === "Identifier" && node.callee.name === "require") || node.callee?.type === "Import") &&
        typeof node.arguments?.[0]?.value === "string"
      )
        imports.push({ spec: node.arguments[0].value, line });
      if (node.type === "ImportExpression" && typeof node.source?.value === "string")
        imports.push({ spec: node.source.value, line });
      for (const [key, value] of Object.entries(node)) {
        if (["loc", "tokens", "comments", "extra"].includes(key)) continue;
        if (Array.isArray(value)) value.forEach(visit);
        else if (value && typeof value === "object") visit(value);
      }
    };
    visit(ast);
    return imports;
  }
  const ts = tokens(text, lang);
  for (let i = 0; i < ts.length; i++) {
    const t = ts[i];
    if (t.string) continue;
    if (lang === "go" && t.value === "import") {
      let j = i + 1;
      const group = ts[j]?.value === "(";
      if (group) j++;
      for (; j < ts.length; j++) {
        const token = ts[j];
        if (token.string) imports.push({ spec: token.value, line: token.line });
        if (group ? token.value === ")" : token.value === "\n" || token.value === ";") break;
      }
      i = j;
    }
    if (lang === "python" && t.value === "from") {
      let j = i + 1,
        spec = "";
      while (j < ts.length && !["import", "\n"].includes(ts[j].value)) spec += ts[j++].value;
      if (ts[j]?.value === "import") {
        imports.push({ spec, line: t.line, kind: "from" });
        // A parenthesized member list may span several lines.
        let open = false;
        while (++j < ts.length && (open || ts[j].value !== "\n")) {
          if (ts[j].value === "(") open = true;
          else if (ts[j].value === ")") {
            open = false;
            continue;
          }
          if (!ts[j].string && /^[A-Za-z_]/.test(ts[j].value) && ts[j - 1]?.value !== "as" && ts[j].value !== "as")
            imports.push({
              spec: `${spec}${spec.endsWith(".") ? "" : "."}${ts[j].value}`,
              line: t.line,
              kind: "from-member",
            });
        }
        i = j;
      }
    } else if (lang === "python" && t.value === "import") {
      let j = i + 1,
        spec = "";
      for (; j <= ts.length; j++) {
        const v = ts[j]?.value ?? "\n";
        if ([",", "\n", ";", "as"].includes(v)) {
          if (spec) imports.push({ spec, line: t.line });
          spec = "";
          if (v === "as") {
            j++;
            continue;
          }
          if (v !== ",") break;
        } else spec += v;
      }
      i = j;
    }
  }
  return imports;
}

/**
 * The tsconfig that governs a file: the nearest directory wins, and inside one
 * directory the canonical tsconfig.json/jsconfig.json beats variants such as
 * tsconfig.electron.json.
 */
export function nearestConfig(configs: Record<string, any>, file: string): string | undefined {
  const rank = (p: string) => (/(?:^|\/)[tj]sconfig\.json$/.test(p) ? 0 : 1);
  return Object.keys(configs)
    .filter((p) => /(?:ts|js)config[^/]*\.json$/.test(p) && (!dir(p) || file.startsWith(dir(p) + "/")))
    .sort((a, b) => dir(b).length - dir(a).length || rank(a) - rank(b) || a.localeCompare(b))[0];
}

export function fingerprint(files: FileInfo[]): string {
  return hash(
    files
      .map((f) => `${f.path}:${f.size}:${f.modifiedAt}`)
      .sort()
      .join("\n"),
  );
}

export function buildGraph(
  projectPath: string,
  files: SourceFile[],
  configs: Record<string, any>,
  limitations: string[],
  previous?: Graph,
): Graph {
  const all = new Set(files.map((f) => f.path));
  const modules: Module[] = [],
    owner = new Map<string, string>();
  for (const old of previous?.modules ?? []) {
    const keep = old.files.filter((f) => all.has(f));
    if (keep.length) {
      modules.push({ ...old, files: keep });
      keep.forEach((f) => owner.set(f, old.id));
    }
  }
  for (const f of files) {
    if (owner.has(f.path)) continue;
    const parts = f.path.split("/");
    const root =
      parts.length === 1
        ? "root"
        : parts.slice(0, parts[0] === "src" || parts[0] === "packages" || parts[0] === "apps" ? 2 : 1).join("/");
    const id = `m-${hash(root)}`;
    let module = modules.find((m) => m.id === id);
    if (!module) {
      module = { id, name: root, description: "", files: [] };
      modules.push(module);
    }
    module.files.push(f.path);
    owner.set(f.path, id);
  }
  const resolveFile = (candidate: string): string[] => {
    const clean = normalize(candidate);
    if (all.has(clean)) return [clean];
    const noJs = clean.replace(/\.[cm]?jsx?$/, "");
    for (const suffix of [
      ".ts",
      ".tsx",
      ".mts",
      ".cts",
      ".js",
      ".jsx",
      ".mjs",
      ".cjs",
      ".py",
      "/index.ts",
      "/index.tsx",
      "/index.js",
      "/__init__.py",
    ]) {
      if (all.has(clean + suffix)) return [clean + suffix];
      if (noJs !== clean && all.has(noJs + suffix)) return [noJs + suffix];
    }
    const pkg = configs[`${clean}/package.json`];
    const entry = pkg?.exports?.["."] ?? pkg?.exports;
    const target =
      typeof entry === "string"
        ? entry
        : (entry?.types ?? entry?.import ?? entry?.default ?? pkg?.source ?? pkg?.module ?? pkg?.main);
    if (typeof target === "string" && normalize(`${clean}/${target}`) !== clean) {
      const direct = normalize(`${clean}/${target}`);
      if (all.has(direct)) return [direct];
      for (const ext of [".ts", ".js", "/index.ts"]) if (all.has(direct + ext)) return [direct + ext];
    }
    return [];
  };
  const edges = new Map<string, Edge>();
  let unresolved = 0;
  for (const f of files) {
    const deps = new Set<string>();
    for (const imp of f.imports) {
      let targets: string[] = [];
      if (f.language === "js") {
        if (imp.spec.startsWith(".")) targets = resolveFile(`${dir(f.path)}/${imp.spec}`);
        else {
          const configPath = nearestConfig(configs, f.path);
          const options = configPath ? configs[configPath]?.compilerOptions : undefined;
          if (configPath && options) {
            const base = configs[configPath].resolutionBase ?? `${dir(configPath)}/${options.baseUrl ?? "."}`;
            for (const [pattern, replacements] of Object.entries(options.paths ?? {}) as Array<[string, string[]]>) {
              const [head, tail = ""] = pattern.split("*");
              if (pattern.includes("*") ? imp.spec.startsWith(head) && imp.spec.endsWith(tail) : pattern === imp.spec) {
                const middle = imp.spec.slice(head.length, tail ? -tail.length : undefined);
                for (const replacement of replacements) {
                  targets = resolveFile(`${base}/${replacement.replace("*", middle)}`);
                  if (targets.length) break;
                }
              }
              if (targets.length) break;
            }
            if (!targets.length && options.baseUrl) targets = resolveFile(`${base}/${imp.spec}`);
          }
          if (!targets.length)
            for (const [p, pkg] of Object.entries(configs))
              if (
                p.endsWith("package.json") &&
                pkg.name &&
                (imp.spec === pkg.name || imp.spec.startsWith(pkg.name + "/"))
              ) {
                const subpath = imp.spec.slice(pkg.name.length).replace(/^\//, "");
                const exports = pkg.exports;
                let exported = exports?.[subpath ? `./${subpath}` : "."];
                if (!subpath && (typeof exports === "string" || exports?.import || exports?.types || exports?.default))
                  exported = exports;
                if (typeof exported === "object" && exported)
                  exported = exported.types ?? exported.import ?? exported.default;
                if (typeof exported === "string") targets = resolveFile(`${dir(p)}/${exported}`);
                if (targets.length) break;
                targets = resolveFile(`${dir(p)}/${subpath}`);
                if (targets.length) break;
              }
        }
      } else if (f.language === "python") {
        const dots = /^\.+/.exec(imp.spec)?.[0].length ?? 0;
        const spec = imp.spec.slice(dots).replaceAll(".", "/");
        if (dots) targets = resolveFile(`${dir(f.path)}/${"../".repeat(dots - 1)}${spec}`);
        else
          for (const root of ["", "src/", `${dir(f.path)}/`]) {
            targets = resolveFile(root + spec);
            if (targets.length) break;
          }
      } else if (f.language === "go") {
        // Nested modules: the longest matching module path owns the import.
        const match = Object.entries(configs)
          .filter(
            ([p, v]) =>
              p.endsWith("go.mod") &&
              typeof v?.module === "string" &&
              (imp.spec === v.module || imp.spec.startsWith(v.module + "/")),
          )
          .sort((a, b) => b[1].module.length - a[1].module.length)[0];
        if (match) {
          const [p, config] = match;
          const targetDir = normalize(`${dir(p)}/${imp.spec.slice(config.module.length)}`);
          targets = files
            .filter(
              (target) =>
                target.language === "go" && dir(target.path) === targetDir && !target.path.endsWith("_test.go"),
            )
            .map((target) => target.path);
        }
      }
      if (!targets.length) {
        if (imp.spec.startsWith(".") || f.language !== "js") unresolved++;
        continue;
      }
      for (const target of targets) {
        if (target !== f.path) deps.add(target);
        const from = owner.get(f.path)!,
          to = owner.get(target)!;
        if (from === to) continue;
        const key = `${from}:${to}`;
        const edge = edges.get(key) ?? { from, to, source: "code" as const, evidence: [] };
        if (edge.evidence.length < 12) edge.evidence.push({ path: f.path, line: imp.line, spec: imp.spec });
        edges.set(key, edge);
      }
    }
    f.deps = [...deps].sort();
  }
  if (unresolved) limitations.push(`Unresolved imports (including external packages): ${unresolved}`);
  limitations.push("Dynamic loading, reflection, Python runtime paths and Go build tags are not evaluated.");
  if (files.some((f) => f.language === "other"))
    limitations.push("Import analysis supports JS/TS, Python and Go; other files are shown structurally.");
  const modelEdges =
    previous?.edges.filter(
      (e) => e.source === "model" && modules.some((m) => m.id === e.from) && modules.some((m) => m.id === e.to),
    ) ?? [];
  const graph: Graph = {
    projectPath,
    modules: modules.sort((a, b) => a.name.localeCompare(b.name)),
    edges: [...edges.values(), ...modelEdges],
    files,
    limitations: [...new Set(limitations)],
    fingerprint: fingerprint(files),
    builtAt: Date.now(),
    version: "",
  };
  graph.version = hash(
    JSON.stringify({ files: files.map((f) => [f.path, f.hash]), modules: graph.modules, edges: graph.edges }),
  );
  return graph;
}

export function validateImpact(graph: Graph, value: Impact): Impact {
  if (!value || value.version !== graph.version) throw new Error("Map version changed; read the map again");
  if (
    typeof value.task !== "string" ||
    !value.task.trim() ||
    value.task.length > 4000 ||
    !Array.isArray(value.items) ||
    value.items.length > 200
  )
    throw new Error("Invalid impact report");
  const ids = new Set<string>();
  const files = new Set(graph.files.map((f) => f.path));
  for (const item of value.items) {
    if (!graph.modules.some((m) => m.id === item.moduleId) || ids.has(item.moduleId))
      throw new Error("Unknown or duplicate module");
    ids.add(item.moduleId);
    if (
      !["direct", "indirect", "check"].includes(item.category) ||
      typeof item.reason !== "string" ||
      !item.reason.trim() ||
      item.reason.length > 4000
    )
      throw new Error("Every affected module needs a category and explanation");
    if (
      !Array.isArray(item.evidence) ||
      !item.evidence.length ||
      item.evidence.length > 20 ||
      item.evidence.some(
        (e) =>
          !files.has(e.path) ||
          !Number.isInteger(e.line) ||
          e.line < 1 ||
          typeof e.spec !== "string" ||
          e.spec.length > 1000,
      )
    )
      throw new Error("Every explanation needs existing source file references");
  }
  return value;
}

const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");

/**
 * Checks the agent's answer against the indexed files: unknown paths are dropped, ids become slugs,
 * parents must exist and form a tree no deeper than four levels, and a group that ends up with no
 * files is removed. Files nobody claims land in the `other` group.
 */
export function validateSemantic(raw: unknown, files: string[]): Semantic {
  const input = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const all = new Set(files);
  const folders = new Set<string>();
  for (const f of files) for (let d = dir(f); d; d = dir(d)) folders.add(d);
  const slug = (value: unknown) =>
    text(value, 80)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  const groups: SemanticGroup[] = [];
  const ids = new Set<string>([OTHER_GROUP]);
  const rawGroups = Array.isArray(input.groups) ? input.groups.slice(0, 150) : [];
  for (const item of rawGroups) {
    const g = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    let id = slug(g.id) || slug(g.name);
    if (!id) continue;
    for (let n = 2; ids.has(id); n++) id = `${slug(g.id) || slug(g.name)}-${n}`;
    const name = text(g.name, 120);
    if (!name) continue;
    ids.add(id);
    const paths = (Array.isArray(g.paths) ? g.paths : [])
      .map((p) => normalize(String(p ?? "").replace(/\/(\*\*?)?$/, "")))
      .filter((p) => p && (all.has(p) || folders.has(p)));
    groups.push({
      id,
      name,
      description: text(g.description, 600),
      parent: typeof g.parent === "string" && g.parent ? slug(g.parent) : null,
      role: GROUP_ROLES.includes(g.role as GroupRole) ? (g.role as GroupRole) : null,
      paths: [...new Set(paths)].slice(0, 200),
      _raw: slug(g.id),
    } as SemanticGroup & { _raw: string });
  }
  // Parents are referenced by the id the agent gave; map them to the deduplicated ids.
  const byRaw = new Map<string, string>();
  for (const g of groups as Array<SemanticGroup & { _raw: string }>) if (!byRaw.has(g._raw)) byRaw.set(g._raw, g.id);
  for (const g of groups as Array<SemanticGroup & { _raw?: string }>) {
    g.parent = g.parent ? (byRaw.get(g.parent) ?? (groups.some((o) => o.id === g.parent) ? g.parent : null)) : null;
    if (g.parent === g.id) g.parent = null;
    delete g._raw;
  }
  const byId = new Map(groups.map((g) => [g.id, g]));
  for (const g of groups) {
    const seen = new Set([g.id]);
    let depth = 1;
    for (let p = g.parent; p; p = byId.get(p)?.parent ?? null) {
      if (seen.has(p) || ++depth > 4) {
        g.parent = null;
        break;
      }
      seen.add(p);
    }
  }
  const owners = assignFiles(files, groups);
  // Drop groups that own nothing, bottom-up, so empty parents disappear too.
  let changed = true;
  let kept = groups;
  while (changed) {
    changed = false;
    const counts = new Map<string, number>();
    owners.forEach((owner) => {
      for (let g: string | null = owner; g; g = byId.get(g)?.parent ?? null) counts.set(g, (counts.get(g) ?? 0) + 1);
    });
    const next = kept.filter((g) => counts.get(g.id));
    if (next.length !== kept.length) {
      changed = true;
      kept = next;
      byId.clear();
      kept.forEach((g) => byId.set(g.id, g));
      kept.forEach((g) => g.parent && !byId.has(g.parent) && (g.parent = null));
      owners.clear();
      assignFiles(files, kept).forEach((v, k) => owners.set(k, v));
    }
  }
  if (!kept.length) throw new Error("The agent did not describe any part of the project");
  if ([...owners.values()].includes(OTHER_GROUP))
    kept.push({ id: OTHER_GROUP, name: "", description: "", parent: null, role: null, paths: [] });
  const relations = (Array.isArray(input.relations) ? input.relations : [])
    .slice(0, 200)
    .map((r) => (r && typeof r === "object" ? r : {}) as Record<string, unknown>)
    .map((r) => ({
      from: byRaw.get(slug(r.from)) ?? slug(r.from),
      to: byRaw.get(slug(r.to)) ?? slug(r.to),
      reason: text(r.reason, 400),
    }))
    .filter((r) => r.reason && r.from !== r.to && byId.has(r.from) && byId.has(r.to));
  return { summary: text(input.summary, 2000), groups: kept, relations, builtAt: Date.now() };
}

/** File → group by the longest claimed path; a parent keeps files that no child claims more precisely. */
export function assignFiles(files: string[], groups: SemanticGroup[]): Map<string, string> {
  const claims: Array<[string, string]> = [];
  for (const g of groups) for (const p of g.paths) claims.push([p, g.id]);
  // A parent's own paths count too: its files go to a child only when the child claims them more precisely.
  claims.sort((a, b) => b[0].length - a[0].length);
  const owners = new Map<string, string>();
  for (const f of files) {
    const hit = claims.find(([p]) => f === p || f.startsWith(p + "/"));
    owners.set(f, hit ? hit[1] : OTHER_GROUP);
  }
  return owners;
}

/** Modules for mentions and forecasts: every group that directly owns files. */
export function semanticModules(files: string[], semantic: Semantic): Module[] {
  const owners = assignFiles(
    files,
    semantic.groups.filter((g) => g.id !== OTHER_GROUP),
  );
  const modules = new Map<string, Module>();
  for (const [file, owner] of owners) {
    const group = semantic.groups.find((g) => g.id === owner);
    let module = modules.get(owner);
    if (!module) {
      module = {
        id: owner,
        name: group?.name || (owner === OTHER_GROUP ? "Other" : owner),
        description: group?.description ?? "",
        files: [],
      };
      modules.set(owner, module);
    }
    module.files.push(file);
  }
  return [...modules.values()];
}
