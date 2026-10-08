# herdr-opencodex

Herdr plugins for [OpenCodex](https://github.com/lidge-jun/opencodex) (`ocx`):

| Plugin | Install | What it shows |
| --- | --- | --- |
| `nordz0r.ocx-stats` | `herdr plugin install nordz0r/herdr-opencodex --yes` | Popup spend: tokens in/out, list-price USD, optional request logs |
| `nordz0r.agent-quota` | `herdr plugin install nordz0r/herdr-opencodex/herdr-agent-quota --yes` | Agents sidebar: model, context, remaining 5h/7d (including remote hub remaining for omp API-key panes) |

This is a **Herdr plugin** repo (`herdr-plugin.toml` at the root and in `herdr-agent-quota/`), not an omp skill. Plugins run as your user; review the manifests before install.

## Marketplace

Public repo + GitHub topic `herdr-plugin`. The [Herdr marketplace](https://herdr.dev/plugins/) indexes default-branch manifests every 30 minutes. Install by GitHub path:

```bash
herdr plugin install nordz0r/herdr-opencodex --yes
herdr plugin install nordz0r/herdr-opencodex/herdr-agent-quota --yes
herdr plugin list
```

Local development:

```bash
git clone https://github.com/nordz0r/herdr-opencodex.git
cd herdr-opencodex
herdr plugin link "$(pwd)"
herdr plugin link "$(pwd)/herdr-agent-quota"
```

Requires Node.js on `PATH` for stats. Quota plugin needs the Rust toolchain in `herdr-agent-quota/rust-toolchain.toml` (Herdr runs `cargo build --release` on GitHub install).

## OpenCodex Stats (`nordz0r.ocx-stats`)

Config lives under Herdr’s plugin config dir (not in the repo):

```bash
herdr plugin config-dir nordz0r.ocx-stats
```

Create `config.json` there (see `config.example.json`):

```json
{
  "baseUrl": "https://ocx.example.com",
  "apiKey": "ocx_data_… or admin token",
  "range": "1d",
  "logLimit": 8
}
```

- `baseUrl` — remote OpenCodex origin (no trailing slash needed).
- `apiKey` — sent as `X-OpenCodex-API-Key` and `Authorization: Bearer …`. A **data-plane** `ocx_data_*` key is enough for `GET /v1/usage` (tokens). Request logs need a management/admin key on `GET /api/logs`.
- If `baseUrl` + `apiKey` are set, the plugin talks HTTP and does **not** need a local `ocx` binary.
- If they are absent, it falls back to `ocx usage --json` / `ocx logs` on `PATH`.

Never commit real keys. The plugin never prints the key.

| Metric | Source | Notes |
| --- | --- | --- |
| Tokens in / out / total | `GET /v1/usage` or `ocx usage --json` | Aggregates by range |
| Estimated cost (USD) | same | **List-price estimate** — not a provider invoice |
| Recent durations | `GET /api/logs` (optional) | Empty without a management key |

`bin/ocx-stats.mjs`: `doctor`, `show`, `watch`. State under `HERDR_PLUGIN_STATE_DIR`.

## Agent Quota with hub remaining (`nordz0r.agent-quota`)

Based on [levi-qiao/herdr-agent-quota](https://github.com/levi-qiao/herdr-agent-quota) (MIT). Extra collector: when `omp usage --json` is empty for an OCX API-key pane, remaining 5h/7d is read from hub management `GET /api/provider-quotas`.

That endpoint rejects data-plane keys (401). Put the hub **admin** token in `~/.opencodex/hub-admin-api-token` (mode 0600) and point the plugin at it:

On Windows the plugin builds with `cargo` (`platforms` includes `windows`). Herdr's config is `%APPDATA%\herdr\config.toml`, not `~/.config/herdr`. A machine connected to a hub as a client has its own `~/.opencodex/admin-api-token`; that token is not the hub admin token and `GET /api/provider-quotas` rejects it. Use the token from the hub host.

```bash
CFG="$(herdr plugin config-dir nordz0r.agent-quota)"
printf '%s\n' 'https://ocx.goldfinches.ru' > "$CFG/ocx-hub-url"
printf '%s\n' "$HOME/.opencodex/hub-admin-api-token" > "$CFG/ocx-hub-admin-token-file"
herdr plugin action invoke nordz0r.agent-quota.refresh
```

Pane models map to hub reports: `grok*` → xAI (weekly only), `gpt*`/`codex` → OpenAI (5h+7d), `glm`/`zai` → Zai, `gemini*` → Google Antigravity (`customWindows` Gem / Gem Weekly). `openrouter/*` → OpenRouter API credits, shown as remaining `$left/$limit` plus percent instead of 5h/7d. Cache keys are `ocx/{family}` so those panes do not share one snapshot.

### Update, configure, verify

Herdr has no `plugin update`: reinstalling replaces the managed checkout, runs `cargo build --release` again, and keeps the plugin's config and state. Reinstall does not run the startup hook. The `configure` action repairs the sidebar rows, reloads Herdr config, and then runs `startup`, which refreshes every pane and starts the watcher (restarting Herdr does the same):

```bash
herdr plugin install nordz0r/herdr-opencodex/herdr-agent-quota --ref main --yes
herdr plugin action invoke configure --plugin nordz0r.agent-quota
```

Configuration lives in `herdr plugin config-dir nordz0r.agent-quota`, one value per file:

| File / env | Value |
| --- | --- |
| `ocx-hub-url` / `HERDR_AGENT_QUOTA_OCX_HUB_URL` | Hub **management** origin (default `https://ocx.goldfinches.ru`). `/api/*` must be reachable there; an edge that only publishes the data plane answers `403 Forbidden`. |
| `ocx-hub-admin-token-file` / `HERDR_AGENT_QUOTA_OCX_ADMIN_TOKEN` | Path to a 0600 file with the hub admin token (default `~/.opencodex/hub-admin-api-token`). The env var holds the token itself; use it only for a manual run. |

Verify with `hub-check`, which checks the same steps the pane does (`omp usage`, then the hub) and never prints the token. It exits 1 if a step fails:

```bash
herdr plugin list   # nordz0r.agent-quota … [github:…@main]; no second quota plugin such as herdr-agent-usage
ROOT="$(herdr plugin list --json | jq -r '.. | objects | select(.plugin_id? == "nordz0r.agent-quota") | .plugin_root')"
HERDR_PLUGIN_CONFIG_DIR="$(herdr plugin config-dir nordz0r.agent-quota)" \
  "$ROOT/target/release/herdr-agent-quota" hub-check --provider ocx --model openrouter/deepseek/deepseek-v3.2
herdr plugin log list --plugin nordz0r.agent-quota --limit 5
```

The last `hub-check` line shows what the pane will render, e.g. `7d "$0.87/$1.00 87%"` for an `ocx/openrouter/…` pane. `gpt*` panes show 5h/7d.

Full settings, layouts, and other collectors: [herdr-agent-quota/README.md](herdr-agent-quota/README.md).

## Trust

Plugins run as your user with full shell and Herdr CLI access. Review `herdr-plugin.toml`, `bin/ocx-stats.mjs`, and `herdr-agent-quota/` before install.

## License

MIT. Quota plugin retains the original Levi Qiao MIT notice plus this distribution’s remaining-quota changes.
