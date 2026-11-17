import { describe, expect, it } from "vitest";
import { packages } from "@babel/standalone";
import {
  buildGraph,
  extractImports,
  hash,
  nearestConfig,
  type SourceFile,
  validateSemantic,
  semanticModules,
} from "../src/graph";

function file(path: string, source: string): SourceFile {
  const language = path.endsWith(".py") ? "python" : path.endsWith(".go") ? "go" : "js";
  return {
    path,
    size: source.length,
    modifiedAt: 1,
    hash: hash(source),
    language,
    imports: extractImports(path, source, (s, ts, jsx) =>
      packages.parser.parse(s, {
        sourceType: "unambiguous",
        plugins: [...(ts ? (["typescript"] as const) : []), ...(jsx ? (["jsx"] as const) : [])],
      }),
    ),
  };
}

describe("Project map semantic groups", () => {
  const files = ["src/api/a.ts", "src/api/v2/b.ts", "src/core/c.ts", "README.md", "scripts/x.sh"];
  it("drops unknown paths and empty groups, breaks parent cycles and collects unclaimed files", () => {
    const semantic = validateSemantic(
      {
        summary: " Gateway ",
        groups: [
          { id: "API", name: "API", description: "Entry", parent: "", role: "api", paths: ["src/api/", "nope"] },
          { id: "v2", name: "Version 2", description: "", parent: "api", role: "bogus", paths: ["src/api/v2"] },
          { id: "loop-a", name: "A", description: "", parent: "loop-b", role: "", paths: ["src/core/c.ts"] },
          { id: "loop-b", name: "B", description: "", parent: "loop-a", role: "", paths: ["src/core"] },
          { id: "ghost", name: "Ghost", description: "", parent: "", role: "", paths: ["missing"] },
          { id: "api", name: "Duplicate", description: "", parent: "", role: "", paths: ["README.md"] },
        ],
        relations: [
          { from: "api", to: "loop-a", reason: "HTTP" },
          { from: "api", to: "loop-b", reason: "removed with its group" },
          { from: "api", to: "ghost", reason: "gone" },
        ],
      },
      files,
    );
    expect(semantic.summary).toBe("Gateway");
    expect(semantic.groups.map((g) => [g.id, g.parent, g.role])).toEqual([
      ["api", null, "api"],
      ["v2", "api", null],
      // The cycle is cut at loop-a; loop-b then owns no file and disappears.
      ["loop-a", null, null],
      ["api-2", null, null],
      ["other", null, null],
    ]);
    expect(semantic.relations).toEqual([{ from: "api", to: "loop-a", reason: "HTTP" }]);
    expect(semanticModules(files, semantic).map((m) => [m.id, m.files])).toEqual([
      ["api", ["src/api/a.ts"]],
      ["v2", ["src/api/v2/b.ts"]],
      ["loop-a", ["src/core/c.ts"]],
      ["api-2", ["README.md"]],
      ["other", ["scripts/x.sh"]],
    ]);
  });
  it("refuses an answer that describes nothing", () => {
    expect(() => validateSemantic({ groups: [{ id: "x", name: "X", paths: ["nope"] }] }, files)).toThrow();
  });
});

describe("Project map source graph", () => {
  it("parses JS syntax, ignores comments/strings, resolves aliases and workspace packages", () => {
    const files = [
      file(
        "src/api/a.ts",
        '// import "fake"\nconst s="import fake"; import type { X } from "@core/types"; export {x} from "lib";',
      ),
      file("src/core/types.ts", "export type X = string"),
      file("packages/lib/index.ts", "export const x=1"),
    ];
    const graph = buildGraph(
      "/project",
      files,
      {
        "tsconfig.json": { compilerOptions: { baseUrl: ".", paths: { "@core/*": ["src/core/*"] } } },
        "packages/lib/package.json": { name: "lib", main: "index.ts" },
      },
      [],
    );
    expect(files[0].imports.map((i) => i.spec)).toEqual(["@core/types", "lib"]);
    expect(graph.edges).toHaveLength(2);
    // File-level targets feed the folder drill-down, including imports inside one module.
    expect(files[0].deps).toEqual(["packages/lib/index.ts", "src/core/types.ts"]);
    expect(files[1].deps).toEqual([]);
    const next = buildGraph("/project", [...files, file("src/core/new.ts", "")], {}, [], graph);
    expect(next.modules.find((m) => m.name === "src/core")?.id).toBe(
      graph.modules.find((m) => m.name === "src/core")?.id,
    );
  });
  it("resolves Python relative imports, source roots and ignores docstrings", () => {
    const files = [
      file("api/main.py", '"""from fake import nope"""\nfrom . import helper\nimport core.value as v\n'),
      file("api/helper.py", ""),
      file("core/value.py", ""),
    ];
    expect(files[0].imports.some((i) => i.spec.includes("fake"))).toBe(false);
    const graph = buildGraph("/project", files, {}, []);
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0].evidence[0]).toMatchObject({ path: "api/main.py", spec: "core.value" });
  });
  it("resolves Go grouped and aliased imports and keeps cyclic dependencies", () => {
    const files = [
      file("api/main.go", 'package api\nimport (\n core "example.dev/app/core"\n _ "net/http"\n)\n'),
      file("core/value.go", 'package core\nimport "example.dev/app/api"\n'),
    ];
    const graph = buildGraph("/project", files, { "go.mod": { module: "example.dev/app" } }, []);
    expect(graph.edges).toHaveLength(2);
    expect(files[0].imports.map((i) => i.spec)).toEqual(["example.dev/app/core", "net/http"]);
    expect(graph.limitations.join(" ")).toContain("Unresolved");
  });
  it("parses TS angle-bracket assertions and generic arrows, and JSX only in .tsx", () => {
    const ts = file("src/a.ts", 'import { b } from "./b";\nconst x = <string>value;\nconst id = <T>(v: T) => v;');
    expect(ts.imports.map((i) => i.spec)).toEqual(["./b"]);
    const tsx = file("src/c.tsx", 'import { b } from "./b";\nexport const C = () => <div>{b}</div>;');
    expect(tsx.imports.map((i) => i.spec)).toEqual(["./b"]);
  });
  it("reads parenthesized Python member lists across lines", () => {
    const main = file("app/main.py", "from pkg import (\n    alpha,\n    beta as b,\n)\nimport os\n");
    expect(main.imports.map((i) => i.spec)).toEqual(["pkg", "pkg.alpha", "pkg.beta", "os"]);
    const graph = buildGraph("/p", [main, file("pkg/__init__.py", ""), file("pkg/beta.py", "")], {}, []);
    expect(graph.edges[0].evidence.map((e) => e.spec)).toContain("pkg.beta");
  });
  it("routes Go imports to the longest matching nested module", () => {
    const files = [
      file("main.go", 'package main\nimport "example.dev/app/tools/lint"\n'),
      file("tools/lint/lint.go", "package lint\n"),
      file("toolkit/lint/lint.go", "package lint\n"),
    ];
    // The nested module lives in toolkit/ but owns the example.dev/app/tools path.
    const graph = buildGraph(
      "/p",
      files,
      { "toolkit/go.mod": { module: "example.dev/app/tools" }, "go.mod": { module: "example.dev/app" } },
      [],
    );
    const owner = (path: string) => graph.modules.find((m) => m.files.includes(path))!.id;
    expect(graph.edges.map((e) => e.to)).toEqual([owner("toolkit/lint/lint.go")]);
  });
  it("picks the nearest tsconfig and prefers tsconfig.json over variants", () => {
    const configs = { "tsconfig.json": {}, "tsconfig.electron.json": {}, "packages/a/tsconfig.build.json": {} };
    expect(nearestConfig(configs, "src/x.ts")).toBe("tsconfig.json");
    expect(nearestConfig(configs, "packages/a/x.ts")).toBe("packages/a/tsconfig.build.json");
  });
});
