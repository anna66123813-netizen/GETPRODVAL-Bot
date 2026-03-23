// src/memory.js — Persistent cross-session memory
const fs = require('fs');
const path = require('path');

const MEMORY_FILE = path.join(__dirname, '../data/memory.json');

function loadMemory() {
  if (!fs.existsSync(MEMORY_FILE)) {
    const initial = {
      businessContext: 'GETPRODVAL is my solo business.',
      keyFacts: [],
      ongoingProjects: [],
      lastBriefingDate: null,
      importantDecisions: [],
    };
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
  return JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8'));
}

function saveMemory(data) {
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(data, null, 2));
}

function getMemoryAsText() {
  const mem = loadMemory();
  let text = `## My Business Context\n${mem.businessContext}\n\n`;

  if (mem.keyFacts.length > 0) {
    text += `## Key Facts\n${mem.keyFacts.map(f => `- ${f}`).join('\n')}\n\n`;
  }
  if (mem.ongoingProjects.length > 0) {
    text += `## Ongoing Projects\n${mem.ongoingProjects.map(p => `- ${p}`).join('\n')}\n\n`;
  }
  if (mem.importantDecisions.length > 0) {
    text += `## Recent Decisions\n${mem.importantDecisions.slice(-5).map(d => `- ${d}`).join('\n')}\n\n`;
  }
  if (mem.lastBriefingDate) {
    text += `## Last Briefing\n${mem.lastBriefingDate}\n`;
  }
  return text;
}

function updateMemory(updates) {
  const mem = loadMemory();
  if (updates.keyFact) {
    mem.keyFacts = [...(mem.keyFacts || []), updates.keyFact].slice(-20);
  }
  if (updates.project) {
    mem.ongoingProjects = [...(mem.ongoingProjects || []), updates.project].slice(-10);
  }
  if (updates.decision) {
    mem.importantDecisions = [...(mem.importantDecisions || []), updates.decision].slice(-10);
  }
  if (updates.businessContext) {
    mem.businessContext = updates.businessContext;
  }
  if (updates.lastBriefingDate) {
    mem.lastBriefingDate = updates.lastBriefingDate;
  }
  saveMemory(mem);
}

module.exports = { loadMemory, saveMemory, getMemoryAsText, updateMemory };
