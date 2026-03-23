// src/scheduler.js — Morning briefing + evening check-in
const { getWorkspaceSummary } = require('./notion');
const { generateBriefing } = require('./gemini');
const { updateMemory } = require('./memory');

// Split long messages for Discord's 2000 char limit
function splitMessage(text, maxLen = 1900) {
  if (text.length <= maxLen) return [text];
  const parts = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) { parts.push(remaining); break; }
    let splitAt = remaining.lastIndexOf('\n', maxLen);
    if (splitAt === -1) splitAt = maxLen;
    parts.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trim();
  }
  return parts;
}

async function fetchNotionData() {
  try {
    return await getWorkspaceSummary();
  } catch (e) {
    console.error('Notion fetch error:', e.message);
    return '_Could not fetch Notion data. Check your NOTION_API_KEY and integration permissions._';
  }
}

async function createDailyBriefing(channel) {
  const today = new Date().toLocaleDateString('zh-HK', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  console.log(`[${new Date().toISOString()}] Sending morning briefing...`);
  await channel.send(`☀️ **Good morning! — ${today}**\n_Checking your Notion workspace..._`);

  const notionData = await fetchNotionData();
  const briefing = await generateBriefing(notionData, 'morning');
  updateMemory({ lastBriefingDate: today });

  const parts = splitMessage(`📋 **Daily Briefing:**\n\n${briefing}`);
  for (const part of parts) await channel.send(part);
  await channel.send('---\n💬 _Reply anytime to chat or update your tasks._');
}

async function createEveningCheckin(channel) {
  const today = new Date().toLocaleDateString('zh-HK', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  console.log(`[${new Date().toISOString()}] Sending evening check-in...`);
  await channel.send(`🌙 **Evening Check-in — ${today}**\n_Reviewing your day..._`);

  const notionData = await fetchNotionData();
  const checkin = await generateBriefing(notionData, 'evening');

  const parts = splitMessage(`📊 **End-of-Day Summary:**\n\n${checkin}`);
  for (const part of parts) await channel.send(part);
  await channel.send('---\n🌙 _Rest well! See you tomorrow morning._');
}

module.exports = { createDailyBriefing, createEveningCheckin, splitMessage };
