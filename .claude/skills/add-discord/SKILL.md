---
name: add-discord
description: Add Discord as an additional NanoClaw channel alongside WhatsApp (discord.js client, config, DB storage, routing, and env vars).
---

# Add Discord Support (Alongside WhatsApp)

This skill documents the minimal, production-oriented changes needed to add **Discord** as a second chat “transport” in NanoClaw (in addition to WhatsApp).

The goal:
- Run a Discord bot (via `discord.js`)
- Receive Discord messages and map them into NanoClaw’s existing `chat_jid`/message DB model
- Route messages into the same agent runner used for WhatsApp
- Send replies back to Discord

## 1) Overview

You will:
- Add a Discord client that emits normalized `DiscordIncomingMessage` events.
- Persist Discord messages into the existing SQLite `messages` table (re-using the schema).
- Treat Discord conversations as **scope IDs** stored in `messages.chat_jid`:
  - Guild channel: `discord:<guildId>:<channelId>`
  - DM: `discord:dm:<userId>`
- Extend the router (`src/index.ts`) so:
  - Discord DMs always get a response
  - The configured main Discord channel always gets a response
  - Other channels only get a response when the bot is mentioned

## 2) Prerequisites

Before touching code, ensure you have:
- A Discord application + bot created in the Discord Developer Portal
- The **bot token**
- **Message Content Intent** enabled for the bot
- The bot invited to your server (guild) with permissions to:
  - Read messages
  - Send messages
  - (Optional) Send typing indicators

## 3) Dependencies

Install the Discord library:

```bash
npm install discord.js
```

NanoClaw uses ESM (`"type": "module"`) and TypeScript. `discord.js` v14 works well here.

## 4) Files to Create

### A) `src/discord.ts`

Purpose:
- Own the lifecycle of the Discord `Client`
- Convert raw `discord.js` messages into a project-friendly shape
- Provide helpers to send messages and typing indicators based on `scopeId`

Key responsibilities / functions:
- `startDiscord({ onIncomingMessage, logger })`
  - Creates a `discord.js` `Client`
  - Subscribes to `Events.MessageCreate`
  - Filters out:
    - Bot’s own messages
    - Other bots
    - Empty content
    - Messages outside configured allowlists
  - Calls `onIncomingMessage(normalizedMessage)`

- `discordScopeFromMessage(message)`
  - Returns `{ scopeId, isDM, guildId?, channelId? }`
  - Uses:
    - `discord:<guildId>:<channelId>` for guild messages
    - `discord:dm:<userId>` for DMs

- `sendDiscordMessage(scopeId, text)`
  - If DM scope, fetch user → open DM → send
  - If guild scope, fetch channel → `send(text)`

- `setDiscordTyping(scopeId, isTyping)`
  - Discord typing is fire-and-forget (`sendTyping()`), so only handle `isTyping === true`

Recommended allowlist behavior (defensive-by-default):
- If `DISCORD_ALLOWED_*` allowlists are **empty**, only allow:
  - DMs
  - the configured `DISCORD_MAIN_CHANNEL_ID`

### B) `src/discord-auth.ts`

Purpose:
- Small “feature flag” + configuration validation.

Key functions:
- `isDiscordEnabled()`
  - Returns true when `DISCORD_TOKEN` is set and non-empty.

- `assertDiscordTokenConfigured()`
  - Throws if token missing/empty.
  - Performs a basic token shape sanity check (Discord bot tokens are typically dot-separated).

## 5) Files to Modify

### A) `src/config.ts`

Add Discord environment variables:
- `DISCORD_TOKEN`
- `DISCORD_MAIN_CHANNEL_ID`
- `DISCORD_ALLOWED_GUILD_IDS` (CSV → array)
- `DISCORD_ALLOWED_CHANNEL_IDS` (CSV → array)

Implement a small CSV parser helper, e.g.:
- `parseCsvEnv("a,b,c") → ["a","b","c"]`

### B) `src/types.ts`

Add Discord scope ID types so the router and DB can refer to them clearly:

- `type DiscordGuildScopeId = `discord:${string}:${string}``
- `type DiscordDMScopeId = `discord:dm:${string}``
- `type DiscordScopeId = DiscordGuildScopeId | DiscordDMScopeId`

These scope IDs are used as `chat_jid` values.

### C) `src/db.ts`

Add a helper to store Discord messages in the existing `messages` table:

- `storeDiscordMessage({ id, chatJid, senderId, senderName, content, timestamp, isFromMe })`

This should use the same schema as WhatsApp messages:
- `messages(id, chat_jid, sender, sender_name, content, timestamp, is_from_me)`

### D) `src/index.ts`

Wire Discord into the main router:

1) Import:
- `startDiscord`, `sendDiscordMessage`, `setDiscordTyping`
- `storeDiscordMessage`
- `DISCORD_TOKEN` (to decide whether to start the Discord client)

2) Add a “virtual registered group” for Discord:
- Example:
  - `name: "Discord"`
  - `folder: "discord"`
  - `trigger: "@mention"` (not the WhatsApp trigger pattern)

3) Add a Discord inbound handler:
- `processDiscordIncoming(msg)` should:
  - `storeChatMetadata(scopeId, timestamp, name)`
  - `storeDiscordMessage(...)`
  - Decide whether to respond:
    - respond if DM
    - respond if main channel
    - respond if mentioned
  - Build the prompt from messages since the last agent timestamp (same as WhatsApp)
  - Run the agent via `runAgent(DISCORD_GROUP, prompt, scopeId, isMain)`
  - Send response via the common `sendMessage()` function

4) Extend message sending + typing abstraction:
- In `sendMessage(chatJid, text)`:
  - if `chatJid.startsWith('discord:')` → `sendDiscordMessage(chatJid, text)`
  - else → WhatsApp `sock.sendMessage(...)`

- In `setTyping(chatJid, isTyping)`:
  - if Discord scope → `setDiscordTyping(chatJid, isTyping)`
  - else → WhatsApp presence update

5) Start the Discord client (only if configured):
- If `DISCORD_TOKEN` is set, call:
  - `startDiscord({ onIncomingMessage: processDiscordIncoming, logger })`

## 6) Configuration

Set these environment variables (e.g. in `.env`):

- `DISCORD_TOKEN` (required)
  - The bot token from the Discord developer portal.

- `DISCORD_MAIN_CHANNEL_ID` (recommended)
  - Messages in this channel will be treated like the WhatsApp “main group” (respond to all).

- `DISCORD_ALLOWED_GUILD_IDS` (optional)
  - Comma-separated allowlist of guild IDs.

- `DISCORD_ALLOWED_CHANNEL_IDS` (optional)
  - Comma-separated allowlist of channel IDs.

Suggested “safe default” policy:
- If you do not set any allowlists, only accept DMs + the main channel.

## 7) Discord Developer Portal Setup

1) Create an application
- https://discord.com/developers/applications

2) Create a bot
- In your application, go to **Bot** → **Add Bot**.

3) Enable Message Content intent
- In **Bot** settings, enable:
  - **MESSAGE CONTENT INTENT**

4) Generate an invite URL
- Go to **OAuth2 → URL Generator**
- Scopes:
  - `bot`
- Bot permissions (minimum recommended):
  - Read Messages / View Channels
  - Send Messages
  - Read Message History
  - (Optional) Send Messages in Threads / Manage Threads if you use threads

5) Invite to your server
- Open the generated URL and authorize the bot.

## 8) Testing

1) Set environment variables

```bash
export DISCORD_TOKEN="..."
export DISCORD_MAIN_CHANNEL_ID="123..."
# Optional
export DISCORD_ALLOWED_GUILD_IDS="123...,456..."
export DISCORD_ALLOWED_CHANNEL_IDS="123...,456..."
```

2) Run NanoClaw

```bash
npm run dev
```

3) Verify behavior
- Send a DM to the bot → it should respond.
- Send a message in the main channel → it should respond.
- In a different channel:
  - If allowlisted, it will be ingested
  - It should only respond when you **mention** the bot (e.g. `@MyBot hello`).

## 9) Troubleshooting

- Bot connects but does not receive messages
  - Ensure **Message Content Intent** is enabled.
  - Ensure the bot has permissions to view the channel.
  - Ensure your allowlists are not blocking the guild/channel.

- `DISCORD_TOKEN does not look like a Discord bot token`
  - You likely pasted the wrong token (e.g., client secret). Re-copy the **bot token**.

- No responses in a guild channel
  - If `DISCORD_MAIN_CHANNEL_ID` is not set, the bot may only respond to mentions (depending on your routing).
  - If you set allowlists, make sure the channel is included.

- `Missing Access` / `Forbidden` errors when sending
  - The bot lacks permissions in that channel.
  - The bot may not be in the server.

- DMs not working
  - Ensure you enabled `GatewayIntentBits.DirectMessages` and `partials: [Partials.Channel]`.
  - The user might have server privacy settings disallowing DMs.
