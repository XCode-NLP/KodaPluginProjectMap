import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import variant from "@jitl/quickjs-wasmfile-release-sync";
import { newQuickJSWASMModuleFromVariant } from "quickjs-emscripten-core";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@desktop/src/main/logging/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
import { PluginHostApi } from "@desktop/src/main/plugins/external/hostApi";
import { PluginSandbox, type SandboxJson } from "@desktop/src/main/plugins/external/sandbox";
import type { PluginManifest } from "@desktop/src/shared/plugins";
import type { Graph, Impact } from "../src/graph";

let source = "",
  root = "",
  project = "";
const quickjs = newQuickJSWASMModuleFromVariant(variant);
const sandboxes: PluginSandbox[] = [];
let manifest: PluginManifest;
let extraProjects: string[] = [];
let deletedSessions = new Set<string>();
/** What the stub agent answers; null leaves the host without agent runs. */
let agentAnswer: ((prompt: string) => SandboxJson) | null = null;
const agentPrompts: string[] = [];

beforeAll(async () => {
  manifest = JSON.parse(await fs.readFile("koda-plugin.json", "utf8"));
  source = await fs.readFile(manifest.main!, "utf8");
});

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "koda-map-"));
  project = path.join(root, "project");
  await fs.mkdir(path.join(project, "src/api"), { recursive: true });
  await fs.mkdir(path.join(project, "src/core"), { recursive: true });
  await fs.writeFile(
    path.join(project, "src/api/index.ts"),
    'import { token } from "../core/token.js"; export { token };',
  );
  await fs.writeFile(path.join(project, "src/core/token.ts"), 'export const token = "example";');
});
afterEach(async () => {
  extraProjects = [];
  deletedSessions = new Set();
  agentAnswer = null;
  agentPrompts.length = 0;
  sandboxes.splice(0).forEach((sandbox) => sandbox.dispose());
  await fs.rm(root, { recursive: true, force: true });
});

async function plugin() {
  const events: Array<[string, SandboxJson]> = [];
  const insert = vi.fn();
  const host = new PluginHostApi({
    manifest,
    dataDirectory: path.join(root, "data"),
    cipher: { available: () => false, encrypt: (s) => s, decrypt: (s) => s },
    projects: () => [project, ...extraProjects].map((p) => ({ path: p, name: path.basename(p) })),
    session: (id) => {
      if (deletedSessions.has(id)) return null;
      if (id === "chat-a" || id === "chat-b" || id === "chat-c") return { projectPath: project, toolsAvailable: true };
      const extra = extraProjects.find((p) => id === `chat-${path.basename(p)}`);
      return extra ? { projectPath: extra, toolsAvailable: true } : null;
    },
    postToUi: (event, data) => events.push([event, data]),
    insertIntoComposer: insert,
    setChatContext: vi.fn(),
    notify: vi.fn(),
    getSettings: () => ({}),
    ...(agentAnswer
      ? {
          runAgent: async (request: { prompt: string }, _signal: AbortSignal, onProgress: (text: string) => void) => {
            agentPrompts.push(request.prompt);
            onProgress("Read README.md");
            return { text: "", value: agentAnswer!(request.prompt), toolCalls: 1 };
          },
        }
      : {}),
  });
  const sandbox = PluginSandbox.create(
    await quickjs,
    source,
    { pluginId: manifest.id, version: "0.1.0", appVersion: "0.0.0-dev", language: "en", theme: "dark" },
    { call: (method, params) => host.call(method, params), log: () => {} },
  );
  sandboxes.push(sandbox);
  await sandbox.activate();
  const ui = (method: string, params: SandboxJson = null) => sandbox.invoke("ui", method, params);
  const tool = async (method: string, params: SandboxJson = {}, sessionId = "chat-a") => {
    const response = (await sandbox.invoke("tool", method, params, { sessionId })) as { structured: SandboxJson };
    return response.structured;
  };
  const index = async (projectPath = project) => {
    const job = (await ui("startIndex", { projectPath })) as { id: string };
    await vi.waitFor(
      () => {
        const terminal = events.find(
          ([event, data]) =>
            event === "progress" &&
            (data as any).id === job.id &&
            ["complete", "error", "cancelled"].includes((data as any).status),
        );
        expect(terminal, JSON.stringify(events)).toBeDefined();
        expect((terminal![1] as any).status, JSON.stringify(terminal)).toBe("complete");
      },
      { timeout: 15_000, interval: 20 },
    );
  };
  return { ui, tool, index, events, insert, host };
}

describe("Project map package in the actual QuickJS sandbox", () => {
  it("asks a read-only agent for meaningful groups and keeps them as modules", async () => {
    agentAnswer = () => ({
      summary: "A token service.",
      groups: [
        {
          id: "surface",
          name: "Public API",
          description: "Entry points.",
          parent: "",
          role: "api",
          paths: ["src/api"],
        },
        {
          id: "core",
          name: "Token core",
          description: "Token rules.",
          parent: "",
          role: "domain",
          paths: ["src/core", "missing/dir"],
        },
      ],
      relations: [{ from: "surface", to: "core", reason: "Configured at startup" }],
    });
    const p = await plugin();
    await p.index();
    expect(agentPrompts[0]).toContain("src/  (2)");
    expect(agentPrompts[0]).toContain("src/api -> src/core");
    expect(p.events.some(([event, data]) => event === "progress" && (data as any).status === "understanding")).toBe(
      true,
    );
    expect(
      p.events.some(([event, data]) => event === "agent.progress" && (data as any).text === "Read README.md"),
    ).toBe(true);
    const state = (await p.ui("state", { projectPath: project, sessionId: "chat-a" })) as any;
    expect(state.graph.semantic.summary).toBe("A token service.");
    expect(state.graph.semantic.groups.map((g: any) => g.paths)).toEqual([["src/api"], ["src/core"]]);
    expect(state.graph.modules.map((m: any) => [m.id, m.name])).toEqual([
      ["surface", "Public API"],
      ["core", "Token core"],
    ]);
    expect(state.graph.edges.map((e: any) => [e.from, e.to, e.source])).toEqual([
      ["surface", "core", "code"],
      ["surface", "core", "model"],
    ]);
    // A mention reads as plain text about the code, not as a JSON record about the plugin.
    const context = (await p.ui("__mentions.resolve", {
      projectPath: project,
      ids: ["core"],
      sessionId: "chat-a",
    })) as string;
    expect(context).toContain('@module:core = "Token core"');
    expect(context).toContain("Token rules.");
    expect(context).toContain("- src/core/token.ts");
    expect(context).toContain("Imported by: Public API (1).");
    expect(context).toContain("- ← Public API: Configured at startup");
    expect(context).toContain("Project overview: A token service.");
    expect(context).toContain("Do not explain what the reference is");
    // A refresh reuses groups that still cover the project instead of asking again.
    await p.index();
    expect(agentPrompts).toHaveLength(1);
    expect(((await p.tool("get_project_map")) as any).groups.map((g: any) => g.name)).toEqual([
      "Public API",
      "Token core",
    ]);
  }, 30_000);

  it("keeps the structural map and reports why when the agent cannot run", async () => {
    const p = await plugin();
    await p.index();
    const done = p.events.filter(([event]) => event === "progress").at(-1)![1] as any;
    expect(done.warning).toContain("agent runs are unavailable");
    const state = (await p.ui("state", { projectPath: project, sessionId: null })) as any;
    expect(state.graph.semantic).toBeUndefined();
    expect(state.graph.modules.map((m: any) => m.name)).toEqual(["src/api", "src/core"]);
  }, 30_000);

  it("keeps the three most recent project maps and prunes forecasts of deleted chats", async () => {
    const p = await plugin();
    await p.index();
    const state = (await p.ui("state", { projectPath: project, sessionId: "chat-a" })) as any;
    const impact = (sessionId: string) =>
      p.tool(
        "set_change_impact",
        {
          version: state.graph.version,
          task: "Change tokens",
          items: [
            {
              moduleId: state.graph.modules[0].id,
              category: "check",
              reason: "Review",
              evidence: [{ path: state.graph.modules[0].files[0], line: 1, spec: "x" }],
            },
          ],
        },
        sessionId,
      );
    await impact("chat-a");
    await impact("chat-b");
    deletedSessions.add("chat-a");
    await impact("chat-c");
    expect(((await p.ui("state", { projectPath: project, sessionId: "chat-b" })) as any).impact).not.toBeNull();
    deletedSessions.delete("chat-a");
    expect(((await p.ui("state", { projectPath: project, sessionId: "chat-a" })) as any).impact).toBeNull();

    for (const name of ["two", "three", "four"]) {
      const extra = path.join(root, name);
      await fs.mkdir(extra, { recursive: true });
      await fs.writeFile(path.join(extra, "main.py"), "import os\n");
      extraProjects.push(extra);
      await p.index(extra);
    }
    const fresh = await plugin();
    expect(((await fresh.ui("state", { projectPath: project, sessionId: null })) as any).graph).toBeNull();
    for (const extra of extraProjects)
      expect(((await fresh.ui("state", { projectPath: extra, sessionId: null })) as any).graph).not.toBeNull();
  }, 30_000);

  it("saves semantic groups and model relationships while retaining code evidence on refresh", async () => {
    const p = await plugin();
    await p.index();
    const { graph } = (await p.ui("state", { projectPath: project, sessionId: "chat-a" })) as unknown as {
      graph: Graph;
    };
    const modules = graph.modules.map((m) => ({ ...m, description: `Purpose of ${m.name}` }));
    const relationship = { from: modules[0].id, to: modules[1].id, reason: "Domain boundary to review" };
    const updated = (await p.tool("update_module_groups", {
      version: graph.version,
      modules,
      edges: [relationship],
    } as unknown as SandboxJson)) as any;
    expect(updated.version).not.toBe(graph.version);
    const next = (await p.tool("get_project_map")) as any;
    expect(next.modules.every((m: any) => m.description.startsWith("Purpose"))).toBe(true);
    expect(next.edges.some((e: any) => e.source === "code")).toBe(true);
    expect(next.edges.some((e: any) => e.source === "model" && e.reason === relationship.reason)).toBe(true);
    await p.index();
    const refreshed = (await p.tool("get_project_map")) as any;
    expect(refreshed.modules.map((m: any) => m.id)).toEqual(modules.map((m) => m.id));
    expect(refreshed.edges.some((e: any) => e.source === "model")).toBe(true);
  }, 25_000);
  it("indexes TS dependencies, resolves mentions, isolates forecasts and restores a saved map", async () => {
    const p = await plugin();
    await p.index();
    const state = (await p.ui("state", { projectPath: project, sessionId: "chat-a" })) as unknown as { graph: Graph };
    const graph = state.graph;
    expect(graph.modules).toHaveLength(2);
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]).toMatchObject({
      source: "code",
      evidence: [{ path: "src/api/index.ts", line: 1, spec: "../core/token.js" }],
    });
    const suggestions = (await p.ui("__mentions.search", {
      projectPath: project,
      query: "core",
      sessionId: "chat-a",
    })) as any[];
    expect(suggestions).toHaveLength(1);
    const id = suggestions[0].id;
    const mention = (await p.ui("__mentions.resolve", {
      projectPath: project,
      ids: [id],
      sessionId: "chat-a",
    })) as string;
    expect(mention).toContain("Files (1):\n- src/core/token.ts");
    await expect(
      p.ui("__mentions.resolve", { projectPath: project, ids: ["deleted"], sessionId: "chat-a" }),
    ).rejects.toThrow(/Module/);
    await p.ui("insert", { sessionId: "chat-b", moduleIds: [id] });
    expect(p.insert).toHaveBeenCalledWith(`@module:${id}`, "chat-b");
    const impact: Impact = {
      version: graph.version,
      task: "Change tokens",
      items: [
        {
          moduleId: id,
          category: "direct",
          reason: "Token is declared here",
          evidence: [{ path: "src/core/token.ts", line: 1, spec: "token" }],
        },
      ],
    };
    await p.tool("set_change_impact", impact as unknown as SandboxJson);
    const other = (await p.ui("state", { projectPath: project, sessionId: "chat-b" })) as any;
    expect(other.impact).toBeNull();
    const restored = await plugin();
    const saved = (await restored.ui("state", { projectPath: project, sessionId: "chat-a" })) as any;
    expect(saved.graph.version).toBe(graph.version);
    expect(saved.impact).toEqual(impact);
    await fs.writeFile(path.join(project, "src/core/token.ts"), "export const token = 'changed token';");
    expect(((await p.ui("state", { projectPath: project, sessionId: "chat-a" })) as any).stale).toBe(true);
    await expect(p.tool("set_change_impact", impact as unknown as SandboxJson)).rejects.toThrow(/stale/i);
    await expect(p.ui("insert", { sessionId: "deleted-chat", moduleIds: [id] })).rejects.toThrow(/session/);
  }, 25_000);

  it("cancels indexing without replacing the previous map and rejects invalid model output", async () => {
    const p = await plugin();
    await p.index();
    const { graph } = (await p.ui("state", { projectPath: project, sessionId: "chat-a" })) as unknown as {
      graph: Graph;
    };
    const job = (await p.ui("startIndex", { projectPath: project })) as any;
    await p.ui("cancelIndex", { id: job.id });
    await vi.waitFor(() =>
      expect(
        p.events.some(
          ([event, data]) =>
            event === "progress" && (data as any).id === job.id && (data as any).status === "cancelled",
        ),
      ).toBe(true),
    );
    expect(((await p.ui("state", { projectPath: project, sessionId: "chat-a" })) as any).graph.version).toBe(
      graph.version,
    );
    await expect(
      p.tool("update_module_groups", {
        version: graph.version,
        modules: [{ id: "invented", name: "Bad", description: "", files: ["outside.ts"] }],
      }),
    ).rejects.toThrow(/file/i);
    await expect(p.tool("set_change_impact", { version: "old", task: "test", items: [] })).rejects.toThrow(/version/i);
    await expect(
      p.tool("set_change_impact", {
        version: graph.version,
        task: "test",
        items: [
          {
            moduleId: graph.modules[0].id,
            category: "direct",
            reason: "why",
            evidence: [{ path: "invented.ts", line: 1, spec: "" }],
          },
        ],
      }),
    ).rejects.toThrow(/source/i);
  }, 25_000);
});
