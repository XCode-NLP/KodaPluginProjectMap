import { definePlugin, type Json, type PluginContext, type ToolCall } from "@kodadev/desktop-plugin-sdk";
// The application already pins this pure-JS parser bundle; no runtime or project code is executed.
import * as Babel from "@babel/standalone";
import {
  buildGraph,
  extractImports,
  fingerprint,
  hash,
  normalize,
  validateImpact,
  validateSemantic,
  semanticModules,
  GROUP_ROLES,
  OTHER_GROUP,
  type Semantic,
  type Graph,
  type Impact,
  type SourceFile,
  type Module,
  type Edge,
  type FileInfo,
} from "./graph";

type Saved = { graph: Graph; configs: Record<string, any> };
type Job = {
  id: string;
  projectPath: string;
  cancelled: boolean;
  status: string;
  done: number;
  total: number;
  error?: string;
  /** The agent could not describe the project; the map stays structural. */
  warning?: string;
  runId?: string;
  /** Force a new agent pass even when the stored groups still fit. */
  rethink?: boolean;
};
const parser = Babel.packages.parser;
const toJson = (value: unknown) => JSON.parse(JSON.stringify(value)) as Json;
const parseJs = (source: string, ts: boolean, jsx: boolean) =>
  parser.parse(source, {
    sourceType: "unambiguous",
    plugins: [...(ts ? (["typescript"] as const) : []), ...(jsx ? (["jsx"] as const) : [])],
    errorRecovery: false,
  });

/** Parse JSONC as data, without eval, including tsconfig comments/trailing commas. */
function configObject(text: string): any {
  const literal = (node: any): any => {
    if (!node) return null;
    if (["StringLiteral", "NumericLiteral", "BooleanLiteral"].includes(node.type)) return node.value;
    if (node.type === "NullLiteral") return null;
    if (node.type === "ArrayExpression") return node.elements.map(literal);
    if (node.type === "ObjectExpression")
      return Object.fromEntries(
        node.properties.map((p: any) => {
          if (p.type !== "ObjectProperty" || p.computed) throw new Error("Config must contain data only");
          return [p.key.name ?? p.key.value, literal(p.value)];
        }),
      );
    if (node.type === "UnaryExpression" && node.operator === "-" && node.argument.type === "NumericLiteral")
      return -node.argument.value;
    throw new Error("Config must contain data only");
  };
  return literal(parser.parseExpression(text));
}

/** Keep only the config fields the resolver reads: a full package.json can be large. */
function compactConfig(p: string, value: any): any {
  if (!value || typeof value !== "object") return value;
  if (p.endsWith("go.mod")) return { module: value.module };
  if (p.endsWith("package.json"))
    return { name: value.name, exports: value.exports, main: value.main, module: value.module, source: value.source };
  return {
    resolutionBase: value.resolutionBase,
    compilerOptions: { baseUrl: value.compilerOptions?.baseUrl, paths: value.compilerOptions?.paths },
  };
}
const MAX_MAPS = 3;
const MAX_IMPACTS = 30;
const CHUNK = 300_000;
type Head = { generation: string; count: number };
type MapIndex = Array<{ projectPath: string; usedAt: number }>;
type Impacts = Record<string, { impact: Json; at: number }>;
const quotaError = (error: unknown) => /storage is larger/i.test(String(error));

const BUSY = ["listing", "indexing", "understanding"];
const dirOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");

/** What the agent gets up front: the folder tree with counts and the strongest import links between folders. */
export function describeForAgent(graph: Graph, language: string): string {
  const files = graph.files.map((f) => f.path);
  const counts = new Map<string, number>();
  for (const f of files) for (let d = dirOf(f); d; d = dirOf(d)) counts.set(d, (counts.get(d) ?? 0) + 1);
  // Deepen the tree level by level while it fits in ~350 lines.
  let depth = 1;
  while (depth < 6 && [...counts.keys()].filter((d) => d.split("/").length <= depth + 1).length <= 350) depth++;
  const folders = [...counts.entries()]
    .filter(([d]) => d.split("/").length <= depth)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([d, n]) => `${"  ".repeat(d.split("/").length - 1)}${d.split("/").pop()}/  (${n})`);
  const rootFiles = files.filter((f) => !f.includes("/"));
  const key = (p: string) =>
    dirOf(p)
      .split("/")
      .slice(0, Math.max(1, depth - 1))
      .join("/") || ".";
  const links = new Map<string, number>();
  for (const f of graph.files)
    for (const d of f.deps ?? []) {
      const a = key(f.path),
        b = key(d);
      if (a !== b) links.set(`${a} -> ${b}`, (links.get(`${a} -> ${b}`) ?? 0) + 1);
    }
  const topLinks = [...links.entries()].sort((a, b) => b[1] - a[1]).slice(0, 80);
  const languages = new Map<string, number>();
  for (const f of files) {
    const ext = /\.([a-z0-9]+)$/i.exec(f)?.[1]?.toLowerCase() ?? "(none)";
    languages.set(ext, (languages.get(ext) ?? 0) + 1);
  }
  const lang = language === "ru" ? "Russian" : "English";
  return [
    "You are building a navigable architecture map of the project in the current working directory for a developer who sees it for the first time.",
    "Explore before you answer: read the README, package manifests and the main entry points, then open a few representative files of each large area. You can only read and search; never try to change anything. Stay within about 30 tool calls.",
    "",
    "Return a hierarchy of meaningful parts of the system, not a copy of the folder tree:",
    '- 3 to 8 top-level groups (parent "") that explain how the system is organised: for example the request pipeline, domain logic, provider integrations, infrastructure, UI, tests, tooling.',
    "- Split a large group into 2 to 8 child groups (parent = the group id), down to at most 3 levels. Small or simple areas stay a single group.",
    "- paths are project-relative folders or files that belong to the group. A file belongs to the group with the longest matching path, so a child can claim a subfolder of its parent. Cover every source folder; tests, docs and configuration get their own groups.",
    "- One area of code can be scattered across folders: group by responsibility, not by location, when that is clearer.",
    `- name: 1 to 4 words; description: 1 to 2 sentences on what the part is responsible for and how it is used. Write name, description, reason and summary in ${lang}.`,
    `- role: one of ${GROUP_ROLES.join(", ")}.`,
    "- relations: links between groups that imports do not show (HTTP calls, events, queues, configuration, code generation), each with a reason. Import links are already known; do not repeat them.",
    "- summary: 2 to 4 sentences about what the project does and how a request or command flows through it.",
    "",
    `Project: ${graph.projectPath.split(/[\\/]/).pop()} · ${files.length} indexed files`,
    `File types: ${[...languages.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([e, n]) => `${e} ${n}`)
      .join(", ")}`,
    "",
    "Folders (indexed files in each):",
    ...folders,
    "",
    `Files in the root: ${rootFiles.slice(0, 60).join(", ") || "none"}`,
    "",
    "Import links between folders (count):",
    ...(topLinks.length ? topLinks.map(([k, n]) => `${k}  ${n}`) : ["none detected"]),
  ].join("\n");
}

const SEMANTIC_SCHEMA = {
  type: "object",
  required: ["summary", "groups", "relations"],
  properties: {
    summary: { type: "string" },
    groups: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "name", "description", "parent", "role", "paths"],
        properties: {
          id: { type: "string", description: "kebab-case, unique" },
          name: { type: "string" },
          description: { type: "string" },
          parent: { type: "string", description: "id of the parent group, empty for a top-level group" },
          role: { type: "string", enum: [...GROUP_ROLES] },
          paths: { type: "array", items: { type: "string" } },
        },
      },
    },
    relations: {
      type: "array",
      items: {
        type: "object",
        required: ["from", "to", "reason"],
        properties: { from: { type: "string" }, to: { type: "string" }, reason: { type: "string" } },
      },
    },
  },
} as const;

/**
 * What the chat agent reads for `@module:<id>`: plain text about that part of the code, so it answers
 * about the code itself instead of explaining the reference or the plugin.
 */
export function describeModules(
  graph: Graph,
  ids: string[],
  state: { stale: boolean; toolsAvailable: boolean },
): string {
  const groups = new Map((graph.semantic?.groups ?? []).map((g) => [g.id, g]));
  const owner = new Map(graph.modules.flatMap((m) => m.files.map((f) => [f, m.id] as const)));
  const name = (id: string) => graph.modules.find((m) => m.id === id)?.name || groups.get(id)?.name || id;
  const parts = ids.map((id) => {
    const module = graph.modules.find((m) => m.id === id)!;
    const group = groups.get(id);
    const chain: string[] = [];
    for (let p = group?.parent ?? null; p; p = groups.get(p)?.parent ?? null) chain.unshift(groups.get(p)?.name ?? p);
    const inside = new Set(module.files);
    const uses = new Map<string, number>(),
      usedBy = new Map<string, number>();
    for (const f of graph.files)
      for (const d of f.deps ?? []) {
        if (inside.has(f.path) && !inside.has(d)) uses.set(owner.get(d) ?? d, (uses.get(owner.get(d) ?? d) ?? 0) + 1);
        if (!inside.has(f.path) && inside.has(d))
          usedBy.set(owner.get(f.path) ?? f.path, (usedBy.get(owner.get(f.path) ?? f.path) ?? 0) + 1);
      }
    const list = (counts: Map<string, number>) =>
      [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .map(([k, n]) => `${name(k)} (${n})`)
        .join(", ") || "none found";
    const meaning = (graph.semantic?.relations ?? [])
      .filter((r) => r.from === id || r.to === id)
      .map((r) => `- ${r.from === id ? "→" : "←"} ${name(r.from === id ? r.to : r.from)}: ${r.reason}`);
    return [
      `## @module:${id} = "${module.name}"${chain.length ? ` (part of ${chain.join(" › ")})` : ""}`,
      module.description || group?.description || "",
      group?.role ? `Role: ${group.role}.` : "",
      `Files (${module.files.length}${module.files.length > 60 ? ", first 60" : ""}):`,
      ...module.files.slice(0, 60).map((f) => `- ${f}`),
      `Imports code from: ${list(uses)}.`,
      `Imported by: ${list(usedBy)}.`,
      ...(meaning.length ? ["Other relationships:", ...meaning] : []),
    ]
      .filter(Boolean)
      .join("\n");
  });
  return [
    "The user's message names parts of this project with @module:<id> references. Each reference means the code area described below, exactly as if the user had listed these files. Answer the user's question about this code directly. Do not explain what the reference is or how the map works.",
    graph.semantic?.summary ? `Project overview: ${graph.semantic.summary}` : "",
    ...parts,
    "Read the files before making claims about behaviour. A reference is not a request to edit." +
      (state.stale ? " The map is older than the code: some files may have moved." : "") +
      (state.toolsAvailable ? " get_module lists the remaining files of a large part." : ""),
  ]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 19_000);
}

let stop = async () => {};
export default definePlugin({
  deactivate: () => stop(),
  activate(ctx: PluginContext) {
    const cache = new Map<string, Saved>();
    const jobs = new Map<string, Job>();
    const tasks = new Set<Promise<void>>();
    const mutations = new Map<string, Promise<unknown>>();
    let active = true;
    stop = async () => {
      active = false;
      for (const job of jobs.values()) job.cancelled = true;
      await Promise.allSettled([...tasks, ...mutations.values()]);
    };
    const exclusive = <T>(projectPath: string, fn: () => Promise<T>): Promise<T> => {
      const next = (mutations.get(projectPath) ?? Promise.resolve())
        .catch(() => {})
        .then(() => {
          if (!active) throw new Error("Plugin stopped");
          return fn();
        });
      mutations.set(projectPath, next);
      return next;
    };
    let sequence = 0;
    const key = (project: string) => `map-${hash(project)}`;
    const emit = (event: string, value: unknown) => ctx.ui.post(event, toJson(value));
    const headKey = (projectPath: string) => `${key(projectPath)}-head`;
    const impactsKey = (projectPath: string) => `impacts-${hash(projectPath)}`;
    const deleteChunks = async (head: Head | null) => {
      if (head) for (let i = 0; i < head.count; i++) await ctx.storage.delete(`${head.generation}-${i}`);
    };
    /** Remove a project's map and its forecasts entirely. */
    const dropMap = async (projectPath: string) => {
      await deleteChunks(await ctx.storage.get<Head>(headKey(projectPath)));
      await ctx.storage.delete(headKey(projectPath));
      await ctx.storage.delete(impactsKey(projectPath));
      cache.delete(projectPath);
      const list = (await ctx.storage.get<MapIndex>("maps-index")) ?? [];
      await ctx.storage.set("maps-index", toJson(list.filter((entry) => entry.projectPath !== projectPath)));
    };
    /** Storage is one 10 MB budget for the plugin: keep the most recently built maps only. */
    const evictOthers = async (projectPath: string, keep: number) => {
      const list = ((await ctx.storage.get<MapIndex>("maps-index")) ?? []).filter((e) => e.projectPath !== projectPath);
      list.sort((a, b) => b.usedAt - a.usedAt);
      for (const entry of list.slice(keep)) await dropMap(entry.projectPath);
    };
    const save = async (value: Saved, cancelled = () => false) => {
      const projectPath = value.graph.projectPath,
        text = JSON.stringify(value);
      // Alternating generations make a cancelled write leave the previous complete map readable.
      const generation = `${key(projectPath)}-${hash(text)}-${Date.now()}`;
      const head: Head = { generation, count: Math.ceil(text.length / CHUNK) };
      let previous = await ctx.storage.get<Head>(headKey(projectPath));
      const write = async () => {
        for (let i = 0; i < head.count; i++)
          await ctx.storage.set(`${generation}-${i}`, text.slice(i * CHUNK, (i + 1) * CHUNK));
      };
      try {
        await write();
      } catch (error) {
        await deleteChunks(head);
        if (!quotaError(error)) throw error;
        // Out of space: drop other projects' maps first, then this project's previous generation.
        await evictOthers(projectPath, 0);
        try {
          await write();
        } catch (retry) {
          await deleteChunks(head);
          if (!quotaError(retry) || !previous) throw retry;
          await deleteChunks(previous);
          await ctx.storage.delete(headKey(projectPath));
          cache.delete(projectPath);
          previous = null;
          await write();
        }
      }
      if (!active || cancelled()) {
        await deleteChunks(head);
        throw new Error("Cancelled");
      }
      await ctx.storage.set(headKey(projectPath), head);
      if (previous && previous.generation !== generation) await deleteChunks(previous);
      const list = ((await ctx.storage.get<MapIndex>("maps-index")) ?? []).filter((e) => e.projectPath !== projectPath);
      await ctx.storage.set("maps-index", toJson([...list, { projectPath, usedAt: Date.now() }]));
      await evictOthers(projectPath, MAX_MAPS - 1);
      cache.set(projectPath, value);
    };
    // Read the last atomically published generation, rather than partial index output.
    const stored = async (projectPath: string): Promise<Saved | null> => {
      if (cache.has(projectPath)) return cache.get(projectPath)!;
      const head = await ctx.storage.get<Head>(headKey(projectPath));
      if (!head) return null;
      let text = "";
      for (let i = 0; i < head.count; i++) text += (await ctx.storage.get<string>(`${head.generation}-${i}`)) ?? "";
      const value = JSON.parse(text) as Saved;
      if (value.graph.projectPath !== projectPath) throw new Error("Stored project identity mismatch");
      if (cache.size > 2) cache.delete(cache.keys().next().value!);
      cache.set(projectPath, value);
      return value;
    };
    const session = async (sessionId: string | null) => {
      if (!sessionId) throw new Error("Open a project chat first");
      return ctx.chat.getSession(sessionId);
    };
    const list = async (projectPath: string, job?: Job): Promise<{ files: FileInfo[]; truncated: boolean }> => {
      const files: FileInfo[] = [];
      let cursor: string | undefined,
        truncated = false;
      do {
        if (job?.cancelled) throw new Error("Cancelled");
        const page = await ctx.projects.listFiles(projectPath, cursor);
        files.push(...page.files);
        truncated ||= page.truncated;
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      return { files: files.sort((a, b) => a.path.localeCompare(b.path)), truncated };
    };
    // Concurrent checks of one project (state, mention, tool) share one listing.
    const listings = new Map<string, Promise<string>>();
    const currentFingerprint = (projectPath: string) => {
      let pending = listings.get(projectPath);
      if (!pending) {
        pending = list(projectPath).then((listing) => fingerprint(listing.files.slice(0, 4000)));
        listings.set(projectPath, pending);
        void pending.finally(() => listings.delete(projectPath)).catch(() => {});
      }
      return pending;
    };
    const fresh = async (graph: Graph) => (await currentFingerprint(graph.projectPath)) === graph.fingerprint;
    const readImpact = async (projectPath: string, sessionId: string) =>
      (await ctx.storage.get<Impacts>(impactsKey(projectPath)))?.[sessionId]?.impact ?? null;
    /** One record per project: deleted chats are pruned and the oldest forecasts dropped. */
    const writeImpact = async (projectPath: string, sessionId: string, impact: Json) => {
      const all: Impacts = { ...((await ctx.storage.get<Impacts>(impactsKey(projectPath))) ?? {}) };
      all[sessionId] = { impact, at: Date.now() };
      for (const id of Object.keys(all))
        if (id !== sessionId) await ctx.chat.getSession(id).catch(() => delete all[id]);
      const kept = Object.entries(all)
        .sort((a, b) => b[1].at - a[1].at)
        .slice(0, MAX_IMPACTS);
      await ctx.storage.set(impactsKey(projectPath), toJson(Object.fromEntries(kept)));
    };
    /** Leaf groups become the modules that mentions and forecasts use; import edges are recomputed for them. */
    const withSemantic = (base: Graph, configs: Record<string, any>, semantic: Semantic): Graph => {
      const paths = base.files.map((f) => f.path);
      const modules = semanticModules(paths, semantic);
      const graph = buildGraph(base.projectPath, base.files, configs, [...base.limitations], {
        ...base,
        modules,
        edges: [],
      });
      const moduleOf = (group: string) => {
        const g = semantic.groups.find((x) => x.id === group);
        return g ? modules.find((m) => m.id === g.id)?.id : undefined;
      };
      for (const r of semantic.relations) {
        const from = moduleOf(r.from),
          to = moduleOf(r.to);
        if (from && to && from !== to) graph.edges.push({ from, to, source: "model", evidence: [], reason: r.reason });
      }
      graph.semantic = semantic;
      graph.version = hash(graph.version + JSON.stringify(semantic));
      return graph;
    };
    /** The agent pass: a read-only one-shot agent explores the code and names its parts. */
    const understand = async (job: Job, graph: Graph): Promise<Semantic> => {
      job.status = "understanding";
      job.runId = `map-${hash(job.id + Date.now())}`;
      await emit("progress", job);
      const answer = await ctx.agent.run({
        runId: job.runId,
        projectPath: job.projectPath,
        prompt: describeForAgent(graph, ctx.env.language),
        outputSchema: SEMANTIC_SCHEMA as unknown as Record<string, Json>,
        maxToolCalls: 45,
        timeoutMs: 15 * 60_000,
      });
      if (job.cancelled) throw new Error("Cancelled");
      return validateSemantic(
        answer.value,
        graph.files.map((f) => f.path),
      );
    };
    const index = async (job: Job) => {
      try {
        const previous = await stored(job.projectPath);
        const listing = await list(job.projectPath, job);
        const infos = listing.files.slice(0, 4000),
          files: SourceFile[] = [],
          configs: Record<string, any> = {};
        const limitations: string[] = [];
        if (listing.truncated || listing.files.length > infos.length)
          limitations.push("File listing is incomplete (maximum 4000 files; files over 512 KiB are excluded).");
        job.total = infos.length;
        job.status = "indexing";
        const old = new Map(previous?.graph.files.map((f) => [f.path, f]) ?? []);
        for (const info of infos) {
          if (job.cancelled) throw new Error("Cancelled");
          const isConfig = /(?:^|\/)(?:package\.json|[tj]sconfig[^/]*\.json|go\.mod)$/.test(info.path);
          const prior = old.get(info.path);
          const lang = /\.[cm]?[jt]sx?$/.test(info.path)
            ? "js"
            : info.path.endsWith(".py")
              ? "python"
              : info.path.endsWith(".go")
                ? "go"
                : "other";
          if (prior && prior.size === info.size && prior.modifiedAt === info.modifiedAt && !isConfig) files.push(prior);
          else if (lang !== "other" || isConfig) {
            try {
              const text = await ctx.projects.readFile(job.projectPath, info.path);
              if (isConfig)
                configs[info.path] = info.path.endsWith("go.mod")
                  ? { module: /^\s*module\s+(\S+)/m.exec(text)?.[1] }
                  : configObject(text);
              let imports: SourceFile["imports"] = [];
              if (lang !== "other")
                try {
                  imports = extractImports(info.path, text, parseJs);
                } catch {
                  limitations.push(`Could not parse imports: ${info.path}`);
                }
              files.push({ ...info, hash: hash(text), imports, language: lang });
            } catch {
              limitations.push(`Could not read: ${info.path}`);
              files.push({ ...info, hash: "unreadable", imports: [], language: lang });
            }
          } else files.push({ ...info, hash: hash(`${info.size}:${info.modifiedAt}`), imports: [], language: lang });
          job.done++;
          if (job.done % 25 === 0) {
            await emit("progress", job);
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
        }
        // Merge local tsconfig extends; no runtime modules or remote configs are loaded.
        const mergeConfig = (p: string, seen = new Set<string>()): any => {
          const own = configs[p];
          if (!own) return own;
          if (seen.has(p)) {
            limitations.push(`Cyclic tsconfig extends: ${p}`);
            return own;
          }
          seen.add(p);
          const ownDir = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
          const resolutionBase = normalize(`${ownDir}/${own.compilerOptions?.baseUrl ?? "."}`);
          if (typeof own.extends !== "string") return { ...own, resolutionBase };
          if (!own.extends.startsWith(".")) {
            limitations.push(`External tsconfig extends not resolved: ${p}`);
            return own;
          }
          const baseDir = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
          const parts = `${baseDir}/${own.extends}`.split("/"),
            normalized: string[] = [];
          for (const part of parts) {
            if (part === "..") normalized.pop();
            else if (part && part !== ".") normalized.push(part);
          }
          let target = normalized.join("/");
          if (!target.endsWith(".json")) target += ".json";
          const parent = mergeConfig(target, seen);
          if (!parent) {
            limitations.push(`Missing tsconfig extends: ${target}`);
            return own;
          }
          return {
            ...parent,
            ...own,
            compilerOptions: { ...parent.compilerOptions, ...own.compilerOptions },
            resolutionBase:
              own.compilerOptions?.baseUrl !== undefined ||
              (!parent.compilerOptions?.baseUrl && own.compilerOptions?.paths)
                ? resolutionBase
                : parent.resolutionBase,
          };
        };
        const merged = Object.fromEntries(
          Object.keys(configs).map((p) => [p, /[tj]sconfig[^/]*\.json$/.test(p) ? mergeConfig(p) : configs[p]]),
        );
        for (const p of Object.keys(configs)) configs[p] = compactConfig(p, merged[p]);
        const graph = buildGraph(job.projectPath, files, configs, limitations, previous?.graph);
        if (job.cancelled) throw new Error("Cancelled");
        if (!(await fresh(graph))) throw new Error("Project changed during indexing; refresh again");
        if (job.cancelled) throw new Error("Cancelled");
        // Reuse the agent's groups while they still cover the project; otherwise ask again.
        let semantic: Semantic | null = null;
        if (previous?.graph.semantic && !job.rethink)
          try {
            semantic = validateSemantic(
              previous.graph.semantic,
              files.map((f) => f.path),
            );
            const other = semanticModules(
              files.map((f) => f.path),
              semantic,
            ).find((m) => m.id === OTHER_GROUP);
            if (other && other.files.length >= 10 && other.files.length > files.length * 0.15) semantic = null;
          } catch {
            semantic = null;
          }
        await save({ graph: semantic ? withSemantic(graph, configs, semantic) : graph, configs }, () => job.cancelled);
        await emit("map", { projectPath: job.projectPath, version: graph.version });
        if (!semantic) {
          try {
            semantic = await understand(job, graph);
            if (job.cancelled) throw new Error("Cancelled");
            if (!(await fresh(graph))) throw new Error("Project changed while the agent was reading it; refresh again");
            const next = withSemantic(graph, configs, semantic);
            await save({ graph: next, configs }, () => job.cancelled);
            await emit("map", { projectPath: job.projectPath, version: next.version });
          } catch (error) {
            if (job.cancelled) throw error;
            job.warning = String(error instanceof Error ? error.message : error);
          }
        }
        job.status = "complete";
      } catch (error) {
        job.status = job.cancelled ? "cancelled" : "error";
        job.error = String(error);
      }
      await emit("progress", job);
    };
    const required = async (projectPath: string) => {
      const value = await stored(projectPath);
      if (!value) throw new Error("Open Project map and build its index first");
      return value;
    };
    const toolProject = async (call: ToolCall) => {
      if (!active) throw new Error("Plugin stopped");
      return (await session(call.sessionId)).projectPath;
    };
    const ensureFresh = async (graph: Graph) => {
      if (!(await fresh(graph))) throw new Error("Map is stale; refresh Project map first");
    };
    const result = (value: unknown) => ({ content: JSON.stringify(value), structured: toJson(value) });

    // The chat pane hands its project and level to the full-screen workspace it opens.
    let focus: Json = null;
    ctx.ui.handle("setFocus", async (raw) => {
      focus = toJson(raw);
      await emit("focus", null);
    });
    ctx.ui.handle("takeFocus", async () => {
      const value = focus;
      focus = null;
      return value;
    });
    ctx.ui.handle("projects", async () => toJson(await ctx.projects.list()));
    ctx.ui.handle("session", async (raw) => toJson(await session((raw as any).sessionId)));
    ctx.ui.handle("state", async (raw) => {
      const { projectPath, sessionId } = raw as any;
      if (sessionId && (await session(sessionId)).projectPath !== projectPath)
        throw new Error("Session project mismatch");
      const value = await stored(projectPath);
      const impact = sessionId ? await readImpact(projectPath, sessionId) : null;
      const job = [...jobs.values()].find((j) => j.projectPath === projectPath && BUSY.includes(j.status));
      return toJson({
        graph: value?.graph ?? null,
        impact,
        job: job ?? null,
        stale: value ? !(await fresh(value.graph)) : false,
      });
    });
    ctx.ui.handle("startIndex", async (raw) => {
      const { projectPath, rethink } = raw as any;
      if (!(await ctx.projects.list()).some((p) => p.path === projectPath)) throw new Error("Unknown project");
      const existingJob = [...jobs.values()].find((j) => j.projectPath === projectPath && BUSY.includes(j.status));
      if (existingJob) return toJson(existingJob);
      for (const [id, job] of jobs) if (!BUSY.includes(job.status)) jobs.delete(id);
      const job: Job = {
        id: `job-${++sequence}`,
        projectPath,
        cancelled: false,
        status: "listing",
        done: 0,
        total: 0,
        rethink: rethink === true,
      };
      jobs.set(job.id, job);
      setTimeout(() => {
        if (!active) return;
        const task = exclusive(projectPath, () => index(job));
        tasks.add(task);
        void task.finally(() => tasks.delete(task)).catch(() => {});
      }, 0);
      return toJson(job);
    });
    ctx.ui.handle("cancelIndex", (raw) => {
      const job = jobs.get((raw as any).id);
      if (!job) return;
      job.cancelled = true;
      if (job.runId) void ctx.agent.cancel(job.runId).catch(() => {});
    });
    ctx.ui.handle("insert", async (raw) => {
      const { sessionId, moduleIds } = raw as any;
      const current = await session(sessionId),
        { graph } = await required(current.projectPath);
      if (
        !Array.isArray(moduleIds) ||
        !moduleIds.length ||
        moduleIds.length > 20 ||
        moduleIds.some((id) => !graph.modules.some((m) => m.id === id))
      )
        throw new Error("Unknown module selection");
      await ctx.chat.insertIntoComposer(moduleIds.map((id) => `@module:${id}`).join(" "), sessionId);
    });
    ctx.ui.handle("readSource", async (raw) => {
      const { projectPath, path } = raw as any,
        { graph } = await required(projectPath);
      if (!graph.files.some((f) => f.path === path)) throw new Error("Unknown source path");
      return (await ctx.projects.readFile(projectPath, path)).slice(0, 100_000);
    });
    ctx.mentions.register({
      search: async ({ projectPath, query }) => {
        const value = await stored(projectPath);
        return (
          value?.graph.modules
            .filter((m) => `${m.name} ${m.id} ${m.description}`.toLowerCase().includes(query.toLowerCase()))
            .slice(0, 20)
            .map((m) => ({ id: m.id, name: m.name, description: m.description || m.files.slice(0, 2).join(", ") })) ??
          []
        );
      },
      resolve: async ({ projectPath, ids, sessionId }) => {
        const { graph } = await required(projectPath),
          current = await session(sessionId);
        if (ids.some((id) => !graph.modules.some((m) => m.id === id)))
          throw new Error("Module no longer exists; select it again in Project map");
        const stale = !(await fresh(graph));
        return describeModules(graph, ids, { stale, toolsAvailable: current.toolsAvailable });
      },
    });
    ctx.tools.register("get_project_map", async (_raw, call) => {
      const { graph } = await required(await toolProject(call));
      return result({
        version: graph.version,
        stale: !(await fresh(graph)),
        summary: graph.semantic?.summary ?? "",
        // The hierarchy the map shows; modules below are its file-owning groups, with the same ids.
        groups: graph.semantic?.groups.map(({ paths, ...g }) => ({ ...g, paths: paths.slice(0, 20) })) ?? [],
        modules: graph.modules.map(({ files, ...m }) => ({ ...m, fileCount: files.length })),
        edges: graph.edges,
        limitations: graph.limitations,
      });
    });
    ctx.tools.register("get_module", async (raw, call) => {
      const { graph } = await required(await toolProject(call));
      const { moduleId, offset = 0 } = raw as any;
      if (!Number.isInteger(offset) || offset < 0) throw new Error("Invalid offset");
      const module = graph.modules.find((m) => m.id === moduleId);
      if (!module) throw new Error("Unknown module");
      return result({
        version: graph.version,
        ...module,
        files: module.files.slice(offset, offset + 100),
        nextOffset: offset + 100 < module.files.length ? offset + 100 : null,
        edges: graph.edges.filter((e) => e.from === moduleId || e.to === moduleId),
      });
    });
    ctx.tools.register("update_module_groups", async (raw, call) => {
      const projectPath = await toolProject(call);
      return exclusive(projectPath, async () => {
        const saved = await required(projectPath);
        await ensureFresh(saved.graph);
        if ([...jobs.values()].some((j) => j.projectPath === projectPath && BUSY.includes(j.status)))
          throw new Error("Indexing is running");
        const { version, modules, edges = [] } = raw as any as { version: string; modules: Module[]; edges: Edge[] };
        if (version !== saved.graph.version || !Array.isArray(modules) || !modules.length || modules.length > 200)
          throw new Error("Invalid modules or stale version");
        const files = new Set(saved.graph.files.map((f) => f.path)),
          assigned = new Set<string>(),
          ids = new Set<string>();
        for (const m of modules) {
          if (
            !/^[a-zA-Z0-9._/-]{1,100}$/.test(m.id) ||
            ids.has(m.id) ||
            typeof m.name !== "string" ||
            !m.name.trim() ||
            m.name.length > 200 ||
            typeof m.description !== "string" ||
            m.description.length > 2000 ||
            !Array.isArray(m.files) ||
            !m.files.length
          )
            throw new Error("Invalid module");
          ids.add(m.id);
          for (const f of m.files) {
            if (!files.has(f) || assigned.has(f)) throw new Error("Unknown or duplicate file");
            assigned.add(f);
          }
        }
        if (assigned.size !== files.size) throw new Error("Every indexed file must belong to exactly one module");
        if (
          !Array.isArray(edges) ||
          edges.length > 500 ||
          edges.some(
            (e) =>
              !ids.has(e.from) ||
              !ids.has(e.to) ||
              typeof e.reason !== "string" ||
              !e.reason.trim() ||
              e.reason.length > 2000,
          )
        )
          throw new Error("Model relationships need existing modules and an explanation");
        // The agent's own grouping replaces the map's groups: one top-level group per module.
        const semantic = validateSemantic(
          {
            summary: saved.graph.semantic?.summary ?? "",
            groups: modules.map((m) => ({ ...m, parent: "", role: null, paths: m.files })),
            relations: edges.map((e) => ({ from: e.from, to: e.to, reason: e.reason })),
          },
          saved.graph.files.map((f) => f.path),
        );
        const graph = withSemantic(saved.graph, saved.configs, semantic);
        await ensureFresh(graph);
        await save({ graph, configs: saved.configs });
        await emit("map", { projectPath, version: graph.version });
        return result({ version: graph.version });
      });
    });
    ctx.tools.register("set_change_impact", async (raw, call) => {
      const projectPath = await toolProject(call);
      return exclusive(projectPath, async () => {
        const { graph } = await required(projectPath);
        await ensureFresh(graph);
        const impact = validateImpact(graph, raw as unknown as Impact);
        if (!active) throw new Error("Plugin stopped");
        await writeImpact(projectPath, call.sessionId!, toJson(impact));
        await emit("impact", { projectPath, sessionId: call.sessionId });
        return result({ published: true, version: graph.version });
      });
    });
  },
});
