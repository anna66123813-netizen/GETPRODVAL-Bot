// src/bot.js — Discord message handler
const { chat, clearHistory } = require('./gemini');
const { getWorkspaceSummary, listDatabases, findPagesByTitle, createTask, updateTaskStatus, addNoteToPage } = require('./notion');
const { updateMemory, loadMemory, saveMemory } = require('./memory');
const { splitMessage, createDailyBriefing, createEveningCheckin } = require('./scheduler');

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
// Supported formats:
//   [NOTION_UPDATE: create_task | <db_name_hint> | <task_title> | <optional_notes>]
//   [NOTION_UPDATE: complete | <task_title_hint>]
//   [NOTION_UPDATE: update_status | <task_title_hint> | <new_status>]
//   [NOTION_UPDATE: add_note | <task_title_hint> | <note_text>]
async function handleNotionCommands(text) {
  const commands = text.match(/\[NOTION_UPDATE:[^\]]+\]/g) || [];
  const results = [];

  for (const cmd of commands) {
    const inner = cmd.replace(/^\[NOTION_UPDATE:\s*/, '').replace(/\]$/, '');
    const parts = inner.split('|').map(p => p.trim());
    const action = parts[0]?.toLowerCase();

    console.log('[Notion] Executing command:', action, parts.slice(1));

    try {
      if (action === 'create_task') {
        const [, dbHint, title, notes = ''] = parts;
        // Find matching database by name hint
        const databases = await listDatabases();
        const db = databases.find(d => d.title.toLowerCase().includes(dbHint?.toLowerCase() || ''))
          || databases[0];
        if (!db) { results.push('❌ 搵唔到Notion database'); continue; }
        const pageId = await createTask(db.id, title, notes);
        results.push(pageId ? `✅ 已新增任務「${title}」到 ${db.title}` : `❌ 新增任務失敗`);

      } else if (action === 'complete') {
        const [, titleHint] = parts;
        const pages = await findPagesByTitle(titleHint);
        if (!pages.length) { results.push(`❌ 搵唔到「${titleHint}」`); continue; }
        const ok = await updateTaskStatus(pages[0].id, 'Done');
        results.push(ok ? `✅ 已標記「${titleHint}」為完成` : `❌ 更新失敗`);

      } else if (action === 'update_status') {
        const [, titleHint, status] = parts;
        const pages = await findPagesByTitle(titleHint);
        if (!pages.length) { results.push(`❌ 搵唔到「${titleHint}」`); continue; }
        const ok = await updateTaskStatus(pages[0].id, status);
        results.push(ok ? `✅ 已更新「${titleHint}」狀態為 ${status}` : `❌ 更新失敗`);

      } else if (action === 'add_note') {
        const [, titleHint, note] = parts;
        const pages = await findPagesByTitle(titleHint);
        if (!pages.length) { results.push(`❌ 搵唔到「${titleHint}」`); continue; }
        const ok = await addNoteToPage(pages[0].id, note);
        results.push(ok ? `✅ 已喺「${titleHint}」加入備注` : `❌ 新增備注失敗`);

      } else {
        console.warn('[Notion] Unknown action:', action);
      }
    } catch (e) {
      console.error('[Notion] Command error:', e.message);
      results.push(`❌ Notion操作出錯: ${e.message}`);
    }
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

  if (content.toLowerCase() === '!morning') {
    await withTyping(message.channel, () => createDailyBriefing(message.channel));
    return;
  }

  if (content.toLowerCase() === '!evening') {
    await withTyping(message.channel, () => createEveningCheckin(message.channel));
    return;
  }

  if (content.toLowerCase() === '!help') {
    await message.channel.send(`**🤖 GETPRODVAL Bot Commands:**

💬 **Just chat** — Ask me anything about your business
📋 \`!notion\` — Show your Notion workspace summary
🧠 \`!memory\` — Show what I remember about you
💾 \`!remember <fact>\` — Manually save a key fact
🚀 \`!project <name>\` — Add an ongoing project
☀️ \`!morning\` — Trigger morning briefing now
🌙 \`!evening\` — Trigger evening check-in now
🗑️ \`!clear\` — Clear conversation history
❓ \`!help\` — Show this help message`);
    return;
  }

  // Regular chat with Claude
  try {
    // Always fetch Notion data when user might be updating or asking about tasks
    const needsNotion = /notion|task|todo|project|update|status|database|完成|新增|待辦|進度|done|finish/i.test(content);
    let extraContext = '';
    if (needsNotion) {
      extraContext = await getWorkspaceSummary().catch(() => '');
    }

    const reply = await withTyping(message.channel, () =>
      chat(channelId, content, extraContext)
    );

    // Execute any Notion write commands in the reply
    const notionResults = await handleNotionCommands(reply);

    // Remove [REMEMBER:...] and [NOTION_UPDATE:...] tags from displayed reply
    const cleanReply = reply
      .replace(/\[REMEMBER:[^\]]*\]/g, '')
      .replace(/\[NOTION_UPDATE:[^\]]*\]/g, '')
      .trim();

    // Send reply (split if too long, skip if empty after tag removal)
    if (cleanReply) {
      const parts = splitMessage(cleanReply);
      for (const part of parts) {
        await message.channel.send(part);
      }
    }

    // Send Notion operation results if any
    if (notionResults.length > 0) {
      await message.channel.send(notionResults.join('\n'));
    }

  } catch (error) {
    console.error('Message handler error:', error);
    await message.reply(`❌ Sorry, something went wrong: ${error.message}`);
  }
}

module.exports = { handleMessage };
