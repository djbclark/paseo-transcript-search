# paseo-transcript-search

[![npm version](https://img.shields.io/npm/v/paseo-transcript-search?style=for-the-badge&color=cb3837)](https://www.npmjs.com/package/paseo-transcript-search)
[![npm downloads](https://img.shields.io/npm/dm/paseo-transcript-search?style=for-the-badge&color=cb3837)](https://www.npmjs.com/package/paseo-transcript-search)
[![Paseo](https://img.shields.io/badge/Paseo-%E2%89%A5%200.14.0-8A63D2?style=for-the-badge)](https://paseo.sh)
[![License](https://img.shields.io/github/license/tomgrin10/paseo-transcript-search?style=for-the-badge&color=2563eb)](LICENSE)

Find something said in a previous Paseo session, across all your connected hosts.

![Transcript Search showing matching conversations from two connected hosts](docs/screenshots/transcript-search.png)

Example with synthetic sessions on a laptop and build server.

## Install

Requires [Paseo](https://paseo.sh) **0.14.0 or newer** on the daemon and connected app. Enable plugins in **Settings → Plugins**, then run on each host you want to search:

```sh
paseo plugin install paseo-transcript-search
```

Update with `paseo plugin update transcript-search`. Keep the same installation ID on every host.

## Use

- Open **Transcript Search** from the sidebar, or press **⌘K / Ctrl+K**, choose **Search all session transcripts**, and start typing.
- Search active and archived sessions, including Claude subagents and archived Codex conversations.
- Narrow results by project, provider, labels, date, or archive status. Literal, case-insensitive search is the default; regex, case sensitivity, and relevance ranking are optional.
- Open a matching session on its original host. Archived sessions ask for confirmation before restoration.

Open a workspace or plugin on a host first to make its Command Center actions available.

### Multiple hosts

Configure your hosts in Paseo and install this plugin on each. One search queries all online hosts in parallel and labels results with their source. No extra plugin connection setup is needed.

Disconnected hosts, missing plugin installations, and failed searches are named in the screen. Results from healthy hosts stay available; **Refresh** retries failed requests. Copied session and project IDs remain separate between hosts.

### Sidebar visibility

In **Settings → Plugins → Transcript Search → Display**, turn **Show in sidebar** off to hide its menu entry. Keyboard access stays available. The host saves this preference across reloads and updates; other connected clients apply changes within five seconds.

## Data and access

Paseo plugins run trusted, unsandboxed code on the daemon host. This plugin reads session records under `$PASEO_HOME` (`~/.paseo` by default) and provider transcripts from their configured directories. It uses the authenticated Paseo connections already open in your app.

Transcripts stay on their originating hosts; search returns matching snippets to connected clients. Provider persistence credentials are excluded from history responses. Missing transcript files do not stop other sessions from being searched, and searches cover all selected sessions in bounded batches. Timeout and output-limit notices identify incomplete results.

Literal and regex searches use the host's `grep`. Windows hosts need a compatible `grep`, such as the copy included with Git for Windows. Optional ranked search uses built-in SQLite FTS5 and falls back to grep when the index is unavailable. Each host owns its index; when hosts use different search engines, results retain chronological grouping.

## Development

```sh
git clone https://github.com/tomgrin10/paseo-transcript-search.git
cd paseo-transcript-search
npm ci
npm run verify
paseo plugin install "$PWD" --id transcript-search
```

After changes, run `npm run verify` and `paseo plugin reload transcript-search`. Reloading the plugin is enough; keep the daemon running.

## License

[MIT](LICENSE). Adapted from [panrafal's agents-history](https://github.com/panrafal/paseo-plugins/tree/004c6a80c6aa8e76bb563694c3eee5c2c0b0466f/agents-history), pinned at `004c6a80c6aa8e76bb563694c3eee5c2c0b0466f`. The original attribution is preserved in the license.

## Navigation and display

Open this plugin from Command-K or its sidebar entry. **Overview** and **Display settings** link the main view and settings directly, without opening the Plugins settings page. Hiding a sidebar entry keeps Command-K available.

## Paseo 0.14 agent integration

`transcript_search_conversations` searches the calling workspace by default, with explicit project or host scope when needed. It searches more than 2,000 sessions in bounded batches, caps results and cancels ongoing scans with the tool call.

Requires Paseo **0.14.0 or newer**. Agent tools are scoped to interactive Claude
and Codex sessions; history-only opens receive none. They become available on
the next idle session open after install or reload. The agent label
`plugin-tools/enabled: "false"` opts a session out. Existing plugin data and
settings are retained.

## Other plugins

- [Defer](https://github.com/tomgrin10/paseo-defer) — Schedule messages for later delivery.
- [Graphite](https://github.com/tomgrin10/paseo-graphite) — Graphite stacks and PR status.
- [Smart Session](https://github.com/tomgrin10/paseo-smart-session) — Context compaction and usage insights.
- [Vitals](https://github.com/tomgrin10/paseo-vitals) — Host, agent, and Docker health.
- [Session Guard](https://github.com/tomgrin10/paseo-session-guard) — Pause at session limits and continue after reset.
- [Transfer](https://github.com/tomgrin10/paseo-transfer) — Copy or move workspaces between hosts.
- [Send to Paseo](https://github.com/tomgrin10/send-to-paseo) — Send GitHub and Graphite PRs to Paseo from Chrome.
- [Dispatch](https://github.com/tomgrin10/paseo-dispatch) — Route tasks to existing workspaces (development preview).

- [Follow-up](https://github.com/tomgrin10/paseo-follow-up) — Track workspace PRs, remaining tasks and completion.
