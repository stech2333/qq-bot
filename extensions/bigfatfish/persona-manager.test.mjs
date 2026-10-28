import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { bridgeHarness } from '../../integrations/qq-bridge/scripts/audit-bridge-harness.mjs';
import { PersonaManager } from './persona-manager.mjs';
import * as roleCard from '../../integrations/qq-bridge/src/role-card.js';

const TOKEN = 'persona-fixture-admin-token';
async function fixture(t) {
  let handler;
  const server = { address: () => ({ port: 3106 }), listen(_port, _host, ready) { ready(); }, on() {} };
  const h = await bridgeHarness({ config: {
    consolePort: 3106, consoleToken: TOKEN, bigfatfish: { expectedQQ: '123456789' },
    allow: { groups: ['123456', '123457'], private: ['987654321'] }, socialV2: { sticker: { enabled: false } }
  }, files: {
    'roles/轻松.md': '# 轻松\n喜欢幽默和轻松表达。\n## 专用 〔一代〕\n一代特有标记\n## 专用 〔二代〕\n二代特有标记',
    'roles/认真.md': '# 认真\n回答严谨，解释清晰。',
    'state/current-role.json': { role: '轻松', mode: 'active' }
  }, globals: { ...roleCard, http: { createServer(callback) { handler = callback; return server; } } } });
  t.after(() => h.close()); h.setMode('reserved2'); h.setSelfIdentity('大肥鱼', '123456789'); h.startConsoleServer();
  const call = async (url, body, headers = {}) => {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    Object.assign(req, { url, method: body === undefined ? 'GET' : 'POST', headers: {
      host: '127.0.0.1:3106', 'x-console-token': TOKEN, ...(body ? { 'content-type': 'application/json' } : {}), ...headers
    } });
    let status, data; const res = { writeHead(code) { status = code; }, end(text) { data = JSON.parse(text); } };
    await handler(req, res); return { status, ...data };
  };
  const bind = async (key, mode, role) => {
    const snapshot = await call('/api/bigfatfish/personas');
    return call('/api/bigfatfish/personas', { key, mode, role, revision: snapshot.revision });
  };
  const prompt = async key => { const result = await call('/api/socialV2/prompt?key=' + encodeURIComponent(key)); assert.equal(result.ok, true, result.error); return result; };
  return { h, call, bind, prompt };
}


test('one global role is used in every group/private prompt and changes together',async t=>{
 const {call,prompt,bind}=await fixture(t);
 assert.equal((await bind('group:123456','template','认真')).ok,false);
 assert.equal((await call('/api/role',{role:'认真'})).ok,true);
 for(const key of ['group:123456','group:123457','private:987654321']){const p=await prompt(key);assert.equal(p.role.name,'认真');assert.match(p.role.hint,/回答严谨/);}
 assert.equal((await call('/api/bigfatfish/personas',{}, {'x-agent-token':'model'})).status,403);
});
test('global template rename, edit and delete still work through authenticated APIs',async t=>{
 const {call,prompt}=await fixture(t);await call('/api/role',{role:'认真'});
 assert.equal((await call('/api/roles/rename',{from:'认真',to:'耐心'})).ok,true);assert.equal((await prompt('group:123456')).role.name,'耐心');
 await call('/api/roles/update',{name:'耐心',content:'# 耐心\n清楚准确的新模板正文'});assert.match((await prompt('group:123457')).role.hint,/新模板正文/);
 assert.equal((await call('/api/roles/delete',{name:'耐心'})).ok,true);assert.equal((await prompt('private:987654321')).role.name,null);
});
test('legacy bindings are backed up and preserved only as archives',async t=>{
 const {h}=await fixture(t),file=path.join(h.temp,'state/bigfatfish-personas.json');fs.writeFileSync(file,JSON.stringify({version:1,revision:2,bindings:{'group:123456':'认真'}}));
 const manager=new PersonaManager({root:h.temp});assert.equal(manager.resolve('group:123456',{role:'轻松'}).role,'轻松');assert.ok(fs.existsSync(file+'.pre-v3.bak'));assert.equal(manager.data.bindings['group:123456'],'认真');
});
