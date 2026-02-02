---
name: add-discord
description: Enable Discord as a NanoClaw channel (works alongside WhatsApp or Discord-only).
---

# Add Discord Support

This skill reflects the current Discord integration as implemented.

## 1) What works now

- Discord runs alongside WhatsApp, or Discord-only.
- Scope IDs:
  - Guild channel: `discord:<guildId>:<channelId>`
  - DM: `discord:dm:<userId>`
- Messages are stored in the same SQLite DB as WhatsApp (`store/messages.db`).
- Typing indicators are supported.
- Responses are sent for **all allowed messages** (no mention requirement in the current code).

## 2) Configuration

Set these environment variables (e.g. in `.env`):

- `DISCORD_TOKEN` (required)
- `DISCORD_MAIN_CHANNEL_ID` (recommended)
- `DISCORD_ALLOWED_GUILD_IDS` (optional CSV)
- `DISCORD_ALLOWED_CHANNEL_IDS` (optional CSV)

Allowlist behavior:
- If allowlists are **empty**, Discord only allows DMs + `DISCORD_MAIN_CHANNEL_ID`.
- If allowlists are set, only those guilds/channels are accepted.

## 3) Behavior summary

- **DMs**: always allowed and responded to.
- **Main channel** (`DISCORD_MAIN_CHANNEL_ID`): allowed and responded to.
- **Other channels**: allowed only if allowlisted; responses are sent for all allowed messages.

## 4) Discord Developer Portal setup (quick checklist)

- Create a Discord application + bot
- Enable **Message Content Intent**
- Invite the bot to your server with permissions:
  - View Channels / Read Messages
  - Send Messages
  - Read Message History
  - (Optional) Send Typing Indicators

## 5) Testing

```bash
export DISCORD_TOKEN="..."
export DISCORD_MAIN_CHANNEL_ID="123..."
# Optional
export DISCORD_ALLOWED_GUILD_IDS="123...,456..."
export DISCORD_ALLOWED_CHANNEL_IDS="123...,456..."

npm run dev
```

Verify:
- Send a DM → bot responds.
- Send a message in the main channel → bot responds.
- Send a message in an allowlisted channel → bot responds.

## 6) Troubleshooting

- **Bot connects but doesn’t receive messages**
  - Ensure Message Content intent is enabled.
  - Ensure the bot has permissions to view the channel.
  - Check allowlists.

- **No responses in a guild channel**
  - If no allowlists are set, only the main channel is accepted.
  - Ensure the channel is allowlisted or set as `DISCORD_MAIN_CHANNEL_ID`.

- **`Missing Access` / `Forbidden` errors**
  - The bot lacks permissions in that channel.
  - The bot may not be in the server.

- **DMs not working**
  - The user might have server privacy settings disallowing DMs.
