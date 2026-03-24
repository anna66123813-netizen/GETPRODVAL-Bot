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
    model: 'meta-llama/llama-3.1-8b-instruct:free',
    max_tokens: 1500,
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

  const response = await withRetry(() => client.chat.completions.create({
    model: 'meta-llama/llama-3.1-8b-instruct:free',
    max_tokens: 1500,
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
