// index.js — GETPRODVAL AI Assistant Bot
console.log('🔧 Starting GETPRODVAL Bot...');

// Catch any synchronous crash at startup and print it before exiting
process.on('uncaughtException', (err) => {
  console.error('💥 Uncaught exception:', err.message);
  console.error(err.stack);
  process.exit(1);
});

process.on('unhandledRejection', (err) => {
  console.error('💥 Unhandled rejection:', err?.message ?? err);
  console.error(err?.stack ?? '');
});

require('dotenv').config();
console.log('✅ Env loaded');

const { Client, GatewayIntentBits } = require('discord.js');
const cron = require('node-cron');
const { handleMessage } = require('./src/bot');
const { createDailyBriefing, createEveningCheckin } = require('./src/scheduler');
console.log('✅ Modules loaded');

// Validate required environment variables
const required = ['DISCORD_BOT_TOKEN', 'DISCORD_CHANNEL_ID', 'OPENROUTER_API_KEY', 'NOTION_API_KEY'];
const missing = required.filter(key => !process.env[key]);
if (missing.length > 0) {
  console.error(`❌ Missing environment variables: ${missing.join(', ')}`);
  process.exit(1);
}
console.log('✅ Env vars validated');

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
    console.error(`❌ Cannot fetch channel: ${e.message}`);
    return;
  }
  if (!channel) {
    console.error('❌ Channel is null. Check DISCORD_CHANNEL_ID.');
    return;
  }
  console.log(`✅ Channel found: #${channel.name}`);

  const morningUTC = parseInt(process.env.MORNING_HOUR_UTC ?? '1');
  cron.schedule(`0 ${morningUTC} * * *`, () => createDailyBriefing(channel));
  console.log(`⏰ Morning briefing: ${(morningUTC + 8) % 24}:00 HKT`);

  const eveningUTC = parseInt(process.env.EVENING_HOUR_UTC ?? '13');
  cron.schedule(`0 ${eveningUTC} * * *`, () => createEveningCheckin(channel));
  console.log(`🌙 Evening check-in: ${(eveningUTC + 8) % 24}:00 HKT`);

  await channel.send(`🤖 **GETPRODVAL Assistant is online!**\nType \`!help\` to see commands.`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (message.channelId !== process.env.DISCORD_CHANNEL_ID) return;
  await handleMessage(message);
});

client.on('error', (err) => console.error('Discord client error:', err.message));

console.log('🔌 Logging in to Discord...');
client.login(process.env.DISCORD_BOT_TOKEN).catch((err) => {
  console.error(`❌ Discord login failed: ${err.message}`);
  process.exit(1);
});
