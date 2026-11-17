/* The UI has no Node or network access; all project data comes through the plugin. */
(async () => {
  const bridge = window.kodaPlugin;
  if (!bridge) {
    document.querySelector("#status").textContent = "Open this plugin inside Koda Desktop.";
    return;
  }
  const info = await bridge.info();
  const $ = (id) => document.getElementById(id);
  let language = info.language,
    sessionId = info.sessionId,
    projectPath = null,
    graph = null,
    impact = null,
    job = null,
    stale = false,
    toolsAvailable = true;
  let selected = new Set(),
    agentLine = "",
    warning = "",
    scale = 1,
    pan = { x: 25, y: 25 },
    epoch = 0,
    sourceEpoch = 0,
    reloadSequence = 0;
  const strings = {
    ru: {
      title: "Карта проекта",
      refresh: "Обновить",
      cancel: "Отменить",
      search: "Найти папку или файл…",
      fit: "Вписать",
      insert: "Добавить в чат",
      empty: "Посмотрите, как устроен проект",
      emptyText:
        "Агент изучит код и разложит проект на понятные части: что за что отвечает и как они связаны. Он только читает файлы.",
      build: "Построить карту",
      select: "Выберите модуль",
      hint: "Нажмите на папку, чтобы увидеть её связи. Двойной клик открывает её. Shift + клик выбирает несколько.",
      up: "На уровень выше",
      expand: "Развернуть",
      expandHint: "Открыть карту на весь экран на этом же месте",
      closeDetails: "Скрыть",
      rethink: "Пересобрать с агентом",
      rethinkHint: "Агент заново изучит проект и предложит новую структуру",
      understanding: "Агент изучает проект",
      agentFailed: "Агент не смог описать проект, карта показана по папкам.",
      hintGroups: "Части проекта выделил агент. Двойной клик открывает часть, стрелки показывают, кто от кого зависит.",
      openGroup: "Открыть",
      groupOwn: "Файлы группы",
      otherGroup: "Прочее",
      groups: "Части",
      meaningLinks: "Связи по смыслу",
      modelLink: "Пунктир: связь, которую назвал агент",
      "role.entry": "вход",
      "role.api": "API",
      "role.domain": "логика",
      "role.data": "данные",
      "role.integration": "интеграции",
      "role.ui": "интерфейс",
      "role.infra": "инфраструктура",
      "role.shared": "общее",
      "role.tests": "тесты",
      "role.config": "конфигурация",
      "role.docs": "документация",
      "role.tooling": "инструменты",
      openFolder: "Открыть папку",
      openFile: "Открыть файл",
      dependsOn: "Использует",
      usedBy: "Используется в",
      modules: "Модули",
      mostUsed: "Чаще всего используются",
      results: "Найдено",
      flow: "Стрелка: кто → от кого зависит",
      dblHint: "Двойной клик: открыть",
      file: "Файл",
      roleEntry: "вход",
      roleCore: "основа",
      roleTests: "тесты",
      roleIsolated: "отдельно",
      roleEntryText: "Использует соседей, но сам здесь никому не нужен: похоже на точку входа этого уровня.",
      roleCoreText: "От этой папки зависят соседи, а сама она на них не опирается: базовый слой уровня.",
      roleTestsText: "Только тесты.",
      roleIsolatedText: "Ни с чем не связана импортами.",
      oldMap: "Карта построена старой версией плагина. Обновите её, чтобы увидеть связи между папками.",
      files: "Файлы",
      relations: "Связи",
      direct: "Прямые изменения",
      indirect: "Косвенное влияние",
      check: "Проверить",
      model: "Гипотеза модели",
      code: "Связь из кода",
      limitations: "Ограничения анализа",
      ready: "Обсудите задачу в чате — агент может отметить область изменения.",
      noChat: "Откройте карту рядом с чатом, чтобы передать модули агенту.",
      stale: "Код изменился. Обновите карту; прежний прогноз устарел.",
      oldImpact: "Прогноз относится к предыдущей версии карты.",
      listing: "Читаю список файлов…",
      indexing: "Строю карту",
      cancelled: "Индексация отменена",
      complete: "Карта обновлена",
      forecast: "Прогноз",
      noResult: "Модули не найдены",
      truncated: "Показаны первые 100 файлов.",
      nothing: "Модули пока не выбраны",
      noTools: "В режиме только чтения инструменты карты могут быть недоступны. Ссылки на модули можно передать в чат.",
      sourceCut: "Показан фрагмент до 100 000 символов.",
      project: "Проект",
    },
    en: {
      title: "Project map",
      refresh: "Refresh",
      cancel: "Cancel",
      search: "Find a folder or file…",
      fit: "Fit",
      insert: "Add to chat",
      empty: "Explore how your project fits together",
      emptyText:
        "The agent reads the code and breaks the project into understandable parts: what each one does and how they connect. It only reads files.",
      build: "Build map",
      select: "Select a module",
      hint: "Select a folder to see its relationships. Double-click opens it. Shift + click selects several.",
      up: "Up one level",
      expand: "Expand",
      expandHint: "Open the map full screen at the same place",
      closeDetails: "Hide",
      rethink: "Rebuild with agent",
      rethinkHint: "The agent studies the project again and proposes a new structure",
      understanding: "The agent is studying the project",
      agentFailed: "The agent could not describe the project; the map shows folders.",
      hintGroups: "The agent identified these parts. Double-click opens a part; arrows show what depends on what.",
      openGroup: "Open",
      groupOwn: "Group files",
      otherGroup: "Other",
      groups: "Parts",
      meaningLinks: "Relationships by meaning",
      modelLink: "Dashed: a relationship named by the agent",
      "role.entry": "entry",
      "role.api": "API",
      "role.domain": "logic",
      "role.data": "data",
      "role.integration": "integrations",
      "role.ui": "UI",
      "role.infra": "infrastructure",
      "role.shared": "shared",
      "role.tests": "tests",
      "role.config": "configuration",
      "role.docs": "docs",
      "role.tooling": "tooling",
      openFolder: "Open folder",
      openFile: "Open file",
      dependsOn: "Uses",
      usedBy: "Used by",
      modules: "Modules",
      mostUsed: "Most used",
      results: "Results",
      flow: "Arrow: consumer → dependency",
      dblHint: "Double-click to open",
      file: "File",
      roleEntry: "entry",
      roleCore: "core",
      roleTests: "tests",
      roleIsolated: "isolated",
      roleEntryText: "Uses its siblings but nothing here uses it: likely the entry point of this level.",
      roleCoreText: "Siblings depend on it while it relies on none of them: the base layer of this level.",
      roleTestsText: "Tests only.",
      roleIsolatedText: "No import relationships.",
      oldMap: "This map was built by an older plugin version. Refresh it to see folder relationships.",
      files: "Files",
      relations: "Relationships",
      direct: "Direct changes",
      indirect: "Indirect impact",
      check: "Verify",
      model: "Model hypothesis",
      code: "Code relationship",
      limitations: "Analysis limitations",
      ready: "Discuss a task in chat — your agent can highlight its expected impact.",
      noChat: "Open the map beside a chat to reference modules.",
      stale: "Code changed. Refresh the map; the previous forecast is stale.",
      oldImpact: "This forecast belongs to an older map version.",
      listing: "Reading project files…",
      indexing: "Building map",
      cancelled: "Indexing cancelled",
      complete: "Map refreshed",
      forecast: "Forecast",
      noResult: "No modules found",
      truncated: "Showing the first 100 files.",
      nothing: "No modules selected yet",
      noTools: "Map tools may be unavailable in read-only mode. Module references can still be added to chat.",
      sourceCut: "Showing up to 100,000 characters.",
      project: "Project",
    },
  };
  const t = (key) => strings[language][key] || key;
  const WORKSPACE = "project-map";
  const inPane = info.viewId !== WORKSPACE;
  const quantity = (count, type) => {
    const forms = {
      ru: {
        files: ["файл", "файла", "файлов"],
        modules: ["модуль", "модуля", "модулей"],
        folders: ["папка", "папки", "папок"],
        imports: ["импорт", "импорта", "импортов"],
        parts: ["часть", "части", "частей"],
      },
      en: {
        files: ["file", "files", "files"],
        modules: ["module", "modules", "modules"],
        folders: ["folder", "folders", "folders"],
        imports: ["import", "imports", "imports"],
        parts: ["part", "parts", "parts"],
      },
    }[language][type];
    const plural = new Intl.PluralRules(language).select(count);
    return `${new Intl.NumberFormat(language).format(count)} ${forms[plural === "one" ? 0 : plural === "few" ? 1 : 2]}`;
  };
  const limitation = (text) => {
    if (language !== "ru") return text;
    return text
      .replace(
        "Dynamic loading, reflection, Python runtime paths and Go build tags are not evaluated.",
        "Динамическая загрузка, рефлексия, пути Python runtime и Go build tags не вычисляются.",
      )
      .replace(
        "Import analysis supports JS/TS, Python and Go; other files are shown structurally.",
        "Импорты разбираются для JS/TS, Python и Go; остальные файлы показаны в структуре.",
      )
      .replace(
        "File listing is incomplete (maximum 4000 files; files over 512 KiB are excluded).",
        "Список неполный: до 4000 файлов, файлы больше 512 KiB исключены.",
      )
      .replace("Unresolved imports (including external packages):", "Неразрешённые импорты, включая внешние пакеты:")
      .replace("Could not parse imports:", "Не удалось разобрать импорты:")
      .replace("Could not read:", "Не удалось прочитать:")
      .replace("External tsconfig extends not resolved:", "Внешний tsconfig extends не разрешён:")
      .replace("Missing tsconfig extends:", "Не найден tsconfig extends:")
      .replace("Cyclic tsconfig extends:", "Циклический tsconfig extends:");
  };
  const el = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  function error(e) {
    $("error").hidden = false;
    $("error").textContent = String(e?.message || e);
  }
  async function call(method, params) {
    try {
      return await bridge.call(method, params);
    } catch (e) {
      error(e);
      throw e;
    }
  }
  const validImpact = () => impact && graph && impact.version === graph.version && !stale;
  const busyJob = () => job && ["listing", "indexing", "understanding"].includes(job.status);
  const NODE_W = 232,
    NODE_H = 100,
    COL_GAP = 96,
    ROW_GAP = 20;
  const RANK = { direct: 3, indirect: 2, check: 1 };
  const OTHER = "other";
  const isTest = (p) => /(^|\/)(__tests__|tests?|spec)\/|\.(test|spec)\.[^/]+$|_test\.go$/.test(p);
  const parentOf = (p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
  const projectName = () => graph.projectPath.split(/[\\/]/).pop() || "/";
  // Derived once per graph version: folders, file owners, importers and the agent's group tree.
  let tree = null;
  function buildTree() {
    const folders = new Map([["", []]]);
    for (const f of graph.files)
      for (let d = parentOf(f.path); ; d = parentOf(d)) {
        if (!folders.has(d)) folders.set(d, []);
        folders.get(d).push(f.path);
        if (!d) break;
      }
    const moduleOf = new Map();
    graph.modules.forEach((m) => m.files.forEach((f) => moduleOf.set(f, m.id)));
    const importers = new Map();
    graph.files.forEach((f) =>
      (f.deps || []).forEach((d) => {
        if (!importers.has(d)) importers.set(d, []);
        importers.get(d).push(f.path);
      }),
    );
    const semantic = graph.semantic?.groups?.length ? graph.semantic : null;
    const groups = new Map((semantic?.groups || []).map((g) => [g.id, { ...g, children: [], own: [], files: [] }]));
    if (semantic) {
      groups.forEach((g) => g.parent && groups.get(g.parent)?.children.push(g.id));
      // Same rule as the plugin: the longest claimed path owns a file, unclaimed files go to `other`.
      const claims = [];
      groups.forEach((g) => g.paths.forEach((p) => claims.push([p, g.id])));
      claims.sort((a, b) => b[0].length - a[0].length);
      for (const f of graph.files) {
        const owner = claims.find(([p]) => f.path === p || f.path.startsWith(p + "/"))?.[1] || OTHER;
        if (!groups.has(owner))
          groups.set(OTHER, {
            id: OTHER,
            name: "",
            description: "",
            parent: null,
            role: null,
            paths: [],
            children: [],
            own: [],
            files: [],
          });
        groups.get(owner).own.push(f.path);
        for (let g = owner; g; g = groups.get(g)?.parent) groups.get(g)?.files.push(f.path);
      }
    }
    const groupOf = new Map();
    groups.forEach((g) => g.own.forEach((f) => groupOf.set(f, g.id)));
    tree = {
      folders,
      byPath: new Map(graph.files.map((f) => [f.path, f])),
      moduleOf,
      importers,
      semantic,
      groups,
      groupOf,
      version: graph.version,
    };
  }
  const groupName = (g) => (g.id === OTHER ? t("otherGroup") : g.name);
  // Navigation is a stack of levels, so a crumb can name a group even when the level below is a folder.
  let stack = [{ key: "root" }];
  const levelKey = () => stack[stack.length - 1].key;
  function folderItems(files, base, scope) {
    const prefix = base ? base + "/" : "";
    const children = new Map();
    for (const f of files) {
      if (!f.startsWith(prefix)) continue;
      const rest = f.slice(prefix.length).split("/");
      const key = rest.length === 1 ? f : prefix + rest[0];
      if (!children.has(key)) children.set(key, { dir: rest.length > 1, files: [] });
      children.get(key).files.push(f);
    }
    return [...children.entries()].map(([path, c]) => {
      let shown = path;
      // A folder holding a single folder and nothing else is skipped: `src/main/java` reads as one step.
      while (c.dir) {
        const next = new Set(c.files.map((f) => f.slice(shown.length + 1).split("/")));
        const firsts = new Set([...next].map((parts) => (parts.length > 1 ? parts[0] : null)));
        if (firsts.size !== 1 || firsts.has(null)) break;
        shown = `${shown}/${[...firsts][0]}`;
      }
      return {
        key: shown,
        kind: c.dir ? "folder" : "file",
        label: shown.slice(prefix.length),
        path: shown,
        files: c.files,
        open: c.dir ? { key: `d:${scope}:${shown}`, label: shown.slice(prefix.length) } : null,
      };
    });
  }
  const commonFolder = (files) => {
    let common = parentOf(files[0] || "");
    for (const f of files) while (common && !f.startsWith(common + "/")) common = parentOf(common);
    return common;
  };
  function groupItem(g) {
    // A leaf opens straight into its own folders; a parent opens into its children.
    const open = g.children.length
      ? { key: `g:${g.id}`, label: groupName(g) }
      : { key: `d:${g.id}:${commonFolder(g.own)}`, label: groupName(g) };
    return {
      key: `g:${g.id}`,
      kind: "group",
      label: groupName(g),
      group: g,
      files: g.files,
      open: g.files.length > 1 || g.children.length ? open : null,
    };
  }
  function levelItems(key) {
    if (key === "root") {
      if (tree.semantic) return [...tree.groups.values()].filter((g) => !g.parent).map(groupItem);
      return folderItems(tree.folders.get("") || [], "", "");
    }
    if (key.startsWith("g:")) {
      const g = tree.groups.get(key.slice(2));
      if (!g) return [];
      const items = g.children.map((id) => groupItem(tree.groups.get(id)));
      if (g.own.length)
        items.push({
          key: `own:${g.id}`,
          kind: "folder",
          label: t("groupOwn"),
          files: g.own,
          open: { key: `d:${g.id}:${commonFolder(g.own)}`, label: t("groupOwn") },
        });
      return items;
    }
    const [, scope, ...rest] = key.split(":");
    const base = rest.join(":");
    const files = scope ? tree.groups.get(scope)?.own || [] : tree.folders.get("") || [];
    return folderItems(files, base, scope);
  }
  const forecastFor = (files) => {
    if (!validImpact()) return null;
    const ids = new Set(files.map((f) => tree.moduleOf.get(f)));
    return impact.items.filter((i) => ids.has(i.moduleId)).sort((a, b) => RANK[b.category] - RANK[a.category])[0];
  };
  const filesOf = (keys, items) => items.filter((c) => keys.has(c.key)).flatMap((c) => c.files);
  const modulesFor = (files) => [...new Set(files.map((f) => tree.moduleOf.get(f)).filter(Boolean))];
  function analyze(items) {
    const owner = new Map();
    items.forEach((c) => c.files.forEach((f) => owner.set(f, c.key)));
    const edges = new Map(),
      stats = new Map(items.map((c) => [c.key, { out: 0, in: 0, extOut: 0, extIn: 0 }]));
    for (const f of graph.files) {
      const from = owner.get(f.path);
      for (const d of f.deps || []) {
        const to = owner.get(d);
        if (from && to && from !== to) {
          const k = `${from}\n${to}`;
          const edge = edges.get(k) || { from, to, count: 0, model: false };
          edge.count++;
          edges.set(k, edge);
        } else if (from && !to) stats.get(from).extOut++;
        else if (!from && to) stats.get(to).extIn++;
      }
    }
    // Links the agent named (HTTP, events, configuration) between groups shown on this level.
    if (tree.semantic) {
      const shownGroup = new Map();
      items.forEach((c) => {
        if (c.group) for (const id of descendants(c.group.id)) shownGroup.set(id, c.key);
      });
      for (const r of tree.semantic.relations || []) {
        const from = shownGroup.get(r.from),
          to = shownGroup.get(r.to);
        if (!from || !to || from === to) continue;
        const k = `${from}\n${to}`;
        const edge = edges.get(k) || { from, to, count: 0, model: false };
        edge.model = true;
        (edge.reasons ||= []).push(r.reason);
        edges.set(k, edge);
      }
    }
    edges.forEach((e) => {
      stats.get(e.from).out++;
      stats.get(e.to).in++;
    });
    return { edges: [...edges.values()], stats };
  }
  function descendants(id) {
    const out = [id];
    for (let i = 0; i < out.length; i++) out.push(...(tree.groups.get(out[i])?.children || []));
    return out;
  }
  // Layered layout: consumers on the left, the code they rely on to the right. Cycles are cut by DFS order.
  function layout(items, edges) {
    const out = new Map(items.map((c) => [c.key, []]));
    edges.filter((e) => e.count).forEach((e) => out.get(e.from).push(e.to));
    const state = new Map(),
      back = new Set();
    const dfs = (v) => {
      state.set(v, 1);
      for (const w of out.get(v)) {
        if (state.get(w) === 1) back.add(`${v}\n${w}`);
        else if (!state.get(w)) dfs(w);
      }
      state.set(v, 2);
    };
    items.forEach((c) => !state.get(c.key) && dfs(c.key));
    const rank = new Map();
    const depth = (v) => {
      if (rank.has(v)) return rank.get(v);
      rank.set(v, 0);
      let r = 0;
      for (const w of out.get(v)) if (!back.has(`${v}\n${w}`)) r = Math.max(r, depth(w) + 1);
      rank.set(v, r);
      return r;
    };
    items.forEach((c) => depth(c.key));
    const max = Math.max(0, ...rank.values());
    const columns = [];
    items.forEach((c) => (columns[max - rank.get(c.key)] ||= []).push(c));
    const order = { group: 0, folder: 1, file: 2 };
    const coords = new Map();
    // A tall, narrow pane stacks the layers top to bottom so cards stay readable.
    const box = $("viewport");
    const vertical = box.clientHeight > box.clientWidth * 1.1;
    const perLayer = vertical
      ? Math.max(2, Math.floor((box.clientWidth - 48) / ((NODE_W + 24) * 0.8)))
      : Math.max(6, Math.ceil(Math.sqrt(items.length * 1.5)));
    let offset = 0;
    columns.forEach((col) => {
      col.sort(
        (a, b) => order[a.kind] - order[b.kind] || b.files.length - a.files.length || a.label.localeCompare(b.label),
      );
      for (let i = 0; i < col.length; i += perLayer) {
        col
          .slice(i, i + perLayer)
          .forEach((c, j) =>
            coords.set(
              c.key,
              vertical ? { x: j * (NODE_W + 24), y: offset } : { x: offset, y: j * (NODE_H + ROW_GAP) },
            ),
          );
        offset += vertical ? NODE_H + 64 : NODE_W + COL_GAP;
      }
    });
    const points = [...coords.values()];
    if (vertical) {
      // Centre short rows under the widest one.
      const width = Math.max(...points.map((p) => p.x + NODE_W));
      const rows = new Map();
      coords.forEach((p, k) => {
        if (!rows.has(p.y)) rows.set(p.y, []);
        rows.get(p.y).push(k);
      });
      rows.forEach((keys) => {
        const right = Math.max(...keys.map((k) => coords.get(k).x + NODE_W));
        keys.forEach((k) => (coords.get(k).x += (width - right) / 2));
      });
    }
    return {
      coords,
      back,
      vertical,
      width: Math.max(NODE_W, ...points.map((p) => p.x + NODE_W)),
      height: Math.max(NODE_H, ...points.map((p) => p.y + NODE_H)),
    };
  }
  function structuralRole(item, stat) {
    if (item.files.every(isTest)) return "roleTests";
    if (item.kind === "file") return null;
    if (stat.in === 0 && stat.out > 0) return "roleEntry";
    if (stat.out === 0 && stat.in > 1) return "roleCore";
    if (stat.in === 0 && stat.out === 0 && stat.extIn === 0 && stat.extOut === 0) return "roleIsolated";
    return null;
  }
  let view = { width: 0, height: 0 };
  function transform() {
    $("board").style.transform = `translate(${pan.x}px,${pan.y}px) scale(${scale})`;
  }
  function fit() {
    const box = $("viewport");
    scale = Math.max(
      0.25,
      Math.min(
        1.1,
        (box.clientWidth - 64) / Math.max(view.width, 1),
        (box.clientHeight - 64) / Math.max(view.height, 1),
      ),
    );
    pan = {
      x: Math.max(32, (box.clientWidth - view.width * scale) / 2),
      y: Math.max(32, (box.clientHeight - view.height * scale) / 2),
    };
    transform();
  }
  function go(nextStack, select) {
    stack = nextStack;
    selected = new Set(select ? [select] : []);
    pendingReveal = null;
    render();
    fit();
  }
  const enter = (open) => go([...stack, open]);
  let pendingReveal = null;
  /** Opens the level that shows `path` (a file or folder) and selects the card holding it. */
  function reveal(path) {
    const file = tree.byPath.has(path) ? path : (tree.folders.get(path) || [])[0];
    if (!file) return;
    const next = [{ key: "root" }];
    if (tree.semantic) {
      const owner = tree.groupOf.get(file);
      const chain = [];
      for (let g = owner; g; g = tree.groups.get(g)?.parent) chain.unshift(tree.groups.get(g));
      chain.slice(0, -1).forEach((g) => next.push({ key: `g:${g.id}`, label: groupName(g) }));
      const leaf = chain[chain.length - 1];
      if (leaf.children.length) next.push({ key: `g:${leaf.id}`, label: groupName(leaf) });
      next.push({
        key: `d:${leaf.id}:${commonFolder(leaf.own)}`,
        label: leaf.children.length ? t("groupOwn") : groupName(leaf),
      });
    }
    // Walk down the folders until the card that holds the target is on screen.
    for (let guard = 0; guard < 30; guard++) {
      const items = levelItems(next[next.length - 1].key);
      const hit = items.find((c) => c.path === path || c.files.includes(file));
      if (
        !hit ||
        hit.path === path ||
        hit.kind !== "folder" ||
        !hit.open ||
        !(path === hit.path || path.startsWith(hit.path + "/"))
      )
        break;
      next.push(hit.open);
    }
    stack = next;
    pendingReveal = file;
    $("search").value = "";
    render();
    fit();
  }
  async function showSource(path, line = 1) {
    const sourceId = ++sourceEpoch,
      currentProject = projectPath;
    const text = await call("readSource", { projectPath, path });
    if (sourceId !== sourceEpoch || currentProject !== projectPath) return;
    $("source").querySelector("strong").textContent = `${path}:${line}`;
    const pre = $("source").querySelector("pre");
    pre.replaceChildren();
    text.split("\n").forEach((value, i) => {
      pre.append(
        el("span", `${String(i + 1).padStart(4)}  ${value}`, "source-line" + (i + 1 === line ? " target" : "")),
      );
    });
    if (text.length >= 100000) pre.append(el("span", t("sourceCut")));
    if (!$("source").open) $("source").showModal();
    pre.querySelector(".target")?.scrollIntoView({ block: "center" });
  }
  function fileButton(path, line) {
    const b = el("button", line ? `${path}:${line}` : path, "file");
    b.title = b.textContent;
    b.onclick = () => void showSource(path, line).catch(() => {});
    return b;
  }
  function jumpButton(label, count, target, className = "") {
    const row = el("button", undefined, `jump ${className}`);
    row.append(el("span", label), el("small", count ? String(count) : ""));
    row.title = target;
    row.onclick = () => reveal(target);
    return row;
  }
  function section(title, items) {
    if (!items.length) return;
    if (title) $("details").append(el("h3", title));
    const list = el("div", undefined, "list");
    list.append(...items);
    $("details").append(list);
  }
  /** Groups linked files by meaning (the agent's group) or, without groups, by folder. */
  function grouped(files) {
    const counts = new Map();
    for (const f of files) {
      const g = tree.semantic ? tree.groups.get(tree.groupOf.get(f)) : null;
      const key = g ? `g:${g.id}` : parentOf(f) || f;
      const entry = counts.get(key) || { label: g ? groupName(g) : parentOf(f) || f, count: 0, target: f, group: !!g };
      entry.count++;
      counts.set(key, entry);
    }
    return [...counts.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }
  const roleLabel = (role) => (role ? t(`role.${role}`) : "");
  function details(items, analysis) {
    const panel = $("details");
    panel.replaceChildren();
    const query = $("search").value.trim().toLowerCase();
    if (query) {
      const groupHits = tree.semantic
        ? [...tree.groups.values()]
            .filter((g) => `${g.name} ${g.description}`.toLowerCase().includes(query))
            .slice(0, 20)
        : [];
      const folderHits = [...tree.folders.keys()].filter((p) => p && p.toLowerCase().includes(query));
      const fileHits = graph.files.map((f) => f.path).filter((p) => p.toLowerCase().includes(query));
      const hits = [...folderHits.sort((a, b) => a.length - b.length), ...fileHits].slice(0, 60);
      panel.append(el("h2", t("results")));
      if (!hits.length && !groupHits.length) panel.append(el("p", t("noResult"), "muted"));
      section(
        groupHits.length ? t("groups") : "",
        groupHits.map((g) => {
          const b = el("button", undefined, "jump is-group");
          b.append(el("span", groupName(g)), el("small", String(g.files.length)));
          b.onclick = () => g.files[0] && reveal(g.files[0]);
          return b;
        }),
      );
      section(
        groupHits.length && hits.length ? t("files") : "",
        hits.map((p) =>
          jumpButton(p, tree.folders.has(p) ? tree.folders.get(p).length : 0, p, tree.folders.has(p) ? "is-dir" : ""),
        ),
      );
      return;
    }
    const item = items.find((c) => selected.has(c.key));
    if (!item) {
      const current = stack[stack.length - 1];
      const levelGroup = current.key.startsWith("g:") ? tree.groups.get(current.key.slice(2)) : null;
      panel.append(el("h2", current.key === "root" ? projectName() : current.label));
      if (current.key === "root" && tree.semantic?.summary) panel.append(el("p", tree.semantic.summary, "summary"));
      else if (levelGroup?.description) panel.append(el("p", levelGroup.description, "summary"));
      panel.append(el("p", t(tree.semantic && !current.key.startsWith("d:") ? "hintGroups" : "hint"), "muted"));
      const files = items.flatMap((c) => c.files);
      panel.append(el("p", `${quantity(files.length, "files")} · ${quantity(items.length, "parts")}`, "meta"));
      const top = [...analysis.stats.entries()].filter(([, s]) => s.in > 0).sort((a, b) => b[1].in - a[1].in);
      section(
        t("mostUsed"),
        top.slice(0, 6).map(([k, s]) => {
          const b = el("button", undefined, "jump plain");
          b.append(el("span", items.find((c) => c.key === k).label), el("small", String(s.in)));
          b.onclick = () => {
            selected = new Set([k]);
            render();
          };
          return b;
        }),
      );
      return;
    }
    const stat = analysis.stats.get(item.key);
    const head = el("div", undefined, "detail-head");
    head.append(el("h2", item.label));
    if (item.group?.role) head.append(el("span", roleLabel(item.group.role), "tag role"));
    if (item.path) head.append(el("p", item.path, "path"));
    panel.append(head);
    if (item.group?.description) panel.append(el("p", item.group.description, "summary"));
    const role = item.group ? null : structuralRole(item, stat);
    if (role) panel.append(el("p", t(role + "Text"), "role-note"));
    const actions = el("div", undefined, "actions");
    if (item.open) {
      const b = el("button", t(item.kind === "group" ? "openGroup" : "openFolder"), "primary");
      b.onclick = () => enter(item.open);
      actions.append(b);
    }
    if (item.kind === "file" || (item.kind === "group" && item.files.length === 1)) {
      const b = el("button", t("openFile"), item.open ? "" : "primary");
      b.onclick = () => void showSource(item.files[0]).catch(() => {});
      actions.append(b);
    }
    panel.append(actions);
    if (selected.size > 1)
      panel.append(el("p", `${selected.size} ${language === "ru" ? "выбрано" : "selected"}`, "meta"));
    const forecast = forecastFor(item.files);
    if (forecast) {
      const block = el("div", undefined, `forecast ${forecast.category}`);
      block.append(el("strong", t(forecast.category)), el("p", forecast.reason));
      forecast.evidence.forEach((e) => block.append(fileButton(e.path, e.line)));
      panel.append(block);
    }
    const inside = new Set(item.files);
    const outgoing = [],
      incoming = [];
    item.files.forEach((f) => {
      (tree.byPath.get(f)?.deps || []).forEach((d) => !inside.has(d) && outgoing.push(d));
      (tree.importers.get(f) || []).forEach((s) => !inside.has(s) && incoming.push(s));
    });
    section(
      t("dependsOn"),
      grouped(outgoing).map((g) => jumpButton(g.label, g.count, g.target, g.group ? "is-group" : "")),
    );
    section(
      t("usedBy"),
      grouped(incoming).map((g) => jumpButton(g.label, g.count, g.target, g.group ? "is-group" : "")),
    );
    if (item.group && tree.semantic) {
      const ids = new Set(descendants(item.group.id));
      const notes = (tree.semantic.relations || [])
        .filter((r) => ids.has(r.from) !== ids.has(r.to))
        .map((r) => {
          const other = tree.groups.get(ids.has(r.from) ? r.to : r.from);
          const row = el("div", undefined, "module-note");
          row.append(
            el("strong", `${ids.has(r.from) ? "→" : "←"} ${other ? groupName(other) : ""}`),
            el("p", r.reason),
          );
          return row;
        });
      section(t("meaningLinks"), notes.slice(0, 12));
    }
    if (item.kind !== "file") {
      section(
        `${t("files")} · ${item.files.length}`,
        item.files.slice(0, 100).map((p) => fileButton(p)),
      );
      if (item.files.length > 100) panel.append(el("p", t("truncated"), "muted"));
    }
  }
  function crumbs() {
    const bar = $("crumbs");
    bar.replaceChildren();
    stack.forEach((entry, i) => {
      if (i) bar.append(el("span", "/", "sep"));
      const b = el("button", i ? entry.label : projectName(), "crumb" + (i === stack.length - 1 ? " current" : ""));
      b.onclick = () =>
        i < stack.length - 1 && go(stack.slice(0, i + 1), stack[i + 1]?.key.startsWith("g:") ? stack[i + 1].key : null);
      bar.append(b);
    });
  }
  const ICONS = {
    group:
      '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.75" y="1.75" width="5.5" height="5.5" rx="1.2"/><rect x="8.75" y="1.75" width="5.5" height="5.5" rx="1.2"/><rect x="1.75" y="8.75" width="5.5" height="5.5" rx="1.2"/><rect x="8.75" y="8.75" width="5.5" height="5.5" rx="1.2"/></svg>',
    folder:
      '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.75 3.5h4l1.5 1.5h7v7.75a.75.75 0 0 1-.75.75h-11a.75.75 0 0 1-.75-.75z"/></svg>',
    file: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.75 1.75h5.5l3 3v9.5h-8.5z"/><path d="M9.25 1.75v3h3"/></svg>',
  };
  function languageLabel(path) {
    const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase();
    return ext ? ext.toUpperCase() : t("file");
  }
  function statusText() {
    if (busyJob()) {
      if (job.status === "listing") return t("listing");
      if (job.status === "indexing") return `${t("indexing")} · ${job.done}/${job.total}`;
      return agentLine ? `${t("understanding")} · ${agentLine}` : t("understanding");
    }
    if (stale) return t("stale");
    if (graph && graph.files.length && graph.files.every((f) => !f.deps)) return t("oldMap");
    if (impact && graph && impact.version !== graph.version) return t("oldImpact");
    if (!sessionId) return t("noChat");
    if (!toolsAvailable) return t("noTools");
    if (validImpact()) return `${t("forecast")}: ${impact.task.slice(0, 160)}`;
    return t("ready");
  }
  function render() {
    document.documentElement.lang = language;
    $("title").textContent = t("title");
    for (const id of ["refresh", "cancel", "fit", "build", "insert", "rethink", "expand"]) $(id).textContent = t(id);
    $("expand").hidden = !inPane || !graph;
    $("expand").title = t("expandHint");
    document.body.classList.toggle("has-selection", selected.size > 0 || !!$("search").value.trim());
    $("search").placeholder = t("search");
    $("search").setAttribute("aria-label", t("search"));
    $("projects").setAttribute("aria-label", t("project"));
    $("empty").querySelector("h2").textContent = t("empty");
    $("empty").querySelector("p").textContent = t("emptyText");
    $("empty").hidden = !!graph;
    $("build").disabled = !projectPath;
    const busy = busyJob();
    $("refresh").disabled = !!busy || !projectPath;
    $("rethink").hidden = !graph;
    $("rethink").disabled = !!busy;
    $("rethink").title = t("rethinkHint");
    $("cancel").hidden = !busy;
    $("status").textContent = statusText();
    $("status").classList.toggle("working", !!busy);
    $("status").title = validImpact() ? impact.task : "";
    $("warning").hidden = !warning || !!busy;
    $("warning").textContent = warning ? `${t("agentFailed")} ${warning}` : "";
    $("stats").textContent = graph ? quantity(graph.files.length, "files") : "";
    $("viewport").setAttribute("aria-label", t("title"));
    $("zoomIn").setAttribute("aria-label", language === "ru" ? "Увеличить" : "Zoom in");
    $("zoomOut").setAttribute("aria-label", language === "ru" ? "Уменьшить" : "Zoom out");
    $("up").setAttribute("aria-label", t("up"));
    $("up").title = t("up");
    $("legend").replaceChildren(
      ...["direct", "indirect", "check"].map((k) => el("span", t(k), `dot ${k}`)),
      el("span", t("flow"), "flow"),
      ...(graph?.semantic?.groups?.length ? [el("span", t("modelLink"), "flow")] : []),
    );
    $("limitations").querySelector("summary").textContent = t("limitations");
    $("limitations")
      .querySelector("ul")
      .replaceChildren(...(graph?.limitations || []).map((s) => el("li", limitation(s))));
    const nodes = $("nodes"),
      svg = $("edges");
    nodes.replaceChildren();
    svg.replaceChildren();
    $("crumbs").replaceChildren();
    $("up").disabled = true;
    if (!graph) {
      $("insert").disabled = true;
      $("details").replaceChildren();
      return;
    }
    if (!tree || tree.version !== graph.version) {
      const wasSemantic = !!tree?.semantic;
      buildTree();
      // The groups changed under the open level (the agent finished): start from the top.
      if (wasSemantic !== !!tree.semantic) stack = [{ key: "root" }];
    }
    let items = levelItems(levelKey());
    while (!items.length && stack.length > 1) {
      stack.pop();
      items = levelItems(levelKey());
    }
    // Opening the root of a single-folder project goes straight in.
    if (stack.length === 1 && items.length === 1 && items[0].open && !tree.semantic) {
      stack.push(items[0].open);
      items = levelItems(levelKey());
    }
    crumbs();
    $("up").disabled = stack.length < 2;
    if (pendingReveal) {
      const hit = items.find((c) => c.files.includes(pendingReveal));
      if (hit) selected = new Set([hit.key]);
      pendingReveal = null;
    }
    selected = new Set([...selected].filter((k) => items.some((c) => c.key === k)));
    $("insert").disabled = !sessionId || !selected.size || !modulesFor(filesOf(selected, items)).length;
    const analysis = analyze(items);
    const placed = layout(items, analysis.edges);
    view = { width: placed.width, height: placed.height };
    const query = $("search").value.trim().toLowerCase();
    const focus = selected.size ? selected : null;
    const linked = new Set();
    if (focus)
      analysis.edges.forEach((e) => {
        if (focus.has(e.from)) linked.add(e.to);
        if (focus.has(e.to)) linked.add(e.from);
      });
    for (const item of items) {
      const { x, y } = placed.coords.get(item.key);
      const stat = analysis.stats.get(item.key);
      const forecast = forecastFor(item.files);
      const match =
        query && (item.label.toLowerCase().includes(query) || item.files.some((f) => f.toLowerCase().includes(query)));
      const dim = focus && !focus.has(item.key) && !linked.has(item.key);
      const b = el(
        "button",
        undefined,
        `node ${item.kind}${selected.has(item.key) ? " selected" : ""}${forecast ? " " + forecast.category : ""}${dim ? " dim" : ""}${match ? " match" : ""}`,
      );
      b.style.left = `${x}px`;
      b.style.top = `${y}px`;
      b.dataset.key = item.key;
      if (item.path) b.dataset.path = item.path;
      b.setAttribute("aria-pressed", String(selected.has(item.key)));
      const title = el("span", undefined, "node-title");
      const icon = el("span", undefined, "icon");
      icon.innerHTML = ICONS[item.kind];
      title.append(icon, el("strong", item.label));
      if (item.open) title.append(el("span", "›", "chevron"));
      b.append(title);
      if (item.group?.description) b.append(el("span", item.group.description, "node-desc"));
      const meta = el("span", undefined, "node-meta");
      meta.append(el("span", item.kind === "file" ? languageLabel(item.path) : quantity(item.files.length, "files")));
      if (stat.in) meta.append(el("span", `← ${stat.in}`, "count in"));
      if (stat.out) meta.append(el("span", `→ ${stat.out}`, "count out"));
      const role = item.group ? (item.group.role ? `role.${item.group.role}` : null) : structuralRole(item, stat);
      if (role) meta.append(el("span", t(role), "tag role"));
      if (forecast) meta.append(el("span", t(forecast.category), "tag " + forecast.category));
      b.append(meta);
      b.title = item.open ? `${item.path || item.label}\n${t("dblHint")}` : item.path || item.label;
      b.onclick = (e) => {
        if (!e.shiftKey) selected = new Set([item.key]);
        else if (selected.has(item.key)) selected.delete(item.key);
        else selected.add(item.key);
        render();
      };
      b.ondblclick = () =>
        item.open ? enter(item.open) : item.kind === "file" && void showSource(item.path).catch(() => {});
      b.onkeydown = (e) => {
        if (e.key === "Enter" && item.open && selected.has(item.key)) {
          e.preventDefault();
          enter(item.open);
        }
      };
      nodes.append(b);
    }
    const ns = "http://www.w3.org/2000/svg";
    svg.setAttribute("width", String(view.width));
    svg.setAttribute("height", String(view.height));
    const defs = document.createElementNS(ns, "defs");
    for (const id of ["arrow", "arrow-active", "arrow-model"]) {
      const marker = document.createElementNS(ns, "marker");
      marker.id = id;
      marker.setAttribute("viewBox", "0 0 10 10");
      marker.setAttribute("refX", "8");
      marker.setAttribute("refY", "5");
      marker.setAttribute("markerUnits", "userSpaceOnUse");
      marker.setAttribute("markerWidth", "9");
      marker.setAttribute("markerHeight", "9");
      marker.setAttribute("orient", "auto-start-reverse");
      const triangle = document.createElementNS(ns, "path");
      triangle.setAttribute("d", "M 1 1 L 9 5 L 1 9 z");
      triangle.setAttribute("class", id);
      marker.append(triangle);
      defs.append(marker);
    }
    svg.append(defs);
    const maxCount = Math.max(1, ...analysis.edges.map((e) => e.count));
    for (const e of analysis.edges) {
      const a = placed.coords.get(e.from),
        b = placed.coords.get(e.to);
      const active = focus && (focus.has(e.from) || focus.has(e.to));
      const backward = placed.vertical ? b.y <= a.y : placed.back.has(`${e.from}\n${e.to}`) || b.x <= a.x;
      const p = document.createElementNS(ns, "path");
      let d;
      if (placed.vertical) {
        const sx = a.x + NODE_W / 2 + (backward ? 14 : 0),
          tx = b.x + NODE_W / 2 + (backward ? 14 : 0);
        if (a.y === b.y) {
          // Same row: arc above the cards.
          const lift = 36 + Math.abs(tx - sx) / 6;
          d = `M${sx},${a.y} C${sx},${a.y - lift} ${tx},${b.y - lift} ${tx},${b.y - 2}`;
        } else if (!backward) {
          const sy = a.y + NODE_H,
            ty = b.y - 2,
            k = Math.max(28, (ty - sy) / 2);
          d = `M${sx},${sy} C${sx},${sy + k} ${tx},${ty - k} ${tx},${ty}`;
        } else {
          const sy = a.y,
            ty = b.y + NODE_H + 2,
            k = Math.max(28, (sy - ty) / 2);
          d = `M${sx},${sy} C${sx},${sy - k} ${tx},${ty + k} ${tx},${ty}`;
        }
      } else if (!backward) {
        const sx = a.x + NODE_W,
          sy = a.y + NODE_H / 2,
          tx = b.x - 2,
          ty = b.y + NODE_H / 2,
          k = Math.max(40, (tx - sx) / 2);
        d = `M${sx},${sy} C${sx + k},${sy} ${tx - k},${ty} ${tx},${ty}`;
      } else if (b.x < a.x) {
        // A cycle back to an earlier column: leave from the left side and run below the forward edge.
        const sx = a.x - 2,
          sy = a.y + NODE_H / 2 + 12,
          tx = b.x + NODE_W + 2,
          ty = b.y + NODE_H / 2 + 12,
          k = Math.max(40, (sx - tx) / 2);
        d = `M${sx},${sy} C${sx - k},${sy + 24} ${tx + k},${ty + 24} ${tx},${ty}`;
      } else {
        // Same column: loop around the right side so it never runs through cards.
        const sx = a.x + NODE_W,
          sy = a.y + NODE_H / 2 + 8,
          tx = b.x + NODE_W + 2,
          ty = b.y + NODE_H / 2 - 8,
          bulge = 36 + Math.min(80, Math.abs(ty - sy) / 4);
        d = `M${sx},${sy} C${sx + bulge},${sy} ${tx + bulge},${ty} ${tx},${ty}`;
      }
      p.setAttribute("d", d);
      const onlyModel = e.model && !e.count;
      p.setAttribute("marker-end", `url(#${active ? "arrow-active" : onlyModel ? "arrow-model" : "arrow"})`);
      p.style.strokeWidth = onlyModel
        ? "1.5"
        : String(1 + Math.round((Math.log(e.count + 1) / Math.log(maxCount + 1)) * 2.5 * 10) / 10);
      p.setAttribute(
        "class",
        `${backward ? "back " : ""}${onlyModel ? "model " : ""}${active ? "active" : focus ? "dim" : ""}`,
      );
      const tip = document.createElementNS(ns, "title");
      const label = (k) => items.find((c) => c.key === k)?.label || k;
      tip.textContent = [
        `${label(e.from)} → ${label(e.to)}${e.count ? `: ${quantity(e.count, "imports")}` : ""}`,
        ...(e.reasons || []),
      ].join("\n");
      p.append(tip);
      svg.append(p);
    }
    if (!items.length) nodes.append(el("p", t("noResult"), "muted"));
    $("board").style.width = `${view.width}px`;
    $("board").style.height = `${view.height}px`;
    transform();
    details(items, analysis);
  }
  async function reload() {
    if (!projectPath) return;
    const request = ++reloadSequence;
    const revision = epoch,
      current = projectPath;
    const value = await call("state", { projectPath: current, sessionId });
    if (revision !== epoch || current !== projectPath || request !== reloadSequence) return;
    graph = value.graph;
    impact = value.impact;
    stale = value.stale;
    job = value.job;
    render();
  }
  async function bindSession(next) {
    epoch++;
    sourceEpoch++;
    sessionId = next;
    graph = null;
    impact = null;
    selected.clear();
    stack = [{ key: "root" }];
    tree = null;
    warning = "";
    job = null;
    stale = false;
    toolsAvailable = true;
    $("error").hidden = true;
    if ($("source").open) $("source").close();
    const revision = epoch;
    if (sessionId) {
      const current = await call("session", { sessionId });
      if (revision !== epoch) return;
      projectPath = current.projectPath;
      toolsAvailable = current.toolsAvailable;
      $("projects").hidden = true;
    } else {
      $("projects").hidden = false;
      projectPath = $("projects").value || null;
    }
    render();
    await reload();
    if (revision === epoch && stale && !job) await start();
    fit();
  }
  async function start(rethink = false) {
    if (!projectPath) return;
    $("error").hidden = true;
    warning = "";
    agentLine = "";
    job = await call("startIndex", { projectPath, rethink });
    render();
  }
  $("refresh").onclick = $("build").onclick = () => void start().catch(() => {});
  $("rethink").onclick = () => void start(true).catch(() => {});
  $("expand").onclick = async () => {
    try {
      await call("setFocus", { projectPath, stack, selected: [...selected] });
      await call("__koda.openWorkspace", { workspaceId: WORKSPACE });
    } catch {
      // the error is already shown
    }
  };
  /** The full-screen workspace picks up the project and level the pane handed over. */
  async function takeFocus() {
    if (inPane) return;
    const focus = await call("takeFocus");
    if (!focus?.projectPath) return;
    if ($("projects").value !== focus.projectPath) {
      $("projects").value = focus.projectPath;
      projectPath = focus.projectPath;
      epoch++;
      graph = null;
      impact = null;
      job = null;
      stale = false;
      tree = null;
      await reload();
    }
    stack = Array.isArray(focus.stack) && focus.stack.length ? focus.stack : [{ key: "root" }];
    selected = new Set(Array.isArray(focus.selected) ? focus.selected : []);
    render();
    fit();
  }
  $("cancel").onclick = () => job && void call("cancelIndex", { id: job.id }).catch(() => {});
  $("search").oninput = () => render();
  $("up").onclick = () => {
    if (stack.length < 2) return;
    const leaving = stack[stack.length - 1].key;
    go(stack.slice(0, -1), leaving.startsWith("g:") ? leaving : null);
  };
  document.addEventListener("keydown", (e) => {
    if (e.key === "Backspace" && !$("up").disabled && !e.target.closest("input,select,textarea,dialog")) {
      e.preventDefault();
      $("up").click();
    }
  });
  $("fit").onclick = fit;
  $("zoomIn").onclick = () => {
    scale = Math.min(2, scale * 1.2);
    transform();
  };
  $("zoomOut").onclick = () => {
    scale = Math.max(0.15, scale / 1.2);
    transform();
  };
  $("insert").onclick = () =>
    void call("insert", {
      sessionId,
      moduleIds: modulesFor(filesOf(selected, levelItems(levelKey()))).slice(0, 20),
    }).catch(() => {});
  $("projects").onchange = () => {
    projectPath = $("projects").value;
    epoch++;
    selected.clear();
    stack = [{ key: "root" }];
    tree = null;
    warning = "";
    graph = null;
    impact = null;
    job = null;
    stale = false;
    render();
    void reload()
      .then(fit)
      .catch(() => {});
  };
  $("closeSource").onclick = () => {
    $("source").close();
    sourceEpoch++;
  };
  let drag = null;
  $("viewport").onpointerdown = (e) => {
    if (e.target.closest("button")) return;
    drag = { x: e.clientX - pan.x, y: e.clientY - pan.y, startX: e.clientX, startY: e.clientY };
    $("viewport").setPointerCapture(e.pointerId);
  };
  $("viewport").onpointermove = (e) => {
    if (drag) {
      pan = { x: e.clientX - drag.x, y: e.clientY - drag.y };
      transform();
    }
  };
  $("viewport").onpointerup = (e) => {
    // A click on the empty canvas (not a pan) clears the selection.
    if (drag && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 4 && selected.size) {
      selected.clear();
      render();
    }
    drag = null;
  };
  $("viewport").onpointercancel = () => {
    drag = null;
  };
  $("viewport").addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const box = $("viewport").getBoundingClientRect(),
        x = e.clientX - box.left,
        y = e.clientY - box.top,
        old = scale;
      scale = Math.max(0.15, Math.min(2, scale * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
      pan = { x: x - ((x - pan.x) * scale) / old, y: y - ((y - pan.y) * scale) / old };
      transform();
    },
    { passive: false },
  );
  bridge.subscribe((event, data) => {
    if (event === "theme") document.documentElement.dataset.theme = data;
    if (event === "language") {
      language = data === "ru" ? "ru" : "en";
      render();
    }
    if (event === "session") void bindSession(data).catch(() => {});
    if (event === "focus") void takeFocus().catch(() => {});
    if (event === "agent.progress" && job && data.runId === job.runId) {
      agentLine = data.text;
      render();
    }
    if (event === "progress" && data.projectPath === projectPath) {
      job = data;
      if (data.status === "complete" && data.warning) warning = data.warning;
      if (data.status === "error") error(data.error);
      if (["complete", "cancelled", "error"].includes(data.status))
        void reload()
          .then(() => {
            if (data.status === "complete") fit();
          })
          .catch(() => {});
      else render();
    }
    if (
      (event === "map" || event === "impact") &&
      data.projectPath === projectPath &&
      (event !== "impact" || data.sessionId === sessionId)
    )
      void reload().catch(() => {});
  });
  document.documentElement.dataset.theme = info.theme;
  const projects = await call("projects");
  projects.forEach((p) => {
    const o = el("option", p.name);
    o.value = p.path;
    $("projects").append(o);
  });
  await bindSession(sessionId);
  await takeFocus().catch(() => {});
  window.addEventListener("focus", () => void reload().catch(() => {}));
  // The pane is resized with the chat: re-place the cards (orientation may flip) and fit again.
  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      render();
      fit();
    }, 120);
  });
  setInterval(() => {
    if (!document.hidden && !busyJob()) void reload().catch(() => {});
  }, 30000);
})().catch((e) => {
  document.getElementById("error").hidden = false;
  document.getElementById("error").textContent = String(e);
});
