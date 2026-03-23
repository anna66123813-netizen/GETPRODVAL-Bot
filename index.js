// index.js — GETPRODVAL AI Assistant Bot
// Architecture: event-driven — zero CPU between Discord events/schedules
// Only active during: (1) morning briefing, (2) evening check-in, (3) user messages
require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const cron = require('node-cron');
const { handleMessage } = require('./src/bot');
const { createDailyBriefing, createEveningCheckin } = require('./src/scheduler');

// Validate required environment variables
const required = ['DISCORD_BOT_TOKEN', 'DISCORD_CHANNEL_ID', 'GEMINI_API_KEY', 'NOTION_API_KEY'];
const missing = required.filter(key => !process.env[key]);
if (missing.length > 0) {
  console.error(`❌ Missing environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once('ready', async () => {
  console.log(`✅ Bot online as ${client.user.tag}`);

  let channel;
  try {
    channel = await client.channels.fetch(process.env.DISCORD_CHANNEL_ID);
  } catch (e) {
    console.error(`❌ Cannot find Discord channel: ${e.message}`);
    console.error('Check DISCORD_CHANNEL_ID and that the bot has been added to the server.');
    return;
  }
  if (!channel) {
    console.error('❌ Channel returned null. Check DISCORD_CHANNEL_ID.');
    return;
  }

  // ── Schedule 1: Morning Briefing (default 9:00 AM HKT = 1:00 AM UTC) ──
  const morningUTC = parseInt(process.env.MORNING_HOUR_UTC ?? '1');
  cron.schedule(`0 ${morningUTC} * * *`, () => createDailyBriefing(channel));
  console.log(`⏰ Morning briefing: ${(morningUTC + 8) % 24}:00 HKT`);

  // ── Schedule 2: Evening Check-in (default 9:00 PM HKT = 13:00 UTC) ──
  const eveningUTC = parseInt(process.env.EVENING_HOUR_UTC ?? '13');
  cron.schedule(`0 ${eveningUTC} * * *`, () => createEveningCheckin(channel));
  console.log(`🌙 Evening check-in: ${(eveningUTC + 8) % 24}:00 HKT`);

  // ── Between schedules: bot idles in Discord's event loop (no polling) ──
  // Node.js async I/O means 0% CPU usage while waiting for events.
  // Railway usage: ~30–40 MB RAM × 720 hrs ≈ $0.01–0.02/month.

  await channel.send(`🤖 **GETPRODVAL Assistant is online!**\nType \`!help\` to see commands.`);
});

// ── Message handler — only fires when user actually sends a message ──
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (message.channelId !== process.env.DISCORD_CHANNEL_ID) return;
  await handleMessage(message);
});

client.on('error', (err) => console.error('Discord error:', err.message));
process.on('unhandledRejection', (err) => console.error('Unhandled rejection:', err));

client.login(process.env.DISCORD_BOT_TOKEN);
