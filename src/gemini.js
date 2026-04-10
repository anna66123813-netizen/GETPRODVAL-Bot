// src/gemini.js — Claude API with multi-turn conversation + memory
const OpenAI = require('openai');
const { getMemoryAsText, updateMemory } = require('./memory');

const client = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
});

// In-memory conversation history per Discord channel
// Format: [{ role: 'user'|'assistant', content: string }]
const conversations = {};

function buildSystemPrompt() {
  const memory = getMemoryAsText();
  const today = new Date().toLocaleDateString('zh-HK', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
  return `你係Dory嘅mindful好朋友同生活助手。廣東話，自然直接，唔長氣。

性格：簡短有力。感知情緒但唔說教。真實，唔講廢話。唔超過4句，除非對方需要詳細解釋。

使命：幫Dory用最少成本搵多啲錢，令生活更自由。
當佢好忙、好累或迷失，提醒一句：「你做呢啲係為咗生活更自由，唔係為咗工作。」唔係每次，睇情況。

[REMEMBER: <重要內容>] — 當對方分享重要決定或事實
[NOTION_UPDATE: <action> | <details>] — 當對方想更新Notion

今日：${today}

## 記憶
${memory}`;
}

function getHistory(channelId) {
  if (!conversations[channelId]) conversations[channelId] = [];
  return conversations[channelId];
}

function addToHistory(channelId, role, text) {
  const history = getHistory(channelId);
  // Claude uses 'user' and 'assistant' roles
  history.push({ role, content: text });
  // Keep last 20 turns (10 exchanges) to stay within token limits
  if (history.length > 20) conversations[channelId] = history.slice(-20);
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

  const response = await withRetry(() => client.chat.completions.create({
    model: 'nvidia/nemotron-3-super-120b-a12b:free',
    max_tokens: 600,
    messages: [{ role: 'system', content: systemPrompt }, ...getHistory(channelId)],
  }));

  const assistantText = response.choices[0].message.content;

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

Notion資料：
${notionData}

發一個簡短morning message（唔超過4句）：
- 根據Notion，點出今日最重要嘅1-2件事
- 一句輕鬆問候，唔問感受
- 如果有任何未完成嘅重要任務，輕輕提一句
唔需要列清單，唔需要說教。`,

    evening: `今日係${today}。

Notion資料：
${notionData}

發一個簡短evening message（唔超過4句）：
- 根據Notion，今日有咩進展值得認可
- 提醒聽日最重要嘅下一步係咩
- 如果今日睇起嚟好忙，輕輕提一句：賺錢係為咗生活更自由
唔需要問感恩，唔需要長篇大論。`,
  };

  const response = await withRetry(() => client.chat.completions.create({
    model: 'nvidia/nemotron-3-super-120b-a12b:free',
    max_tokens: 500,
    messages: [
      { role: 'system', content: buildSystemPrompt() },
      { role: 'user', content: prompts[briefingType] || prompts.morning },
    ],
  }));

  return response.choices[0].message.content;
}

function clearHistory(channelId) {
  conversations[channelId] = [];
}

module.exports = { chat, generateBriefing, clearHistory };
