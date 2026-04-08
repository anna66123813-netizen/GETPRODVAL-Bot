// scripts/notion-audit.js — Audit Notion workspace structure
require('dotenv').config();
const { Client } = require('@notionhq/client');

if (!process.env.NOTION_API_KEY) {
  console.error('ERROR: NOTION_API_KEY is not set.');
  console.error('Usage: NOTION_API_KEY=secret_xxx node scripts/notion-audit.js');
  process.exit(1);
}

const notion = new Client({ auth: process.env.NOTION_API_KEY });

function printSeparator(char = '─', width = 60) {
  console.log(char.repeat(width));
}

function formatPropertySchema(properties) {
  const lines = [];
  for (const [name, prop] of Object.entries(properties)) {
    let detail = prop.type;
    if (prop.type === 'select' && prop.select?.options?.length) {
      const opts = prop.select.options.map(o => `"${o.name}"`).join(', ');
      detail += ` [${opts}]`;
    } else if (prop.type === 'multi_select' && prop.multi_select?.options?.length) {
      const opts = prop.multi_select.options.map(o => `"${o.name}"`).join(', ');
      detail += ` [${opts}]`;
    } else if (prop.type === 'status' && prop.status?.options?.length) {
      const opts = prop.status.options.map(o => `"${o.name}"`).join(', ');
      detail += ` [${opts}]`;
    } else if (prop.type === 'relation' && prop.relation?.database_id) {
      detail += ` → DB:${prop.relation.database_id.slice(0, 8)}...`;
    } else if (prop.type === 'formula' && prop.formula?.expression) {
      detail += ` (${prop.formula.expression.slice(0, 40)})`;
    }
    lines.push(`  • ${name}: ${detail}`);
  }
  return lines.join('\n');
}

function extractItemTitle(item) {
  return (
    item.properties?.Name?.title?.[0]?.plain_text ||
    item.properties?.title?.title?.[0]?.plain_text ||
    Object.values(item.properties || {}).find(p => p.type === 'title')?.title?.[0]?.plain_text ||
    'Untitled'
  );
}

function extractAllPropertyValues(properties) {
  const values = {};
  for (const [name, prop] of Object.entries(properties)) {
    if (prop.type === 'title') continue; // already shown as title
    let val;
    switch (prop.type) {
      case 'rich_text':
        val = prop.rich_text?.[0]?.plain_text || '';
        break;
      case 'select':
        val = prop.select?.name || '';
        break;
      case 'multi_select':
        val = prop.multi_select?.map(o => o.name).join(', ') || '';
        break;
      case 'status':
        val = prop.status?.name || '';
        break;
      case 'checkbox':
        val = prop.checkbox ? '☑ true' : '☐ false';
        break;
      case 'number':
        val = prop.number !== null ? String(prop.number) : '';
        break;
      case 'date':
        val = prop.date?.start || '';
        break;
      case 'people':
        val = prop.people?.map(p => p.name || p.id).join(', ') || '';
        break;
      case 'url':
        val = prop.url || '';
        break;
      case 'email':
        val = prop.email || '';
        break;
      case 'phone_number':
        val = prop.phone_number || '';
        break;
      case 'formula':
        val = String(prop.formula?.string || prop.formula?.number || prop.formula?.boolean || '');
        break;
      default:
        val = `(${prop.type})`;
    }
    if (val) values[name] = val;
  }
  return values;
}

async function auditNotion() {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║           NOTION WORKSPACE AUDIT REPORT                 ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  // ── 1. List all databases ──────────────────────────────────────────
  let databases = [];
  try {
    const response = await notion.search({
      filter: { value: 'database', property: 'object' },
    });
    databases = response.results;
  } catch (e) {
    console.error('Failed to list databases:', e.message);
    process.exit(1);
  }

  console.log(`DATABASES FOUND: ${databases.length}`);
  printSeparator('═');

  for (const db of databases) {
    const dbTitle = db.title?.[0]?.plain_text || 'Untitled Database';
    console.log(`\n📁 DATABASE: ${dbTitle}`);
    console.log(`   ID: ${db.id}`);
    console.log(`   URL: ${db.url}`);
    console.log(`   Last edited: ${new Date(db.last_edited_time).toLocaleString('zh-HK')}`);

    // Get full schema
    let schema;
    try {
      schema = await notion.databases.retrieve({ database_id: db.id });
    } catch (e) {
      console.log(`   (Could not retrieve schema: ${e.message})`);
      continue;
    }

    console.log('\n   PROPERTIES (Schema):');
    printSeparator('─', 50);
    console.log(formatPropertySchema(schema.properties));

    // Get sample items
    let items = [];
    try {
      const res = await notion.databases.query({ database_id: db.id, page_size: 5 });
      items = res.results;
    } catch (e) {
      console.log(`\n   (Could not query items: ${e.message})`);
    }

    console.log(`\n   SAMPLE ITEMS (first ${items.length}):`);
    printSeparator('─', 50);
    if (items.length === 0) {
      console.log('   (no items)');
    } else {
      for (const item of items) {
        const title = extractItemTitle(item);
        const vals = extractAllPropertyValues(item.properties);
        const valStr = Object.entries(vals)
          .map(([k, v]) => `${k}: ${v}`)
          .join(' | ');
        console.log(`   • ${title}${valStr ? `  →  ${valStr}` : ''}`);
      }
    }
    printSeparator('═');
  }

  // ── 2. Recent pages ────────────────────────────────────────────────
  let pages = [];
  try {
    const response = await notion.search({
      filter: { value: 'page', property: 'object' },
      sort: { direction: 'descending', timestamp: 'last_edited_time' },
      page_size: 10,
    });
    pages = response.results;
  } catch (e) {
    console.error('Failed to list pages:', e.message);
  }

  console.log(`\n📄 RECENTLY UPDATED PAGES (${pages.length}):`);
  printSeparator('═');
  if (pages.length === 0) {
    console.log('  (none found)');
  } else {
    for (const page of pages) {
      const title =
        page.properties?.title?.title?.[0]?.plain_text ||
        page.properties?.Name?.title?.[0]?.plain_text ||
        Object.values(page.properties || {}).find(p => p.type === 'title')?.title?.[0]?.plain_text ||
        'Untitled';
      const edited = new Date(page.last_edited_time).toLocaleString('zh-HK');
      console.log(`  • ${title}  (last edited: ${edited})`);
      console.log(`    ID: ${page.id}  |  URL: ${page.url}`);
    }
  }

  console.log('\n✅ Audit complete.\n');
}

auditNotion().catch(e => {
  console.error('Unexpected error:', e.message);
  process.exit(1);
});
