import { DISCORD_TOKEN } from './config.js';

export function isDiscordEnabled(): boolean {
  return !!DISCORD_TOKEN && DISCORD_TOKEN.trim().length > 0;
}

export function assertDiscordTokenConfigured(): void {
  if (!isDiscordEnabled()) {
    throw new Error('Discord is enabled but DISCORD_TOKEN is missing/empty');
  }

  // Basic sanity check; Discord bot tokens are typically 3 dot-separated base64-ish segments.
  const token = DISCORD_TOKEN!.trim();
  if (token.split('.').length < 3) {
    // Not fatal, but surfaces common misconfig.
    // Keep as throw to fail fast if user accidentally pasted something else.
    throw new Error('DISCORD_TOKEN does not look like a Discord bot token (expected dot-separated segments)');
  }
}
