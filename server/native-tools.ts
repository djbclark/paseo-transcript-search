import { defineAgentTool, type PluginServerContext } from "@getpaseo/plugin/server";
import { z } from "zod";
import { buildCensus } from "./census";
import { runSearch } from "./search";
import { MAX_SEARCH_AGENTS } from "../shared/contracts";
import { registerAgentTools } from "./agent-tools";
export function contributeAgentTools(server: PluginServerContext) {
  return registerAgentTools(server, [defineAgentTool({
    name: "transcript_search_conversations", description: "Search active and archived conversation transcripts on this host. Defaults to this workspace; choose project or host only when broader history is needed. Returns bounded matching snippets. Never restores or starts agents.",
    input: z.object({ query: z.string().min(1).max(500), scope: z.enum(["workspace", "project", "host"]).default("workspace"), limit: z.number().int().min(1).max(50).default(10) }).strict(),
    async execute({ query, scope, limit }, { agent, signal }) {
      if (signal.aborted) throw new Error("Tool call cancelled.");
      const census = await buildCensus();
      const workspace = census.workspaces.find(w => w.workspaceId === agent.workspaceId);
      const allowed = new Set(census.workspaces.filter(w => scope === "host" || scope === "project" && workspace?.projectId != null && w.projectId === workspace.projectId || scope === "workspace" && w.workspaceId === agent.workspaceId).map(w => w.workspaceId));
      const selected = census.agents.filter(a => a.transcript.searchable && (scope === "host" || a.workspaceId != null && allowed.has(a.workspaceId)));
      const matches = [];
      let searchedAgents = 0, truncated = false;
      for (let offset = 0; offset < selected.length; offset += MAX_SEARCH_AGENTS) {
        if (signal.aborted) throw new Error("Tool call cancelled.");
        const result = await runSearch({ query, mode: "regex", regex: false, caseSensitive: false, agentIds: selected.slice(offset, offset + MAX_SEARCH_AGENTS).map(a => a.id), perAgentLimit: 3 }, signal);
        if (result.error) return { text: result.error.message, isError: true };
        searchedAgents += result.searchedAgents;
        matches.push(...result.matches);
        truncated ||= result.outputTruncated;
        if (matches.length >= limit) { truncated ||= matches.length > limit || offset + MAX_SEARCH_AGENTS < selected.length; break; }
      }
      const result = { matches: matches.slice(0, limit), searchedAgents, selectedAgents: selected.length, outputTruncated: truncated, scope };
      return { text: JSON.stringify(result), structuredContent: result };
    },
  })], true);
}
