# OpenCodex Stats (Herdr plugin)

Herdr marketplace plugin that shows **OpenCodex (`ocx`) usage stats** while you work: tokens, estimated list-price cost, and recent request durations.

This is a **Herdr plugin** (`herdr-plugin.toml`), not the Herdr agent skill. Install it into Herdr; it talks to your local `ocx` CLI / proxy.

## Install

From GitHub (preferred):

```bash
herdr plugin install nordz0r/herdr-opencodex --yes
herdr plugin list
```

Local development — use a **real checkout path**, not a placeholder:

```bash
git clone https://github.com/nordz0r/herdr-opencodex.git
cd herdr-opencodex
herdr plugin link "$(pwd)"
herdr plugin action invoke nordz0r.ocx-stats.show-stats
herdr plugin pane open --plugin nordz0r.ocx-stats --entrypoint stats
```

If you already have a clone elsewhere, point `herdr plugin link` at that directory (the one that contains `herdr-plugin.toml`).

Requires: Node.js on `PATH`. Local `ocx` is **optional** when you set a remote server in plugin config.

## Plugin config

Config lives under Herdr’s plugin config dir (not in the repo):

```bash
herdr plugin config-dir nordz0r.ocx-stats
# → …/herdr/plugins/config/nordz0r.ocx-stats
```

Create `config.json` there (see `config.example.json`):

```json
{
  "baseUrl": "https://ocx.example.com",
  "apiKey": "ocx_admin_… or data-plane key",
  "range": "1d",
  "logLimit": 8
}
```

- `baseUrl` — remote OpenCodex origin (no trailing slash needed)
- `apiKey` — sent as `X-OpenCodex-API-Key` and `Authorization: Bearer …`. An **admin** token unlocks Management `GET /api/usage` and `GET /api/logs`. A **data-plane** `ocx_data_*` key falls back to client-scoped `GET /v1/usage` (usage works; request logs stay empty without admin).
- If `baseUrl` + `apiKey` are set, the plugin talks HTTP and does **not** need a local `ocx` binary.
- If they are absent, it falls back to `ocx usage --json` / `ocx logs` on `PATH`.

Never commit real keys. The plugin never prints the key.

## What it shows

| Metric | Source | Notes |
|--------|--------|-------|
| Tokens in / out / total | `ocx usage --json` | Aggregates by range |
| Estimated cost (USD) | same | **List-price estimate** from display pricing — not a provider invoice |
| Coverage | same | Usage coverage ratio when present |
| Recent durations | `ocx logs --json` (optional) | Last N requests when available |

**Not in v0.1:** tool-call counts as a first-class metric (not stable in ocx usage aggregates), always-on statusline, scraping agent pane text.

## Commands

`bin/ocx-stats.mjs`:

- `doctor` — check `ocx` on PATH + `ocx health`; write `HERDR_PLUGIN_STATE_DIR/doctor.json`
- `show` — one-shot formatted snapshot (action)
- `watch` — refresh loop for the stats pane

State goes under `HERDR_PLUGIN_STATE_DIR` (e.g. `last-usage.json`). Optional config under `HERDR_PLUGIN_CONFIG_DIR` — never store secrets in the plugin root.

## Marketplace

Add the GitHub topic `herdr-plugin` on this public repo so it appears in the Herdr marketplace index.

## Trust

Plugins run as your user with full shell and Herdr CLI access. Review `herdr-plugin.toml` and `bin/ocx-stats.mjs` before install.

## Roadmap

1. Popup + action (this scaffold)
2. Split/tab dashboard beside the agent pane
3. Optional threshold notifications via `herdr notification show`
