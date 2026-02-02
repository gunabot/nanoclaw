# /add-codex

Add Codex CLI as an alternative NanoClaw agent runtime.

## 1) Overview
This skill documents and enables running NanoClaw with **Codex CLI** instead of the default **Claude Agent SDK** runner.

NanoClaw supports two agent runtimes:
- `claude` (default) — uses `@anthropic-ai/claude-agent-sdk`
- `codex` — shells out to `codex --full-auto exec "..."`

Runtime selection can be global (`AGENT_RUNTIME`) or per-group (group `containerConfig.env`).

## 2) Prerequisites
- Codex CLI installed and available on PATH:
  - `codex --help` should work
- Codex CLI authenticated (OAuth configured):
  - Run `codex` once interactively and complete login
  - Ensure NanoClaw runs under the same user HOME where Codex stores credentials

## 3) Configuration

### Global
Set in your shell or `.env`:

```bash
export AGENT_RUNTIME=codex
```

Run:

```bash
AGENT_RUNTIME=codex npm run dev
```

### Per-group override
In the group registration config (stored in `data/registered_groups.json`), set:

```json
{
  "containerConfig": {
    "env": {
      "AGENT_RUNTIME": "codex"
    }
  }
}
```

Priority order:
1. `group.containerConfig.env.AGENT_RUNTIME`
2. `process.env.AGENT_RUNTIME`
3. `claude`

## 4) How Codex is invoked
NanoClaw runs Codex CLI as a child process:

```bash
codex --full-auto exec "<prompt>"
```

- Working directory: the group workspace (`groups/<groupFolder>`)
- Output: stdout is treated as the assistant reply

## 5) Session management
- Claude runtime supports session resume via `resume: <sessionId>`.
- Codex runtime currently **does not** provide a stable resume id.

NanoClaw preserves context by reconstructing prompts from stored chat history in the DB, so Codex still gets conversation context.

## 6) IPC / tools approach
Codex does not have Claude Agent SDK tool bindings.

NanoClaw exposes actions via **file-based IPC** (already used by the system):

- Send message:
  - Write a JSON file to: `data/ipc/<group>/messages/*.json`
  - Example:

```json
{"type":"message","chatJid":"discord:#mimo","text":"Hello"}
```

- Tasks:
  - Write to: `data/ipc/<group>/tasks/*.json`
  - Examples:

```json
{"type":"schedule_task","prompt":"...","schedule_type":"interval","schedule_value":"60000","groupFolder":"main"}
```

Codex prompts include a short reminder of these IPC mechanisms.

## 7) Testing steps

1. Verify Codex is available:
   - `codex --help`
2. Start NanoClaw with Codex:

```bash
AGENT_RUNTIME=codex npm run dev
```

3. Send a message (Discord mention or main channel) and confirm:
- NanoClaw replies with Codex output
- No `codex: command not found` errors in logs

## 8) Troubleshooting

- **`codex: command not found`**
  - Install Codex CLI and ensure it is on PATH for the NanoClaw process.

- **OAuth / login errors**
  - Ensure NanoClaw is running under the same user account that completed `codex` login.
  - Avoid overriding `HOME` for Codex; NanoClaw keeps real HOME for Codex by default.

- **Empty response / non-zero exit**
  - Check `groups/<folder>/logs/agent-*.log`
  - Run with `LOG_LEVEL=debug` to increase verbosity.
