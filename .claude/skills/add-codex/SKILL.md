# /add-codex

Add Codex CLI as an alternative NanoClaw agent runtime.

## 1) Overview

NanoClaw supports two agent runtimes:
- `claude` (default) — Claude Agent SDK
- `codex` — Codex CLI

Codex is invoked as:

```bash
codex --full-auto exec "<prompt>"
```

## 2) Prerequisites

- Codex CLI installed and available on PATH:
  - `codex --help` should work
- Codex CLI authenticated (OAuth configured):
  - Run `codex` once interactively and complete login
  - Ensure NanoClaw runs under the same user HOME where Codex stores credentials

## 3) Runtime selection + priority

Priority order:
1. **Per-group config** (`data/registered_groups.json` → `containerConfig.env.AGENT_RUNTIME`)
2. **Database setting** (`settings` table key `agent_runtime`)
3. **Environment variable** (`AGENT_RUNTIME`)
4. **Default** (`claude`)

### Per-group override (WhatsApp groups)

```json
{
  "containerConfig": {
    "env": {
      "AGENT_RUNTIME": "codex"
    }
  }
}
```

### Global (env)

```bash
export AGENT_RUNTIME=codex
```

Run:

```bash
AGENT_RUNTIME=codex npm run dev
```

### Hot-swap via Discord command (persists in DB)

From any allowed Discord channel/DM:

- `!runtime status` → show current runtime
- `!runtime codex` → switch to Codex
- `!runtime claude` → switch back to Claude

This updates the `settings` table (`agent_runtime`) and survives restarts.

## 4) Testing

1. Verify Codex is available:
   - `codex --help`
2. Start NanoClaw with Codex (or use `!runtime codex`)
3. Send a Discord or WhatsApp message and confirm:
   - NanoClaw replies with Codex output
   - No `codex: command not found` errors in logs

## 5) Codex trust configuration

NanoClaw runs Codex from `groups/<folder>/` directories. Codex CLI only executes in
trusted paths configured in `~/.codex/config.toml`. Add the NanoClaw groups paths:

```toml
[projects."/path/to/nanoclaw/groups"]
trust_level = "trusted"

[projects."/path/to/nanoclaw/groups/discord"]
trust_level = "trusted"
```

Use the exact absolute paths for your install.

## 6) Troubleshooting

- **`codex: command not found`**
  - Install Codex CLI and ensure it is on PATH for the NanoClaw process.

- **OAuth / login errors**
  - Ensure NanoClaw runs under the same user account that completed `codex` login.
  - Avoid overriding `HOME` for Codex.

- **Codex returns empty output**
  - Check that `groups/<folder>/` directories are configured as trusted in
    `~/.codex/config.toml`.

- **Empty response / non-zero exit**
  - Check `groups/<folder>/logs/agent-*.log`
  - Run with `LOG_LEVEL=debug` to increase verbosity.
