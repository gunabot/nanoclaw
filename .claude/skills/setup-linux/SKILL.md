---
name: setup-linux
description: Set up NanoClaw on Linux (Ubuntu/Debian recommended). Installs deps, configures .env, optional WhatsApp auth, and optional systemd service.
---

# NanoClaw Linux Setup

Run commands automatically. Only pause when **user action is required** (WhatsApp QR scan, choosing Claude auth).

> Notes
> - Runs directly on the host (no containers).
> - The systemd service uses `npm run dev` (tsx), not `dist/index.js`.

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

NanoClaw uses the Claude Agent SDK. Provide **either**:

- `CLAUDE_CODE_OAUTH_TOKEN` (Claude Code OAuth), or
- `ANTHROPIC_API_KEY`

## 2) Clone / fork

If you already have the repo, skip.

```bash
git clone https://github.com/gunabot/nanoclaw.git
cd nanoclaw
```

## 3) Install dependencies

```bash
npm install
```

If this fails due to `better-sqlite3` build errors, see Troubleshooting.

## 4) Configuration (`.env`)

NanoClaw reads env vars from `.env` in the project root.

Minimum Discord + Claude example:

```bash
cat > .env << 'EOF'
ASSISTANT_NAME=Andy
DISCORD_TOKEN=
DISCORD_MAIN_CHANNEL_ID=
ANTHROPIC_API_KEY=
# Or use: CLAUDE_CODE_OAUTH_TOKEN=
EOF
```

Notes:
- Discord-only is supported. Leave WhatsApp steps out if you only want Discord.
- For WhatsApp-only, you can omit `DISCORD_TOKEN`.

## 5) WhatsApp authentication (optional)

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

## 6) Register your WhatsApp main control chat (optional)

NanoClaw only needs this if you are using WhatsApp.

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

## 7) Run NanoClaw

Foreground (dev runner via tsx):

```bash
npm run dev
```

## 8) Systemd (optional)

Create a service unit (adjust user/project path):

```bash
PROJECT_PATH=$(pwd)
NPM_BIN=$(command -v npm)

sudo tee /etc/systemd/system/nanoclaw.service > /dev/null << EOF
[Unit]
Description=NanoClaw assistant
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=${PROJECT_PATH}
EnvironmentFile=${PROJECT_PATH}/.env
ExecStart=${NPM_BIN} run dev
Restart=on-failure
RestartSec=3

# Hardening (best-effort)
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=${PROJECT_PATH}

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now nanoclaw.service
```

Check status and logs:

```bash
systemctl status nanoclaw.service --no-pager
journalctl -u nanoclaw.service -f
```

## 9) Test

- Discord: send a message in `DISCORD_MAIN_CHANNEL_ID` → expect a response.
- WhatsApp: in your registered chat, send `@Andy hello` → expect a response.

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

- Discord: confirm `DISCORD_TOKEN` is set and channel is allowed.
- WhatsApp: confirm the message starts with the trigger (e.g. `@Andy`) and `data/registered_groups.json` contains the chat JID.
- Check logs:
  ```bash
  journalctl -u nanoclaw.service -f
  ```

### Claude auth not being picked up

- Verify `.env` exists in the project root
- If using systemd, verify `EnvironmentFile=` path is correct and restart the service
