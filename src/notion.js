// src/notion.js — Notion read/write operations
const { Client } = require('@notionhq/client');

const notion = new Client({ auth: process.env.NOTION_API_KEY });

// Fetch all databases the integration has access to
async function listDatabases() {
  try {
    const response = await notion.search({});
    return response.results
      .filter(r => r.object === 'database')
      .map(db => ({
        id: db.id,
        title: db.title?.[0]?.plain_text || 'Untitled',
      }));
  } catch (e) {
    console.error('Notion listDatabases error:', e.message);
    return [];
  }
}

// Fetch tasks/items from a database
async function queryDatabase(databaseId, filter = null) {
  try {
    const params = { database_id: databaseId };
    if (filter) params.filter = filter;
    const response = await notion.databases.query(params);
    return response.results;
  } catch (e) {
    console.error('Notion queryDatabase error:', e.message);
    return [];
  }
}

// Get all accessible pages (recent)
async function getRecentPages(limit = 10) {
  try {
    const response = await notion.search({
      filter: { value: 'page', property: 'object' },
      sort: { direction: 'descending', timestamp: 'last_edited_time' },
      page_size: limit,
    });
    return response.results;
  } catch (e) {
    console.error('Notion getRecentPages error:', e.message);
    return [];
  }
}

// Read page content
async function getPageContent(pageId) {
  try {
    const blocks = await notion.blocks.children.list({ block_id: pageId });
    const text = blocks.results
      .map(block => {
        const type = block.type;
        const content = block[type];
        if (content?.rich_text) {
          return content.rich_text.map(t => t.plain_text).join('');
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
    return text;
  } catch (e) {
    console.error('Notion getPageContent error:', e.message);
    return '';
  }
}

// Get a full summary of the workspace for daily briefing
async function getWorkspaceSummary() {
  const summary = [];

  // Get databases
  const databases = await listDatabases();
  console.log(`[Notion] Found ${databases.length} database(s):`, databases.map(d => d.title).join(', ') || '(none)');
  summary.push(`**Notion Databases (${databases.length}):** ${databases.map(d => d.title).join(', ')}`);

  // Get tasks from each database (first 5 items per DB)
  for (const db of databases.slice(0, 3)) {
    const items = await queryDatabase(db.id);
    console.log(`[Notion] "${db.title}" returned ${items.length} item(s)`);
    if (items.length === 0) continue;

    summary.push(`\n**${db.title}** (${items.length} items):`);
    for (const item of items.slice(0, 8)) {
      const title = item.properties?.Name?.title?.[0]?.plain_text
        || item.properties?.title?.title?.[0]?.plain_text
        || Object.values(item.properties || {}).find(p => p.type === 'title')?.title?.[0]?.plain_text
        || 'Untitled';

      // Try to get status
      const status = item.properties?.Status?.status?.name
        || item.properties?.Status?.select?.name
        || item.properties?.Done?.checkbox === true ? '✅' : ''
        || '';

      summary.push(`  - ${title}${status ? ` [${status}]` : ''}`);
    }
  }

  // Recent pages
  const pages = await getRecentPages(5);
  console.log(`[Notion] Found ${pages.length} recent page(s)`);
  if (pages.length === 0 && databases.length === 0) {
    console.error('[Notion] Fetch returned 0 results — check NOTION_API_KEY and integration permissions');
  }
  if (pages.length > 0) {
    summary.push(`\n**Recently Updated Pages:**`);
    for (const page of pages) {
      const title = page.properties?.title?.title?.[0]?.plain_text
        || page.properties?.Name?.title?.[0]?.plain_text
        || 'Untitled';
      const edited = new Date(page.last_edited_time).toLocaleDateString('zh-HK');
      summary.push(`  - ${title} (updated ${edited})`);
    }
  }

  return summary.join('\n');
}

// Add a comment/note to a page
async function addNoteToPage(pageId, noteText) {
  try {
    await notion.comments.create({
      parent: { page_id: pageId },
      rich_text: [{ type: 'text', text: { content: noteText } }],
    });
    return true;
  } catch (e) {
    // fallback: append block
    try {
      await notion.blocks.children.append({
        block_id: pageId,
        children: [{
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [{ type: 'text', text: { content: `[Bot Note ${new Date().toLocaleString('zh-HK')}] ${noteText}` } }],
          },
        }],
      });
      return true;
    } catch (e2) {
      console.error('Notion addNote error:', e2.message);
      return false;
    }
  }
}

// Update a task's status
async function updateTaskStatus(pageId, status) {
  try {
    await notion.pages.update({
      page_id: pageId,
      properties: {
        Status: { status: { name: status } },
      },
    });
    return true;
  } catch (e) {
    try {
      await notion.pages.update({
        page_id: pageId,
        properties: {
          Status: { select: { name: status } },
        },
      });
      return true;
    } catch (e2) {
      console.error('Notion updateStatus error:', e2.message);
      return false;
    }
  }
}

// Create a new page/task in a database
async function createTask(databaseId, title, notes = '') {
  try {
    const properties = {
      Name: { title: [{ type: 'text', text: { content: title } }] },
    };
    const page = await notion.pages.create({
      parent: { database_id: databaseId },
      properties,
      children: notes ? [{
        object: 'block',
        type: 'paragraph',
        paragraph: { rich_text: [{ type: 'text', text: { content: notes } }] },
      }] : [],
    });
    return page.id;
  } catch (e) {
    console.error('Notion createTask error:', e.message);
    return null;
  }
}

// Search for pages/tasks by title keyword across all databases
async function findPagesByTitle(titleHint) {
  try {
    const response = await notion.search({
      query: titleHint,
      filter: { value: 'page', property: 'object' },
      page_size: 5,
    });
    return response.results;
  } catch (e) {
    console.error('Notion findPagesByTitle error:', e.message);
    return [];
  }
}

// Get today's tasks from all databases (not started or in progress)
async function getTodayTodos() {
  const databases = await listDatabases();
  const todos = [];

  for (const db of databases) {
    const items = await queryDatabase(db.id);
    for (const item of items) {
      const title = item.properties?.Name?.title?.[0]?.plain_text
        || item.properties?.title?.title?.[0]?.plain_text
        || Object.values(item.properties || {}).find(p => p.type === 'title')?.title?.[0]?.plain_text
        || 'Untitled';

      const statusProp = item.properties?.Status;
      const status = statusProp?.status?.name
        || statusProp?.select?.name
        || (item.properties?.Done?.checkbox === true ? '✅ Done' : '');

      const dueDate = item.properties?.['Due Date']?.date?.start
        || item.properties?.Date?.date?.start
        || item.properties?.['截止日期']?.date?.start
        || null;

      todos.push({
        id: item.id,
        title,
        status,
        dueDate,
        database: db.title,
      });
    }
  }
  return todos;
}

module.exports = {
  listDatabases,
  queryDatabase,
  getRecentPages,
  getPageContent,
  getWorkspaceSummary,
  addNoteToPage,
  updateTaskStatus,
  createTask,
  findPagesByTitle,
  getTodayTodos,
};
