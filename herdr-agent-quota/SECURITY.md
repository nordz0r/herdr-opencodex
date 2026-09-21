# Security policy

## Reporting

Report vulnerabilities privately through
[GitHub Security Advisories](https://github.com/levi-qiao/herdr-agent-quota/security/advisories/new).
Do not include credentials in public issues. The expected initial response time
is seven days. Security fixes target the latest release.

## Data handling

The plugin reads configured CLI credentials, local session metadata/transcripts,
and Claude/Agy StatusLine input. Codex quota is obtained through its app-server;
OMP quota through its usage CLI. OMP's credential database is never opened.
Local SQLite reads are read-only and limited to session/model data.

Authenticated quota requests use the relevant CLI/provider's usage contract.
The plugin sends no model prompts and does not upload usage to another service.
It does not read browser cookies or system keychains, or manage provider logins.
Invoked CLIs remain responsible for their own credential lifecycle.

Plugin state can contain quota, account/session identifiers, model and cache
statistics, session summaries, preferences, and watcher coordination files.
Herdr metadata can contain a short visible prompt topic. Credentials are never
written to these files, logs, or pane metadata; credential-derived identifiers
are hashed. Account IDs supplied by a CLI may be retained as identifiers.

Installation modifies only managed Herdr configuration and selected agents'
hooks/integrations. User configuration is preserved or backed up for restoration;
uninstall removes the selected plugin-owned settings and stops background work.
