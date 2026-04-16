// src/scheduler.js — Morning briefing + evening check-in
const { getPageContent } = require('./notion');

// CCR Routine 中轉站 Page ID（CCR 9:05am 寫入，Bot 9:10am 讀取發送）
const BRIEFING_PAGE_ID = '344e22b4-d2f2-81c0-9270-fb72d08c4880';

async function sendBriefingFromNotion(channel) {
  console.log(`[${new Date().toISOString()}] Fetching CCR briefing from Notion...`);
  const content = await getPageContent(BRIEFING_PAGE_ID);
  if (!content || content.trim().length < 10) {
    console.warn('[Briefing] Notion page empty — CCR may not have run yet.');
    return;
  }
  const parts = splitMessage(content);
  for (const part of parts) await channel.send(part);
  console.log('[Briefing] Sent to Discord successfully.');
}

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

async function createDailyBriefing(channel) {
  const today = new Date().toLocaleDateString('zh-HK', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  console.log(`[${new Date().toISOString()}] Sending morning reminder...`);
  await channel.send(
    `☀️ **早晨 — ${today}**\n\n` +
    `去 Claude 查看今日進度，確認優先任務。\n` +
    `_Take a breath. One thing at a time._`
  );
}

async function createEveningCheckin(channel) {
  const today = new Date().toLocaleDateString('zh-HK', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  console.log(`[${new Date().toISOString()}] Sending evening reminder...`);
  await channel.send(
    `🌙 **晚上覆盤 — ${today}**\n\n` +
    `去 Claude 匯報今日進度，記錄完成咗咩、卡喺邊度。\n` +
    `_Reflect, record, then rest._`
  );
}

module.exports = { createDailyBriefing, createEveningCheckin, sendBriefingFromNotion, splitMessage };
