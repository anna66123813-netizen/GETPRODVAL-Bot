// scripts/cleanup-finance-db.js
// 1. 刪除所有現有記錄
// 2. 重設主要分類、次要分類選項
// 3. 清空店家/品牌選項
const { Client } = require('@notionhq/client');

const notion = new Client({ auth: process.env.NOTION_API_KEY });

// 花費支出紀錄表 — data source (collection) ID
const COLLECTION_ID = '2d8e22b4-d2f2-81ff-8d67-000b7f915e54';

async function archiveAllRecords() {
  console.log('📦 Step 1: Archiving all records...');
  let cursor;
  let total = 0;
  do {
    const res = await notion.dataSources.query({
      data_source_id: COLLECTION_ID,
      start_cursor: cursor,
      page_size: 100,
    });
    for (const page of res.results) {
      await notion.pages.update({ page_id: page.id, archived: true });
      total++;
      process.stdout.write(`\r  Archived ${total} records...`);
    }
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  console.log(`\n  ✅ Done. Archived ${total} records.`);
}

async function updateSchema() {
  console.log('\n🔧 Step 2: Updating database schema...');

  await notion.dataSources.update({
    data_source_id: COLLECTION_ID,
    properties: {
      '主要分類': {
        select: {
          options: [
            { name: '固定支出',     color: 'default' },
            { name: '健康醫療',     color: 'pink'    },
            { name: '個人網路訂閱', color: 'brown'   },
          ],
        },
      },
      '次要分類': {
        multi_select: {
          options: [
            { name: '固定支出-網路費',        color: 'default' },
            { name: '固定支出-管理費',        color: 'default' },
            { name: '固定支出-電費',          color: 'default' },
            { name: '固定支出-水費',          color: 'default' },
            { name: '固定支出-美股ETF定投',   color: 'green'   },
            { name: '健康醫療-保險',          color: 'pink'    },
            { name: '個人網路訂閱-Claude',    color: 'purple'  },
            { name: '個人網路訂閱-Notion',    color: 'brown'   },
            { name: '個人網路訂閱-Gemini',    color: 'blue'    },
          ],
        },
      },
      '店家 / 品牌': {
        select: {
          options: [],
        },
      },
    },
  });

  console.log('  ✅ Schema updated.');
}

async function main() {
  try {
    await archiveAllRecords();
    await updateSchema();
    console.log('\n🎉 All done!');
  } catch (e) {
    console.error('\n❌ Error:', e.message);
    if (e.body) console.error('Details:', JSON.stringify(e.body, null, 2));
    process.exit(1);
  }
}

main();
