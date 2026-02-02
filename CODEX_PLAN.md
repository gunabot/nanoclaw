# Codex CLI Integration Plan (NanoClaw)

## Goals
- Add **Codex CLI** as an alternative agent runtime alongside the existing **Claude Agent SDK** runner.
- Allow selecting the runtime **globally** (env var) and **per group** (group containerConfig.env override).
- Preserve the existing NanoClaw architecture:
  - Router process (WhatsApp/Discord) builds prompts from DB.
  - Agent runner executes with access to group workspace.
  - Tools/side-effects happen via **file-based IPC** under `data/ipc/<group>/...`.

---

## Runtime Selection

### Global default
- New env var: `AGENT_RUNTIME`
  - Values: `claude | codex`
  - Default: `claude`

### Per-group override
- Existing mechanism: `registeredGroups[...].containerConfig.env`
- If `group.containerConfig.env.AGENT_RUNTIME` is set, it wins over the global env var.

Priority order:
1. `group.containerConfig.env.AGENT_RUNTIME`
2. `process.env.AGENT_RUNTIME`
3. `claude`

---

## How Codex CLI is invoked

### Command
- Use Codex CLI in non-interactive mode:

```bash
codex --full-auto exec "<PROMPT>"
```

### Working directory
- Run with `cwd = <group workspace directory>` (e.g. `groups/<folder>`).

### Environment
- Preserve the user’s real `HOME` by default for Codex so it can find OAuth credentials.
- Still set NanoClaw env vars:
  - `NANOCLAW_GROUP_DIR` (workspace path)
  - `NANOCLAW_IPC_DIR` (IPC namespace)

---

## Session management

Codex CLI does not provide a stable, documented session id compatible with NanoClaw’s existing `resume` flow.

Approach:
- NanoClaw already builds prompts from messages stored in the DB (`buildPromptFromMessages`), so **conversation state is preserved** without relying on Codex sessions.
- For now, Codex runner returns `newSessionId: undefined`.
- Optional future enhancement: store Codex transcripts under `data/sessions/<group>/codex/` and implement a lightweight summarization / rolling context.

---

## Output parsing

- Codex CLI stdout is treated as the assistant response.
- Implementation rules:
  - Prefer `stdout.trim()`.
  - If stdout is empty, surface a concise error based on stderr.
  - Keep existing NanoClaw output limits (`CONTAINER_MAX_OUTPUT_SIZE`).

---

## Tools / IPC integration

Codex CLI cannot directly use the Claude Agent SDK tool interface.

Instead, tools are implemented via the **same file-based IPC** NanoClaw already uses:
- Send message:
  - Write JSON files into: `data/ipc/<group>/messages/*.json`
- Schedule/pause/resume/cancel tasks:
  - Write JSON files into: `data/ipc/<group>/tasks/*.json`

Codex prompt will include short instructions:
- “To send a message, write a JSON file with `{type:'message', chatJid, text}` to `$NANOCLAW_IPC_DIR/messages/`.”
- “To schedule tasks, write `{type:'schedule_task', ...}` to `$NANOCLAW_IPC_DIR/tasks/`.”

This matches the existing IPC watcher in `src/index.ts`.

---

## Testing

1. Ensure Codex CLI is installed and logged in (`codex` should run in your shell).
2. Run NanoClaw with Codex:

```bash
AGENT_RUNTIME=codex npm run dev
```

3. Verify:
- Discord mentions / main channel messages trigger a response.
- Response text equals Codex stdout.
- IPC features work when Codex is instructed to write IPC JSON.

---

## Troubleshooting

- `codex: command not found`
  - Install Codex CLI and ensure it’s on PATH.

- `Not logged in` / OAuth errors
  - Ensure Codex CLI is authenticated in the same HOME as NanoClaw runs under.
  - If you override `HOME`, Codex may not see credentials.

- Empty responses
  - Check `groups/<folder>/logs/agent-*.log` for stderr.
  - Increase verbosity: `LOG_LEVEL=debug`.
