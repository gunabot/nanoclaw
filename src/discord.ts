import {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  type Message,
  type TextBasedChannel
} from 'discord.js';

import {
  DISCORD_ALLOWED_CHANNEL_IDS,
  DISCORD_ALLOWED_GUILD_IDS,
  DISCORD_MAIN_CHANNEL_ID,
  DISCORD_TOKEN
} from './config.js';

export interface DiscordIncomingMessage {
  id: string;
  scopeId: string; // discord:<guildId>:<channelId> | discord:dm:<userId>
  timestamp: string;
  authorId: string;
  authorName: string;
  content: string;
  isDM: boolean;
  isMainChannel: boolean;
  isMentioned: boolean;
  channelName?: string;
  guildId?: string;
  channelId?: string;
}

let client: Client | null = null;

export function getDiscordClient(): Client {
  if (!client) throw new Error('Discord client not started');
  return client;
}

function isAllowed(message: Message): boolean {
  // Optional allowlists (defensive). If none provided, default to allowing only the main channel + DMs.
  if (!message.guild) return true; // DMs always allowed

  const guildId = message.guild.id;
  const channelId = message.channel.id;

  if (DISCORD_ALLOWED_GUILD_IDS.length > 0 && !DISCORD_ALLOWED_GUILD_IDS.includes(guildId)) return false;
  if (DISCORD_ALLOWED_CHANNEL_IDS.length > 0 && !DISCORD_ALLOWED_CHANNEL_IDS.includes(channelId)) return false;

  if (DISCORD_ALLOWED_GUILD_IDS.length === 0 && DISCORD_ALLOWED_CHANNEL_IDS.length === 0) {
    // Default lockdown: only main channel unless explicit allowlist set
    if (DISCORD_MAIN_CHANNEL_ID) return channelId === DISCORD_MAIN_CHANNEL_ID;
  }

  return true;
}

export function discordScopeFromMessage(message: Message): {
  scopeId: string;
  isDM: boolean;
  guildId?: string;
  channelId?: string;
} {
  if (message.guild) {
    return {
      scopeId: `discord:${message.guild.id}:${message.channel.id}`,
      isDM: false,
      guildId: message.guild.id,
      channelId: message.channel.id
    };
  }

  // DM: key on user id
  return {
    scopeId: `discord:dm:${message.author.id}`,
    isDM: true
  };
}

export async function startDiscord(options: {
  onIncomingMessage: (msg: DiscordIncomingMessage) => void | Promise<void>;
  logger?: { info: (...args: any[]) => void; warn: (...args: any[]) => void; error: (...args: any[]) => void; debug?: (...args: any[]) => void };
}): Promise<void> {
  if (!DISCORD_TOKEN) throw new Error('DISCORD_TOKEN not set');

  if (client) return; // already started

  const log = options.logger;

  client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages
    ],
    partials: [Partials.Channel]
  });

  client.on(Events.ClientReady, () => {
    log?.info({ user: client?.user?.tag }, 'Connected to Discord');
  });

  client.on(Events.Error, (err) => {
    log?.error({ err }, 'Discord client error');
  });

  client.on(Events.MessageCreate, async (message: Message) => {
    try {
      if (!client?.user) return;
      if (message.author.id === client.user.id) return;
      if (message.author.bot) return;
      if (!message.content) return;
      if (!isAllowed(message)) return;

      const { scopeId, isDM, guildId, channelId } = discordScopeFromMessage(message);
      const isMainChannel = !!DISCORD_MAIN_CHANNEL_ID && channelId === DISCORD_MAIN_CHANNEL_ID;
      const isMentioned = !isDM && message.mentions.has(client.user);

      const timestamp = message.createdAt.toISOString();
      const channelName = isDM
        ? 'DM'
        : ('name' in message.channel ? (message.channel as any).name as string : undefined);

      await options.onIncomingMessage({
        id: message.id,
        scopeId,
        timestamp,
        authorId: message.author.id,
        authorName: message.member?.displayName || message.author.username,
        content: message.content,
        isDM,
        isMainChannel,
        isMentioned,
        channelName,
        guildId,
        channelId
      });
    } catch (err) {
      log?.error({ err }, 'Error processing Discord message');
    }
  });

  await client.login(DISCORD_TOKEN);
}

export async function sendDiscordMessage(scopeId: string, text: string): Promise<void> {
  const c = getDiscordClient();

  if (scopeId.startsWith('discord:dm:')) {
    const userId = scopeId.slice('discord:dm:'.length);
    const user = await c.users.fetch(userId);
    const dm = await user.createDM();
    await dm.send(text);
    return;
  }

  if (!scopeId.startsWith('discord:')) throw new Error(`Not a Discord scopeId: ${scopeId}`);

  const rest = scopeId.slice('discord:'.length);
  const parts = rest.split(':');
  if (parts.length !== 2) throw new Error(`Invalid Discord scopeId: ${scopeId}`);

  const channelId = parts[1];
  const channel = await c.channels.fetch(channelId);
  if (!channel) throw new Error(`Discord channel not found: ${channelId}`);

  const textChannel = channel as unknown as TextBasedChannel;
  // TextBasedChannel has send()
  // @ts-expect-error discord.js type-narrowing across channel kinds
  await textChannel.send(text);
}

export async function setDiscordTyping(scopeId: string, isTyping: boolean): Promise<void> {
  if (!isTyping) return; // Discord typing is fire-and-forget; no explicit stop

  const c = getDiscordClient();

  if (scopeId.startsWith('discord:dm:')) {
    const userId = scopeId.slice('discord:dm:'.length);
    const user = await c.users.fetch(userId);
    const dm = await user.createDM();
    await dm.sendTyping();
    return;
  }

  const rest = scopeId.slice('discord:'.length);
  const parts = rest.split(':');
  if (parts.length !== 2) return;
  const channelId = parts[1];

  const channel = await c.channels.fetch(channelId);
  if (!channel) return;

  const textChannel = channel as unknown as TextBasedChannel;
  // @ts-expect-error typing on generic text-based channel
  await textChannel.sendTyping();
}
