---
name: setup-linux
description: Set up NanoClaw on Linux (Ubuntu/Debian recommended). Installs deps, builds, authenticates WhatsApp, configures Claude auth, and optionally sets up systemd.
---

# NanoClaw Linux Setup

Run all commands automatically. Only pause when **user action is required** (WhatsApp QR scan, choosing auth method).

> Notes
> - This fork runs the **agent runner directly on the Linux host** (no Apple Container).
> - Commands assume Ubuntu/Debian. For other distros, install equivalent packages.

## 1) Prerequisites

### Required

- **Linux x86_64** (tested on Ubuntu 24.04)
- **Node.js >= 20** (Node 22 recommended)
- **npm** (comes with Node)
- Build tools for native modules (needed by `better-sqlite3`)

Install system packages:

```bash
sudo apt-get update
sudo apt-get install -y \
  git \
  ca-certificates \
  build-essential \
  python3 \
  pkg-config
```

Optional but useful:

```bash
sudo apt-get install -y sqlite3
```

### Claude authentication (pick one)

NanoClaw’s agent runner uses Anthropic’s Agent SDK. You must provide **either**:

- `CLAUDE_CODE_OAUTH_TOKEN` (if using a Claude subscription via Claude Code), or
- `ANTHROPIC_API_KEY`

## 2) Clone / fork

If you already have the repo, skip.

```bash
git clone https://github.com/gunabot/nanoclaw.git
cd nanoclaw
```

If you are working from your own fork, clone that URL instead.

## 3) Install dependencies

Install root deps and the agent-runner deps (handled by `postinstall`):

```bash
npm install
```

If this fails due to `better-sqlite3` build errors, see Troubleshooting.

## 4) Build

Build the agent runner and the main app:

```bash
npm run build
```

Sanity check:

```bash
node -v
ls -la dist/index.js container/agent-runner/dist/index.js
```

## 5) Configuration

### 5.1 Create `.env`

NanoClaw reads env vars from `.env` in the project root.

Ask the user:
> Do you want to authenticate with your **Claude subscription (Claude Code OAuth token)** or an **Anthropic API key**?

#### Option A: Claude subscription (OAuth token)

If the user already uses Claude Code on this machine, try to extract the token:

```bash
TOKEN=$(cat ~/.claude/.credentials.json 2>/dev/null | jq -r '.claudeAiOauth.accessToken // empty')
if [ -n "$TOKEN" ]; then
  {
    echo "CLAUDE_CODE_OAUTH_TOKEN=$TOKEN"
  } > .env
  echo "Wrote CLAUDE_CODE_OAUTH_TOKEN to .env: ${TOKEN:0:20}...${TOKEN: -4}"
else
  echo "No token found in ~/.claude/.credentials.json"
fi
```

If `jq` is missing:

```bash
sudo apt-get install -y jq
```

If token still missing, tell the user:
> Run `claude` in another terminal, log in, then re-run the token extraction.

#### Option B: Anthropic API key

Create `.env` and have the user paste a key:

```bash
cat > .env << 'EOF'
ANTHROPIC_API_KEY=
EOF
```

Tell the user to set it from: https://console.anthropic.com/

Verify it is non-empty:

```bash
KEY=$(grep '^ANTHROPIC_API_KEY=' .env | cut -d= -f2-)
[ -n "$KEY" ] && echo "API key configured: ${KEY:0:10}...${KEY: -4}" || echo "Missing ANTHROPIC_API_KEY"
```

### 5.2 (Optional) Mount allowlist (external directory access)

Even without containers, NanoClaw maintains a host-side allowlist to control what directories agents may be given access to.

Create an explicit “no external access” allowlist:

```bash
mkdir -p ~/.config/nanoclaw
cat > ~/.config/nanoclaw/mount-allowlist.json << 'EOF'
{
  "allowedRoots": [],
  "blockedPatterns": [],
  "nonMainReadOnly": true
}
EOF
```

If the user wants to allow specific folders, collect paths + read/write intent and write them into `~/.config/nanoclaw/mount-allowlist.json`.

## 6) WhatsApp authentication

**USER ACTION REQUIRED**

Run:

```bash
npm run auth
```

Tell the user:
> A QR code will appear. On your phone:
> 1. Open WhatsApp
> 2. Settings → Linked Devices → Link a Device
> 3. Scan the QR code

When it prints “Successfully authenticated” (or “Already authenticated”), continue.

## 7) Register your main control chat

NanoClaw needs to know which chat(s) it should respond to.

Ask the user:
> Do you want to use your **personal chat** (Message Yourself) or a **WhatsApp group** as your main control channel?

Have them send a message in that chat, then capture recent JIDs by briefly running the app:

```bash
timeout 10 npm run dev || true
```

Then query recent chats:

```bash
# Personal chat (ends with @s.whatsapp.net)
sqlite3 store/messages.db \
  "SELECT DISTINCT chat_jid FROM messages WHERE chat_jid LIKE '%@s.whatsapp.net' ORDER BY timestamp DESC LIMIT 10;"

# Group chat (ends with @g.us)
sqlite3 store/messages.db \
  "SELECT DISTINCT chat_jid FROM messages WHERE chat_jid LIKE '%@g.us' ORDER BY timestamp DESC LIMIT 10;"
```

Create/update `data/registered_groups.json` (choose a trigger word; default is `@Andy`):

```bash
mkdir -p data
NOW=$(date -Is)
cat > data/registered_groups.json << EOF
{
  "JID_HERE": {
    "name": "main",
    "folder": "main",
    "trigger": "@Andy",
    "added_at": "${NOW}"
  }
}
EOF
```

Ensure the group folder exists:

```bash
mkdir -p groups/main/logs
```

## 8) Running NanoClaw

### Foreground (manual)

```bash
npm run build
npm start
```

Or for dev mode:

```bash
npm run dev
```

Logs are printed to stdout. For long-running usage, prefer systemd below.

## 9) Systemd (optional)

Create a service unit (adjust user/project path):

```bash
PROJECT_PATH=$(pwd)
NODE_BIN=$(command -v node)

sudo tee /etc/systemd/system/nanoclaw.service > /dev/null << EOF
[Unit]
Description=NanoClaw WhatsApp Claude assistant
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=${PROJECT_PATH}
Environment=NODE_ENV=production
EnvironmentFile=${PROJECT_PATH}/.env
ExecStart=${NODE_BIN} ${PROJECT_PATH}/dist/index.js
Restart=on-failure
RestartSec=3

# Hardening (best-effort)
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=read-only
ReadWritePaths=${PROJECT_PATH}

StandardOutput=append:${PROJECT_PATH}/logs/nanoclaw.log
StandardError=append:${PROJECT_PATH}/logs/nanoclaw.error.log

[Install]
WantedBy=multi-user.target
EOF

mkdir -p logs
sudo systemctl daemon-reload
sudo systemctl enable --now nanoclaw.service
```

Check status and logs:

```bash
systemctl status nanoclaw.service --no-pager
journalctl -u nanoclaw.service -f
# or
 tail -f logs/nanoclaw.log
```

If `ProtectHome=read-only` breaks WhatsApp auth storage or Claude session storage, remove it (or set `ProtectHome=true` and add explicit `ReadWritePaths=` entries).

## 10) Test

Tell the user:
> In your registered chat, send: `@Andy hello`

You should see a response in WhatsApp, and logs in `logs/nanoclaw.log`.

---

## Troubleshooting

### `better-sqlite3` fails to install / build

Symptoms: `node-gyp` errors during `npm install`.

Fix:

```bash
sudo apt-get update
sudo apt-get install -y build-essential python3 pkg-config
rm -rf node_modules package-lock.json
npm install
```

### `sqlite3: command not found`

Install the CLI (NanoClaw itself does not strictly require it, but setup queries do):

```bash
sudo apt-get install -y sqlite3
```

### WhatsApp auth keeps disconnecting

- Re-run:
  ```bash
  npm run auth
  ```
- If running under systemd, restart:
  ```bash
  sudo systemctl restart nanoclaw.service
  ```

### No response to messages

- Confirm the message starts with the trigger (e.g. `@Andy`)
- Confirm `data/registered_groups.json` contains the chat JID
- Check logs:
  ```bash
  tail -200 logs/nanoclaw.error.log
  ```

### `CLAUDE_CODE_OAUTH_TOKEN` / `ANTHROPIC_API_KEY` not being picked up

- Verify `.env` exists in the project root
- If using systemd, verify `EnvironmentFile=` path is correct and restart the service

### Permissions issues when running as a service

- Ensure the service `User=` owns the project directory:
  ```bash
  sudo chown -R $USER:$USER .
  ```
- Ensure `logs/` is writable by the service user
