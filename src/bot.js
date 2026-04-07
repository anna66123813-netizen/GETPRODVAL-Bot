// src/bot.js — Discord message handler
const { chat, clearHistory } = require('./gemini');
const { getWorkspaceSummary, listDatabases } = require('./notion');
const { updateMemory, loadMemory, saveMemory } = require('./memory');
const { splitMessage } = require('./scheduler');
const { isOfflineError } = require('./offline');

// Show typing indicator while generating
async function withTyping(channel, fn) {
  const typing = setInterval(() => channel.sendTyping(), 5000);
  channel.sendTyping();
  try {
    return await fn();
  } finally {
    clearInterval(typing);
  }
}

// Parse and execute Notion update commands from AI response
async function handleNotionCommands(text) {
  const commands = text.match(/\[NOTION_UPDATE:.*?\]/g) || [];
  const results = [];
  for (const cmd of commands) {
    const inner = cmd.replace('[NOTION_UPDATE:', '').replace(']', '');
    const parts = inner.split('|').map(p => p.trim());
    results.push(`_Notion: ${parts.join(', ')}_`);
    // Actual execution would happen here based on the command type
    // For now, acknowledge and log
    console.log('Notion command:', parts);
  }
  return results;
}

async function handleMessage(message) {
  const content = message.content.trim();
  const channelId = message.channelId;

  // Show typing immediately
  await message.channel.sendTyping();

  // Special commands
  if (content.toLowerCase() === '!clear') {
    clearHistory(channelId);
    await message.reply('🗑️ Conversation history cleared. Starting fresh!');
    return;
  }

  if (content.toLowerCase() === '!memory') {
    const mem = loadMemory();
    const memText = `**📚 My Memory:**\n\`\`\`json\n${JSON.stringify(mem, null, 2)}\n\`\`\``;
    const parts = splitMessage(memText);
    for (const part of parts) await message.channel.send(part);
    return;
  }

  if (content.toLowerCase() === '!notion') {
    await withTyping(message.channel, async () => {
      const summary = await getWorkspaceSummary();
      const parts = splitMessage(`**📋 Your Notion Workspace:**\n${summary}`);
      for (const part of parts) await message.channel.send(part);
    });
    return;
  }

  if (content.toLowerCase().startsWith('!remember ')) {
    const fact = content.slice(10).trim();
    updateMemory({ keyFact: fact });
    await message.reply(`✅ Got it! I'll remember: _"${fact}"_`);
    return;
  }

  if (content.toLowerCase().startsWith('!project ')) {
    const project = content.slice(9).trim();
    updateMemory({ ongoingProjects: project });
    await message.reply(`✅ Added to ongoing projects: _"${project}"_`);
    return;
  }

  if (content.toLowerCase() === '!help') {
    await message.channel.send(`**🤖 GETPRODVAL Bot Commands:**

💬 **Just chat** — Ask me anything about your business
📋 \`!notion\` — Show your Notion workspace summary
🧠 \`!memory\` — Show what I remember about you
💾 \`!remember <fact>\` — Manually save a key fact
🚀 \`!project <name>\` — Add an ongoing project
🗑️ \`!clear\` — Clear conversation history
❓ \`!help\` — Show this help message`);
    return;
  }

  // Regular chat with Claude
  try {
    // Check if user is asking about Notion — fetch data if so
    const needsNotion = /notion|task|todo|project|update|status|database/i.test(content);
    let extraContext = '';
    if (needsNotion) {
      extraContext = await getWorkspaceSummary().catch(() => '');
    }

    const reply = await withTyping(message.channel, () =>
      chat(channelId, content, extraContext)
    );

    // Handle any Notion update commands in the reply
    await handleNotionCommands(reply);

    // Remove [REMEMBER:...] and [NOTION_UPDATE:...] tags from displayed reply
    const cleanReply = reply
      .replace(/\[REMEMBER:.*?\]/g, '')
      .replace(/\[NOTION_UPDATE:.*?\]/g, '')
      .trim();

    // Send reply (split if too long)
    const parts = splitMessage(cleanReply);
    for (const part of parts) {
      await message.channel.send(part);
    }

  } catch (error) {
    console.error('Message handler error:', error);
    if (isOfflineError(error)) {
      await message.reply('🔌 而家連唔上 AI 服務，稍後再試吓。你嘅訊息未有回覆，記得再問一次。');
    } else {
      await message.reply(`❌ 出咗啲問題：${error.message}`);
    }
  }
}

module.exports = { handleMessage };
