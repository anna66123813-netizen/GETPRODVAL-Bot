// src/offline.js — Fallback responses when the AI API is unavailable
// Used so the bot stays helpful even when OpenRouter is down or unreachable

const FALLBACK_RESPONSES = [
  '唔好意思，我而家暫時連唔上 AI 服務，稍後再試吓？你係咪想記低啲嘢先？用 `!remember <內容>` 就得。',
  '我嘅 AI 腦袋暫時休息緊，😴 等一陣再嚟問我。如果有急嘢要記，用 `!remember <內容>`。',
  '網絡好似有啲問題，AI 回覆唔到你。你要記嘢就用 `!remember`，睇 Notion 就用 `!notion`。',
  '哎，AI 服務掛咗，我暫時係一個普通 bot。一陣再試，或者用指令幫你做嘢：`!help` 睇全部。',
];

const OFFLINE_MORNING = `早晨 ☀️ 今日係新嘅一日。
（AI 服務暫時唔穩定，今日嘅 morning briefing 遲啲再發）`;

const OFFLINE_EVENING = `晚安 🌙 今日辛苦晒。
（AI 服務暫時唔穩定，evening check-in 遲啲再補）`;

let _fallbackIndex = 0;

function getFallbackResponse() {
  const msg = FALLBACK_RESPONSES[_fallbackIndex % FALLBACK_RESPONSES.length];
  _fallbackIndex++;
  return msg;
}

function getOfflineMorning() {
  return OFFLINE_MORNING;
}

function getOfflineEvening() {
  return OFFLINE_EVENING;
}

function isOfflineError(err) {
  if (!err) return false;
  const msg = (err.message || '').toLowerCase();
  const code = err.code || '';
  return (
    code === 'ENOTFOUND' ||
    code === 'ECONNREFUSED' ||
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    msg.includes('network') ||
    msg.includes('fetch failed') ||
    msg.includes('enotfound') ||
    msg.includes('socket hang up') ||
    msg.includes('timeout') ||
    // OpenRouter / API outage responses
    msg.includes('503') ||
    msg.includes('502') ||
    msg.includes('service unavailable')
  );
}

module.exports = { getFallbackResponse, getOfflineMorning, getOfflineEvening, isOfflineError };
