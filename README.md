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

Pane models map to hub reports: `grok*` → xAI (weekly only), `gpt*`/`codex` → OpenAI (5h+7d), `glm`/`zai` → Zai, `gemini*` → Google Antigravity (`customWindows` Gem / Gem Weekly). Cache keys are `ocx/{family}` so those panes do not share one snapshot.

Full settings, layouts, and other collectors: [herdr-agent-quota/README.md](herdr-agent-quota/README.md).

## Trust

Plugins run as your user with full shell and Herdr CLI access. Review `herdr-plugin.toml`, `bin/ocx-stats.mjs`, and `herdr-agent-quota/` before install.

## License

MIT. Quota plugin retains the original Levi Qiao MIT notice plus this distribution’s remaining-quota changes.
