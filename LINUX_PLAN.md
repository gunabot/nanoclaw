# NanoClaw – Phase 1 Linux Adaptation Plan (Ubuntu 24.04, no containers)

## Goal
Remove the macOS/Apple Container dependency and run the **agent runner directly on the Linux host**, while preserving:
- Per-group isolation boundaries **at the filesystem/IPC level** (best-effort, without OS-level container isolation)
- Per-group Claude session separation (per-group `.claude/`)
- IPC file-based MCP bridge (host ↔ agent runner)
- SQLite storage, scheduler, WhatsApp router

Phase 1 is primarily a **build/compile + wiring** change: replace `container run …` with `node …/agent-runner/dist/index.js` and make paths configurable.

---

## 1) What needs to change (Apple Container → direct execution)

### A. `src/container-runner.ts`
Current behavior:
- Builds Apple Container `--mount/-v` args
- Spawns `container run -i --rm <image>`
- Uses in-container fixed paths (`/workspace/group`, `/workspace/ipc`, `/home/node/.claude`)

Linux adaptation:
- Replace Apple Container spawn with **direct Node process spawn**:
  - `spawn(process.execPath, [agentRunnerEntrypoint], { cwd, env, stdio })`
- Replace “mounts” with **direct path selection**:
  - Use real host paths for:
    - `groupDir` (working directory)
    - `ipcDir`
    - per-group claude sessions dir
    - optional extra mounts (validated) exposed as environment variables (or ignored in Phase 1)
- Keep output parsing via sentinel markers unchanged.

### B. `container/agent-runner/src/*`
Current behavior:
- Hard-codes container paths:
  - `/workspace/group`
  - `/workspace/ipc`

Linux adaptation:
- Make these paths configurable via environment variables:
  - `NANOCLAW_GROUP_DIR`
  - `NANOCLAW_IPC_DIR`
- Default to old container paths so container mode remains theoretically possible.

### C. `src/index.ts`
Current behavior:
- Calls `ensureContainerSystemRunning()` (Apple Container)
- Uses `osascript` for QR notification

Linux adaptation:
- Remove Apple Container boot logic entirely.
- Replace macOS notification with:
  - log-only, or
  - optional `notify-send` if present (non-fatal; best-effort).

### D. `src/config.ts` and `src/mount-security.ts`
Current behavior:
- Uses `process.env.HOME || '/Users/user'` which is macOS-specific default.

Linux adaptation:
- Use `os.homedir()` as the default home.
- Keep `~/.config/nanoclaw/mount-allowlist.json` as the allowlist location.

### E. Build/install workflow
Current behavior:
- Root build only runs `tsc` for host router.
- Agent runner is a separate Node package under `container/agent-runner`.

Linux adaptation:
- Ensure `npm install` installs agent-runner deps.
- Ensure `npm run build` builds both:
  - `container/agent-runner` → `dist/`
  - root `src/` → `dist/`

---

## 2) What can stay the same
- WhatsApp router logic (`src/index.ts` message loop, group registration, trigger routing)
- Scheduler loop (`src/task-scheduler.ts`) and DB model (`src/db.ts`)
- IPC file protocol and authorization checks on host side
- Mount allowlist model and validation logic (conceptually). In Phase 1 we keep validation and reuse it to pass “extra” paths to the runner.
- Output parsing strategy (sentinel markers).

---

## 3) Dependencies to add/remove

### Remove
- No npm dependency for Apple Container exists, so nothing to remove from `package.json`.
- Remove runtime assumption of `container` binary.

### Add (scripts / local install)
- Add root `postinstall` script to install `container/agent-runner` dependencies:
  - `npm --prefix container/agent-runner install`
- Update root `build` script to also build agent-runner:
  - `npm --prefix container/agent-runner run build && tsc`

No new JS deps are required for Phase 1.

---

## 4) Step-by-step implementation order

1. **Agent runner path configurability**
   - Update `container/agent-runner/src/ipc-mcp.ts` to read `IPC_DIR` from `process.env.NANOCLAW_IPC_DIR`.
   - Update `container/agent-runner/src/index.ts` to read `groupDir` from `process.env.NANOCLAW_GROUP_DIR`.

2. **Direct execution runner (host side)**
   - Refactor `src/container-runner.ts` to:
     - Stop building container args
     - Compute host directories:
       - group working dir = `GROUPS_DIR/<group.folder>`
       - ipc dir = `DATA_DIR/ipc/<group.folder>`
       - sessions dir = `DATA_DIR/sessions/<group.folder>/.claude`
     - Spawn agent runner:
       - executable: `node` (use `process.execPath`)
       - args: `[<repo>/container/agent-runner/dist/index.js]`
       - env: include `NANOCLAW_GROUP_DIR`, `NANOCLAW_IPC_DIR` and any safe vars from `group.containerConfig?.env`
     - Keep stdout/stderr truncation + sentinel parse.

3. **Remove Apple Container startup**
   - Delete `ensureContainerSystemRunning()` and its call from `src/index.ts`.
   - Replace QR notification `osascript …` with log-only or `notify-send` best-effort.

4. **Linux path fixes**
   - Update `src/config.ts` to use `os.homedir()`.
   - Update `src/mount-security.ts` home expansion similarly.

5. **Build wiring**
   - Update root `package.json`:
     - `postinstall` installs agent-runner deps.
     - `build` builds agent-runner then root.

6. **Test**
   - `npm install`
   - `npm run build`
   - Verify `dist/` exists for both root and `container/agent-runner/dist/`.
   - Ensure grep for `container system` / `osascript` / hard-coded `/workspace/*` is clean (except defaults in runner).

7. **Commit**
   - Commit with message:
     - `Phase 1: Linux adaptation - remove Apple Container, run agents directly`

---

## Notes / Non-goals (Phase 1)
- This phase does **not** attempt strong sandboxing (containers provided that before). Isolation is best-effort via:
  - separate working dirs
  - separate `.claude/` session dirs
  - separate IPC namespaces
- Any future hardening (Phase 2+) could add:
  - Linux namespaces (bubblewrap/firejail)
  - dedicated unix user per group
  - seccomp/apparmor
