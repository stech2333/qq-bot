import fs from 'node:fs';import assert from 'node:assert/strict';
const html=fs.readFileSync(new URL('../public/console.html',import.meta.url),'utf8');
const nav=html.match(/<nav id="mainNav">([\s\S]*?)<\/nav>/)[1],pages=[...nav.matchAll(/data-view="([^"]+)"/g)].map(m=>m[1]);assert.deepEqual(pages,['overview','sessions','persona','learning','models','settings']);
for(const id of ['section-mode','section-sessions','section-activity','section-persona','section-usage','roleList','sessionList','usageChart'])assert.ok(html.includes('id="'+id+'"'),id);
assert.ok(!html.includes('id="section-social-v1"'));assert.ok(!html.includes('按群聊 / 私聊选择人格'));assert.ok(html.includes('select name="target"'));assert.ok(html.includes('/api/bigfatfish/contacts'));assert.ok(html.includes("typeof s.activity === 'string'"));
for(const s of html.matchAll(/<script>([\s\S]*?)<\/script>/g))new Function(s[1]);console.log('PASS original console preserved with V3 global changes and contact picker');
