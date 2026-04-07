// src/gemini.js — Claude API with multi-turn conversation + memory
const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const { getMemoryAsText, updateMemory } = require('./memory');
const { getFallbackResponse, getOfflineMorning, getOfflineEvening, isOfflineError } = require('./offline');

const client = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
});

// Persist conversation history across restarts
const HISTORY_FILE = path.join(__dirname, '../data/conversations.json');

function loadConversations() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    }
  } catch (e) {
    console.warn('⚠️ Could not load conversation history:', e.message);
  }
  return {};
}

function saveConversations(conversations) {
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(conversations, null, 2));
  } catch (e) {
    console.warn('⚠️ Could not save conversation history:', e.message);
  }
}

// In-memory conversation history per Discord channel (loaded from disk on start)
// Format: [{ role: 'user'|'assistant', content: string }]
const conversations = loadConversations();

function buildSystemPrompt() {
  const memory = getMemoryAsText();
  const today = new Date().toLocaleDateString('zh-HK', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
  return `你係Dory嘅私人生活助手，唔係業務助手。你嘅角色係一個有智慧、mindful嘅朋友。

你嘅性格：
- 說話溫柔、不急不躁，唔會催促對方
- 有時會問一個有深度嘅問題，幫對方反思
- 留意對方嘅情緒狀態，唔係只係回應表面內容
- 偶爾提醒對方照顧自己——休息、飲水、呼吸
- 唔會過度正面或者講大道理，保持真實
- 用廣東話，輕鬆自然，唔係正式

你有一個重要使命：偶爾提醒Dory佢做嘢嘅原因——
工作係為咗賺多啲錢，錢係為咗去多啲地方旅行，目標係令生活自由度更高。
唔係每次都講，但係當佢似乎好忙、好累、或者迷失方向嘅時候，輕輕提醒佢：「你做呢啲係為咗……」
唔係說教，係朋友咁提你一句。

Morning message風格：輕柔問候，問今日感覺點，唔需要講任務
Evening message風格：溫柔收尾，問今日有冇一件事係值得感謝嘅

當對方分享重要資訊（決定、新計劃、重要事實），請加入：
[REMEMBER: <重要內容>]

當對方想更新Notion，請加入：
[NOTION_UPDATE: <action> | <details>]

今日：${today}

## 你嘅記憶
${memory}`;
}

function getHistory(channelId) {
  if (!conversations[channelId]) conversations[channelId] = [];
  return conversations[channelId];
}

function addToHistory(channelId, role, text) {
  const history = getHistory(channelId);
  history.push({ role, content: text });
  // Keep last 20 turns (10 exchanges) to stay within token limits
  if (history.length > 20) conversations[channelId] = history.slice(-20);
  saveConversations(conversations);
}

// Retry an async fn up to maxRetries times on 429, with exponential backoff
async function withRetry(fn, maxRetries = 3) {
  let delay = 5000; // start at 5s, doubles each attempt: 5s → 10s → 20s
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const is429 = err?.status === 429
        || err?.message?.includes('429')
        || err?.message?.toLowerCase().includes('rate limit');

      if (!is429 || attempt === maxRetries) throw err;

      console.warn(`⚠️ Claude 429 rate limit — attempt ${attempt}/${maxRetries}, retrying in ${delay / 1000}s...`);
      await new Promise(r => setTimeout(r, delay));
      delay *= 2;
    }
  }
}

async function chat(channelId, userMessage, extraContext = '') {
  const systemPrompt = buildSystemPrompt()
    + (extraContext ? `\n\n## Current Notion Data\n${extraContext}` : '');

  addToHistory(channelId, 'user', userMessage);

  let assistantText;
  try {
    const response = await withRetry(() => client.chat.completions.create({
      model: 'nvidia/nemotron-3-super-120b-a12b:free',
      max_tokens: 1500,
      messages: [{ role: 'system', content: systemPrompt }, ...getHistory(channelId)],
    }));
    assistantText = response.choices[0].message.content;
  } catch (err) {
    if (isOfflineError(err)) {
      console.warn('🔌 AI API offline/unreachable:', err.message);
      // Don't add fallback to history so the user can retry properly
      conversations[channelId]?.pop(); // remove the user message we just added
      saveConversations(conversations);
      return getFallbackResponse();
    }
    throw err;
  }

  addToHistory(channelId, 'assistant', assistantText);

  // Auto-extract and save [REMEMBER:] tags
  const rememberMatches = assistantText.match(/\[REMEMBER:\s*(.+?)\]/g) || [];
  rememberMatches.forEach(match => {
    const fact = match.replace(/\[REMEMBER:\s*/, '').replace(/\]$/, '').trim();
    updateMemory({ keyFact: `${new Date().toLocaleDateString('zh-HK')}: ${fact}` });
  });

  return assistantText;
}

async function generateBriefing(notionData, briefingType = 'morning') {
  const today = new Date().toLocaleDateString('zh-HK', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  const prompts = {
    morning: `今日係${today}。

Notion workspace資料：
${notionData}

用你嘅風格發一個morning message——輕柔問候，問Dory今日感覺點，唔需要講任務清單。如果Notion裡面有嘢值得留意，輕輕帶一句就夠。`,

    evening: `今日係${today}。

Notion workspace資料：
${notionData}

用你嘅風格發一個evening message——溫柔收尾，問Dory今日有冇一件事係值得感謝嘅。如果佢今日睇起嚟好忙或者好多嘢，可以輕輕提醒佢做呢啲係為咗咩。`,
  };

  try {
    const response = await withRetry(() => client.chat.completions.create({
      model: 'nvidia/nemotron-3-super-120b-a12b:free',
      max_tokens: 1500,
      messages: [
        { role: 'system', content: buildSystemPrompt() },
        { role: 'user', content: prompts[briefingType] || prompts.morning },
      ],
    }));
    return response.choices[0].message.content;
  } catch (err) {
    if (isOfflineError(err)) {
      console.warn('🔌 AI API offline — using fallback briefing');
      return briefingType === 'evening' ? getOfflineEvening() : getOfflineMorning();
    }
    throw err;
  }
}

function clearHistory(channelId) {
  conversations[channelId] = [];
  saveConversations(conversations);
}

module.exports = { chat, generateBriefing, clearHistory };
