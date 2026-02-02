# NanoClaw – Phase 5: Discord integration plan

Goal: add Discord as an additional message channel alongside WhatsApp. WhatsApp behavior must remain intact.

## High-level design

- Run **two inbound transports** in the same Node process:
  - WhatsApp (existing Baileys socket)
  - Discord (new `discord.js` v14 client)
- Convert inbound messages from either transport into the existing internal shape (`NewMessage`) + a `chat_jid` string.
- Reuse the existing **IPC + container agent execution model**:
  - Build an XML-ish prompt from recent messages (`getMessagesSince`)
  - Call `runContainerAgent(...)`
  - Send the response back via the originating transport
- Persist message history for Discord using the existing SQLite schema:
  - Store Discord chats in `chats` table with `jid = discord:<guildId>:<channelId>` or `discord:dm:<userId>`
  - Store Discord messages in `messages` table with `chat_jid = scopeId`

## Discord scope IDs

- Guild channels: `discord:<guildId>:<channelId>`
- Direct messages: `discord:dm:<userId>`

These are treated just like WhatsApp JIDs inside the DB and router.

## Trigger pattern / routing behavior

- **Main Discord channel**: configurable by `DISCORD_MAIN_CHANNEL_ID`
  - Respond to all user messages (except messages authored by the bot itself).
- **Other Discord channels**:
  - Respond only when the bot is **@mentioned**.
- **DMs**:
  - Respond to all user messages.

(WhatsApp behavior remains unchanged: main group responds to all; non-main groups require `TRIGGER_PATTERN` like `@Andy`.)

## Config additions

Add to `src/config.ts`:

- `DISCORD_TOKEN` (string | undefined)
- `DISCORD_MAIN_CHANNEL_ID` (string | undefined)
- `DISCORD_ALLOWED_GUILD_IDS` (string[]; optional allowlist)
- `DISCORD_ALLOWED_CHANNEL_IDS` (string[]; optional allowlist)

Runtime behavior:
- If `DISCORD_TOKEN` is not set → Discord is disabled, process runs WhatsApp-only.

## Files to add

- `src/discord.ts`
  - Creates `discord.js` client
  - Registers `messageCreate` handler
  - Exposes:
    - `startDiscord({ onIncomingMessage })`
    - `sendDiscordMessage(scopeId, text)`
    - `setDiscordTyping(scopeId, isTyping)`
    - helper: `discordScopeFromMessage(...)`

- `src/discord-auth.ts`
  - Small helper to validate presence/shape of bot token and warn early.

## Files to change

- `package.json`
  - Add dependency: `discord.js@^14`

- `src/types.ts`
  - Add explicit types for Discord scope IDs:
    - `DiscordGuildScopeId`, `DiscordDMScopeId`, `DiscordScopeId`

- `src/db.ts`
  - Add a new function `storeDiscordMessage(...)` that inserts into `messages` table (no Baileys proto dependency).

- `src/index.ts`
  - Start Discord client (if enabled) **in addition** to WhatsApp.
  - Refactor `sendMessage(...)` and typing indicator to route by `chat_jid` prefix:
    - `discord:*` → Discord send
    - otherwise → WhatsApp send
  - Add a Discord inbound pipeline that:
    - stores metadata + message content
    - applies trigger rules
    - builds prompt from DB
    - runs agent
    - replies in Discord

## Testing / validation

- `npm install`
- `npm run build`
- (Optional manual smoke test)
  - Set `DISCORD_TOKEN` and `DISCORD_MAIN_CHANNEL_ID`
  - Run `npm run dev`
  - Send a message in the main channel; bot should respond.
  - Send a message in another channel mentioning the bot; bot should respond.
