# OpenCodex Stats (Herdr plugin)

Herdr marketplace plugin that shows **OpenCodex (`ocx`) usage stats** while you work: tokens, estimated list-price cost, and recent request durations.

This is a **Herdr plugin** (`herdr-plugin.toml`), not the Herdr agent skill. Install it into Herdr; it talks to your local `ocx` CLI / proxy.

## Install

```bash
herdr plugin install nordz0r/herdr-opencodex
```

Local development:

```bash
herdr plugin link /path/to/herdr-opencodex
herdr plugin action invoke nordz0r.ocx-stats.show-stats
herdr plugin pane open --plugin nordz0r.ocx-stats --entrypoint stats
```

Requires: Node.js on `PATH`, and a working `ocx` install (proxy healthy for live numbers).

## What it shows

| Metric | Source | Notes |
|--------|--------|--------|
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
