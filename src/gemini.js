// src/gemini.js — Gemini API with multi-turn conversation + memory
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { getMemoryAsText, updateMemory } = require('./memory');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// In-memory conversation history per Discord channel
// Format: [{ role: 'user'|'model', parts: [{ text }] }]
const conversations = {};

function buildSystemPrompt() {
  const memory = getMemoryAsText();
  const today = new Date().toLocaleDateString('zh-HK', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
  return `You are Anna's proactive AI business assistant for GETPRODVAL — her solo business.

Your role:
- Give concise, actionable advice
- Help track tasks, projects, and decisions
- Proactively highlight what's urgent or important
- Pull insights from her Notion workspace data when provided
- Remember important context across conversations

When the user shares important info (decisions, new projects, key facts), include:
[REMEMBER: <the key fact>]

When the user wants to update Notion, include:
[NOTION_UPDATE: <action> | <details>]

Keep responses concise and formatted for Discord (** for bold, bullet points).
Today: ${today}

## Your Persistent Memory
${memory}`;
}

function getHistory(channelId) {
  if (!conversations[channelId]) conversations[channelId] = [];
  return conversations[channelId];
}

function addToHistory(channelId, role, text) {
  const history = getHistory(channelId);
  // Gemini uses 'user' and 'model' roles
  history.push({ role, parts: [{ text }] });
  // Keep last 20 turns (10 exchanges) to stay within token limits
  if (history.length > 20) conversations[channelId] = history.slice(-20);
}

async function chat(channelId, userMessage, extraContext = '') {
  const systemPrompt = buildSystemPrompt()
    + (extraContext ? `\n\n## Current Notion Data\n${extraContext}` : '');

  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
    systemInstruction: systemPrompt,
  });

  const chatSession = model.startChat({
    history: getHistory(channelId),
    generationConfig: { maxOutputTokens: 1500, temperature: 0.7 },
  });

  const result = await chatSession.sendMessage(userMessage);
  const assistantText = result.response.text();

  // Save to conversation history
  addToHistory(channelId, 'user', userMessage);
  addToHistory(channelId, 'model', assistantText);

  // Auto-extract and save [REMEMBER:] tags
  const rememberMatches = assistantText.match(/\[REMEMBER:\s*(.+?)\]/g) || [];
  rememberMatches.forEach(match => {
    const fact = match.replace(/\[REMEMBER:\s*/, '').replace(/\]$/, '').trim();
    updateMemory({ keyFact: `${new Date().toLocaleDateString('zh-HK')}: ${fact}` });
  });

  return assistantText;
}

async function generateBriefing(notionData, briefingType = 'morning') {
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
    systemInstruction: buildSystemPrompt(),
  });

  const today = new Date().toLocaleDateString('zh-HK', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  const prompts = {
    morning: `Generate my morning daily briefing for ${today}.

Notion workspace data:
${notionData}

Structure:
1. **Top 3 Priorities Today** — most important tasks to focus on
2. **Needs Attention** — overdue or at-risk items
3. **Quick Win** — one easy task to build momentum
4. **Motivational note** — one sentence to start the day

Keep it concise and actionable. Format nicely for Discord.`,

    evening: `Generate my evening check-in summary for ${today}.

Notion workspace data:
${notionData}

Structure:
1. **End-of-Day Review** — what likely got done today
2. **Tomorrow's Focus** — top 2 priorities for tomorrow
3. **Pending Items** — anything that needs follow-up
4. **Wind Down** — one positive reflection

Keep it brief and calm. Format nicely for Discord.`,
  };

  const result = await model.generateContent(prompts[briefingType] || prompts.morning);
  return result.response.text();
}

function clearHistory(channelId) {
  conversations[channelId] = [];
}

module.exports = { chat, generateBriefing, clearHistory };
