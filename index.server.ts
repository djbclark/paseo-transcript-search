import { contributeAgentTools } from "./server/native-tools";
import { displayPreferences } from "./shared/display";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { paseoHome } from "./server/paseo-home";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { buildCensus, clearCensusCaches, setHideHelperAgents } from "./server/census";
import { getIndexStatus, stopIndexer } from "./server/indexer";
import { abortAllSearches, runSearch } from "./server/search";
import { clearTranscriptCaches } from "./server/transcripts";
import { hostIdentity, indexStatus, listHistory, restoreAgent, searchHistory } from "./shared/contracts";
import { restoreArchivedAgent } from "./server/restore-agent";

export default function contribute(server: PluginServerContext) {
  const removeTools = contributeAgentTools(server);
  const settings = server.registerSettings(displayPreferences);
  const applySettings = (state: Awaited<ReturnType<typeof settings.read>>) => {
    if (state.status === "ready") setHideHelperAgents(state.values.hideHelperAgents);
  };
  void settings.read().then(applySettings, () => undefined);
  const removeSettingsListener = settings.subscribe(applySettings);
  server.handle(hostIdentity, async () => ({
    serverId: process.env.PASEO_SERVER_ID?.trim() || (await readFile(join(paseoHome(), "server-id"), "utf8")).trim(),
    protocol: 1 as const,
  }));
  server.handle(restoreAgent, async ({ agentId }, { paseo }) => {
    await restoreArchivedAgent(agentId, paseo);
    return { agentId };
  });
  server.handle(listHistory, async () => {
    const census = await buildCensus();
    // Literal search needs no index. Ranked search requests its own sync on demand.
    return census;
  });
  server.handle(searchHistory, (input) => runSearch(input));
  server.handle(indexStatus, () => getIndexStatus());
  return async () => {
    removeTools();
    removeSettingsListener();
    abortAllSearches();
    await stopIndexer();
    clearCensusCaches();
    clearTranscriptCaches();
  };
}
