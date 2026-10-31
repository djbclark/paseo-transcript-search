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

test("helper agents are hidden by default and shown again when the setting is off", async () => {
  const root = await mkdtemp(join(tmpdir(), "paseo-helper-test-"));
  const previous = process.env.PASEO_HOME;
  process.env.PASEO_HOME = join(root, "paseo");
  const agent = async (id, extra) => {
    const dir = join(process.env.PASEO_HOME, "agents", "bucket");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${id}.json`), JSON.stringify({ id, provider: "claude", cwd: "/fixture", createdAt: "2026-10-01T00:00:00Z", ...extra }));
  };
  try {
    await agent("real", { title: "Real work" });
    await agent("herald", { title: "Herald summary", labels: { "herald.role": "summarizer", "paseo.parent-agent-id": "real" } });
    await agent("other-role", { title: "Other", labels: { "herald.role": "reviewer" } });
    await agent("internal", { internal: true });
    const census = await load("server/census.ts");
    const ids = async () => (await census.loadAgentRecords()).map((record) => record.id).sort();
    assert.deepEqual(await ids(), ["other-role", "real"]);
    census.setHideHelperAgents(false);
    assert.deepEqual(await ids(), ["herald", "other-role", "real"]);
    census.setHideHelperAgents(true);
    assert.deepEqual(await ids(), ["other-role", "real"]);
  } finally {
    if (previous === undefined) delete process.env.PASEO_HOME; else process.env.PASEO_HOME = previous;
    await rm(root, { recursive: true, force: true });
  }
});
