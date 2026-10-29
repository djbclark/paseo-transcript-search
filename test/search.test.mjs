import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
async function load(entry) {
  const built = await build({ entryPoints: [entry], bundle: true, write: false, platform: "node", format: "cjs", external: ["@getpaseo/plugin", "zod"] });
  const module = { exports: {} };
  new Function("require", "module", "exports", built.outputFiles[0].text)(require, module, module.exports);
  return module.exports;
}

test("literal and regex searches find active, archived, Codex, and Claude subagent transcripts", async () => {
  const root = await mkdtemp(join(tmpdir(), "paseo-search-test-"));
  const previous = Object.fromEntries(["PASEO_HOME", "CLAUDE_CONFIG_DIR", "CODEX_HOME"].map((key) => [key, process.env[key]]));
  process.env.PASEO_HOME = join(root, "paseo");
  process.env.CLAUDE_CONFIG_DIR = join(root, "claude");
  process.env.CODEX_HOME = join(root, "codex");
  const json = async (file, value) => { await mkdir(join(file, ".."), { recursive: true }); await writeFile(file, JSON.stringify(value)); };
  const line = async (file, value) => { await mkdir(join(file, ".."), { recursive: true }); await writeFile(file, JSON.stringify(value) + "\n"); };
  let cleanup;
  try {
    const ids = ["active", "archived", "codex", "missing"];
    for (const id of ids) await json(join(process.env.PASEO_HOME, "agents", "bucket", `${id}.json`), {
      id, provider: id === "codex" ? "codex" : "claude", cwd: "/fixture", workspaceId: "workspace-1",
      title: id, createdAt: "2026-10-01T00:00:00Z", lastStatus: "idle",
      ...(id === "archived" ? { archivedAt: "2026-10-02T00:00:00Z" } : {}),
      persistence: { sessionId: id, metadata: { credential: "MUST-NOT-RETURN" } },
    });
    await json(join(process.env.PASEO_HOME, "agents", "bucket", "no-session.json"), { id: "no-session", provider: "claude", cwd: "/fixture", createdAt: "2026-10-01T00:00:00Z", persistence: null });
    await json(join(process.env.PASEO_HOME, "projects", "projects.json"), []);
    await json(join(process.env.PASEO_HOME, "projects", "workspaces.json"), [{ workspaceId: "workspace-1", cwd: "/fixture" }]);
    const project = join(process.env.CLAUDE_CONFIG_DIR, "projects", "-fixture");
    await line(join(project, "active.jsonl"), { type: "user", message: { role: "user", content: "literal a.b UNIQUE NEEDLE" } });
    await line(join(project, "archived.jsonl"), { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "unique needle in old session" }] } });
    await line(join(project, "active", "subagents", "agent-worker.jsonl"), { type: "assistant", message: { role: "assistant", content: "subagent-only needle" } });
    await line(join(process.env.CODEX_HOME, "archived_sessions", "rollout-2026-10-01T00-00-00-codex.jsonl"), { type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "unique needle in Codex" }] } });

    const handlers = new Map();
    const server = await load("index.server.ts");
    cleanup = server.default({ before() { return () => {}; }, registerSettings() {}, handle(contract, callback) { handlers.set(contract.name, { contract, callback }); } });
    const invoke = async (name, input) => {
      const { contract, callback } = handlers.get(name);
      return contract.output.parse(await callback(contract.input.parse(input), {}));
    };
    const census = await invoke("agents-history.list", {});
    assert.equal(census.agents.length, 5);
    assert.equal(census.agents.find((agent) => agent.id === "no-session").transcript.reason, "no-session");
    assert.equal(census.agents.filter((agent) => agent.transcript.searchable).length, 3);
    assert.equal(census.agents.find((agent) => agent.id === "active").transcript.fileCount, 2);
    assert.ok(!JSON.stringify(census).includes("MUST-NOT-RETURN"));
    const input = { agentIds: ids, query: "unique needle", mode: "regex" };
    const literal = await invoke("agents-history.search", input);
    assert.equal(literal.error, undefined);
    assert.deepEqual(literal.matches.map((match) => match.agentId).sort(), ["active", "archived", "codex"]);
    assert.deepEqual(literal.unsearchableAgents, ["missing"]);
    const sensitive = await invoke("agents-history.search", { ...input, caseSensitive: true });
    assert.deepEqual(sensitive.matches.map((match) => match.agentId).sort(), ["archived", "codex"]);
    const punctuation = await invoke("agents-history.search", { ...input, query: "a.b" });
    assert.deepEqual(punctuation.matches.map((match) => match.agentId), ["active"]);
    const subagent = await invoke("agents-history.search", { ...input, query: "subagent-only" });
    assert.equal(subagent.matches[0].snippets[0].file, "subagent");
    const regex = await invoke("agents-history.search", { ...input, query: "unique.*Codex", regex: true });
    assert.deepEqual(regex.matches.map((match) => match.agentId), ["codex"]);
    const invalid = await invoke("agents-history.search", { ...input, query: "[", regex: true });
    assert.equal(invalid.error.code, "invalid-regex");
  } finally {
    await cleanup?.();
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await rm(root, { recursive: true, force: true });
  }
});

test("more than 2,000 sessions are searched in bounded batches", async () => {
  const { searchAll } = await load("shared/search-all.ts");
  const ids = Array.from({ length: 4001 }, (_, index) => `session-${index}`);
  const batches = [];
  const result = await searchAll(async (input) => {
    batches.push(input.agentIds);
    return { matches: [], searchedAgents: input.agentIds.length, unsearchableAgents: [], durationMs: 1, outputTruncated: false };
  }, { query: "needle", mode: "regex", regex: false, caseSensitive: false, agentIds: ids, perAgentLimit: 3 });
  assert.deepEqual(batches.map((batch) => batch.length), [2000, 2000, 1]);
  assert.deepEqual(batches.flat(), ids);
  assert.equal(result.searchedAgents, 4001);
});

test("cancelled searches do not continue scanning subsequent batches", async () => {
  const { searchAll } = await load("shared/search-all.ts");
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(searchAll(async () => {
    calls += 1; controller.abort();
    return { matches: [], searchedAgents: 2000, unsearchableAgents: [], durationMs: 1, outputTruncated: false };
  }, { query: "needle", mode: "regex", regex: false, caseSensitive: false, agentIds: Array(4001).fill("id"), perAgentLimit: 3 }, controller.signal), /cancelled/);
  assert.equal(calls, 1);
});

test("hiding is reversible, registrations do not duplicate, and late reads cannot undo cleanup", async () => {
  const { sidebarVisibility } = await load("client/sidebar-visibility.ts");
  let registered = 0, removed = 0;
  const sidebar = sidebarVisibility(() => { registered += 1; return () => { removed += 1; }; });
  sidebar.set(false);
  assert.equal(registered, 0);
  sidebar.set(true); sidebar.set(true);
  assert.equal(registered, 1);
  sidebar.set(false); sidebar.set(false);
  assert.equal(removed, 1);
  sidebar.set(true);
  assert.equal(registered, 2);
  sidebar.dispose(); sidebar.dispose(); sidebar.set(true);
  assert.equal(registered, 2);
  assert.equal(removed, 2);
});

test("sidebar routes exist at installation mount and an old read cannot undo a saved toggle", async () => {
  const externals = ["@getpaseo/plugin", "@getpaseo/plugin/client", "@getpaseo/plugin/client/ui", "@getpaseo/plugin/client/react-native", "@tanstack/react-query", "react", "react/jsx-runtime", "react-native", "zod"];
  const built = await build({ entryPoints: ["index.client.tsx"], bundle: true, write: false, platform: "node", format: "cjs", external: externals });
  let resolveRead;
  const pending = new Promise((resolve) => { resolveRead = resolve; });
  const modules = {
    "@getpaseo/plugin": require("@getpaseo/plugin"),
    zod: require("zod"),
    react: { memo: (component) => component, useEffect(effect) { effect(); } },
    "react/jsx-runtime": { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    "react-native": { StyleSheet: { create: (styles) => styles } },
    "@tanstack/react-query": {},
    "@getpaseo/plugin/client": { useSettings: () => ({ status: "ready", values: { showSidebar: false }, revision: "new", saving: false }) },
    "@getpaseo/plugin/client/ui": {},
    "@getpaseo/plugin/client/react-native": {},
  };
  const module = { exports: {} };
  new Function("require", "module", "exports", built.outputFiles[0].text)((id) => {
    if (!(id in modules)) throw new Error(`Unexpected client dependency: ${id}`);
    return modules[id];
  }, module, module.exports);
  let added = 0, removed = 0, screen;
  const commands = [];
  const cleanup = module.exports.default({
    addSurface() { return () => {}; },
    addSidebarItem() { added += 1; return () => { removed += 1; }; },
    addSettingsScreen(value) { screen = value; return () => {}; },
    addCommandCenterItem(value) { commands.push(value); return () => {}; },
    rpc(contract) { return contract.name === "transcript-search.host-identity" ? Promise.resolve({ serverId: "fixture-ui", protocol: 1 }) : pending; },
  });
  try {
    assert.equal(added, 1, "the host must see the sidebar route before its first render");
    const view = screen.Component({ theme: { colors: {} } });
    const settings = view.props.children[1];
    settings.type(settings.props);
    assert.equal(removed, 1, "a saved hidden preference removes the sidebar immediately");
    resolveRead({ status: "ready", revision: "old", values: { showSidebar: true } });
    await Promise.resolve(); await Promise.resolve();
    assert.equal(added, 1, "an older in-flight read must not re-register the hidden sidebar");
    let opened;
    commands.find((command) => command.id === "search-transcripts").onSelect({ openSurface(id) { opened = id; } });
    assert.equal(opened, "transcript-search", "the direct surface command remains usable while hidden");
  } finally { cleanup(); }
});
