import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
async function tools(stubs = {}, read) {
  const bundle = await build({ entryPoints: ["server/native-tools.ts"], bundle: true, write: false, platform: "node", format: "cjs", packages: "external", plugins: [{ name: "fixture-services", setup(build) { build.onResolve({ filter: /^\./ }, args => Object.hasOwn(stubs, args.path) ? { path: "fixture:" + args.path, external: true } : undefined); } }] });
  const module = { exports: {} };
  new Function("require", "module", "exports", bundle.outputFiles[0].text)(id => id.startsWith("fixture:") ? stubs[id.slice(8)] : require(id), module, module.exports);
  let open;
  module.exports.contributeAgentTools({ before(name, handler) { assert.equal(name, "agent.session_open"); open = handler; return () => {}; } }, read);
  const request = { purpose: "interactive", provider: "claude", labels: {}, workspaceId: "w1", tools: [] };
  return { definitions: open({ request }).tools, module: module.exports };
}
const context = () => ({ agent: { id: "caller", workspaceId: "w1", provider: "claude", cwd: "/fixture", title: "Fixture" }, paseo: {}, signal: new AbortController().signal });
async function call(tool, input, ctx = context()) { return tool.execute(tool.input.parse(input), ctx); }
test("conversation search defaults to the caller workspace and explicitly expands scope", async () => {
  const requests = [];
  const census = { workspaces: [{ workspaceId: "w1", projectId: "p1" }, { workspaceId: "w2", projectId: "p1" }, { workspaceId: "w3", projectId: "p2" }], agents: [{ id: "own", workspaceId: "w1", transcript: { searchable: true } }, { id: "project", workspaceId: "w2", transcript: { searchable: true } }, { id: "foreign", workspaceId: "w3", transcript: { searchable: true } }] };
  const { definitions } = await tools({ "./census": { buildCensus: async () => census }, "./search": { runSearch: async input => { requests.push(input); return { matches: [], searchedAgents: input.agentIds.length, outputTruncated: false }; } } });
  await call(definitions[0], { query: "needle" }); assert.deepEqual(requests.at(-1).agentIds, ["own"]);
  await call(definitions[0], { query: "needle", scope: "project" }); assert.deepEqual(requests.at(-1).agentIds, ["own", "project"]);
  await call(definitions[0], { query: "needle", scope: "host" }); assert.equal(requests.at(-1).agentIds.length, 3);
  census.agents = Array.from({ length: 2001 }, (_, i) => ({ id: String(i), workspaceId: "w1", transcript: { searchable: true } })); requests.length = 0;
  const result = await call(definitions[0], { query: "needle" }); assert.equal(requests.length, 2); assert.equal(result.structuredContent.searchedAgents, 2001);
});
