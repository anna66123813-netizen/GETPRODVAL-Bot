// src/gemini.js — Vertex AI (Gemini) with multi-turn conversation + memory
const { VertexAI } = require('@google-cloud/vertexai');
const { getMemoryAsText, updateMemory } = require('./memory');

// Parse service account credentials from Railway env var
const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);

const vertexAI = new VertexAI({
  project: credentials.project_id,
  location: 'us-central1',
  googleAuthOptions: { credentials },
});

const MODEL = 'gemini-2.0-flash-lite-001';

// In-memory conversation history per Discord channel
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

當對方想更新Notion，輸出以下格式之一（可同時輸出多個）：
[NOTION_UPDATE: create_task | <database名稱> | <任務標題> | <備注（可選）>]
[NOTION_UPDATE: complete | <任務標題關鍵字>]
[NOTION_UPDATE: update_status | <任務標題關鍵字> | <新狀態>]
[NOTION_UPDATE: add_note | <任務標題關鍵字> | <備注內容>]

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
  history.push({ role, content: text });
  // Keep last 20 turns (10 exchanges)
  if (history.length > 20) conversations[channelId] = history.slice(-20);
}

async function chat(channelId, userMessage, extraContext = '') {
  const systemPrompt = buildSystemPrompt()
    + (extraContext ? `\n\n## Current Notion Data\n${extraContext}` : '');

  const history = getHistory(channelId);

  // Convert history to Vertex AI format (role: 'user'|'model')
  const vertexHistory = history.map(msg => ({
    role: msg.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: msg.content }],
  }));

  const model = vertexAI.getGenerativeModel({
    model: MODEL,
    systemInstruction: systemPrompt,
    generationConfig: { maxOutputTokens: 600 },
  });

  const chatSession = model.startChat({ history: vertexHistory });
  const result = await chatSession.sendMessage(userMessage);
  const assistantText = result.response.candidates[0].content.parts[0].text;

  addToHistory(channelId, 'user', userMessage);
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

以下係從Notion database讀取嘅**真實資料**：
---
${notionData}
---

發一個簡短morning brief（唔超過5句）：
1. 輕鬆問候一句
2. 列出今日待辦／未完成任務（最多3件，用真實名稱）
3. 如果有狀態資訊，反映實際進度
唔需要說教，只根據真實資料回覆。`,

    evening: `今日係${today}。

以下係從Notion database讀取嘅**真實資料**：
---
${notionData}
---

發一個簡短evening check-in（唔超過5句）：
1. 今日實際有咩任務完成或更新
2. 提醒聽日最重要嘅下一步
3. 如果任務好多，輕輕一句：賺錢係為咗生活更自由
唔好憑空捏造任何內容。`,
  };

  const model = vertexAI.getGenerativeModel({
    model: MODEL,
    systemInstruction: buildSystemPrompt(),
    generationConfig: { maxOutputTokens: 500 },
  });

  const result = await model.generateContent(prompts[briefingType] || prompts.morning);
  return result.response.candidates[0].content.parts[0].text;
}

function clearHistory(channelId) {
  conversations[channelId] = [];
}

module.exports = { chat, generateBriefing, clearHistory };
