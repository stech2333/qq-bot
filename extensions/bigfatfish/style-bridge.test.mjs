import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { bridgeHarness } from '../../integrations/qq-bridge/scripts/audit-bridge-harness.mjs';
import * as roleCard from '../../integrations/qq-bridge/src/role-card.js';
import { personaSectionText, installPersonaSection } from '../../integrations/qq-bridge/plugins/qq-agent-presets/qq-persona.mjs';
import { createSlangEntry, upsertSlangEntry, normalizeSlangEntry, saveSlang, loadSlang } from '../../integrations/qq-bridge/src/slang-learner.js';
import { fixture, A, B, P } from './style-test-fixture.mjs';

test('real bridge intake attests human sources, assembles once, publishes card to system only', async t => {
  const h = await bridgeHarness({ config: { bigfatfish: { expectedQQ: '123456789' }, allow: { groups: ['123456'], private: [] }, socialV2: { sticker: { enabled: false } } },
    files: { 'roles/鱼.md': '# 鱼\n稳定的人格核心，不冒充真人。', 'state/current-role.json': { role: '鱼', mode: 'active' } }, globals: roleCard });
  t.after(() => h.close()); h.setMode('reserved2'); h.setSelfIdentity('测试机器人', '123456789');
  await h.handleIncoming('group', 123456, { self_id: '123456789', user_id: '111111', message_id: 1001, sender: { nickname: '虚拟群友' }, message: [{ type: 'text', data: { text: '肥鱼，今天聊聊天' } }] }, h.cfg);
  const rows = h.bff.learningWindow.messages(A, h.getSocialV2State(A)); assert.equal(rows[0].styleSourceVersion, 2); assert.equal(rows[0].sourceScope, A);
  const preview = h.buildWakePromptV2(A, 'addressed'); assert.equal(preview.split('【本轮表达参考】').length - 1, 1); assert.equal(preview.split('【当前角色卡】').length - 1, 1);
  await h.deliverPrompt(A, preview); const sessionId = h.calls.created.at(-1)?.sessionId || h.state.sessions[A];
  const system = personaSectionText(sessionId, h.temp); assert.match(system, /稳定的人格核心/);
  const sent = JSON.stringify(h.calls.prompts.at(-1)); assert.doesNotMatch(sent, /稳定的人格核心/); assert.match(sent, /本轮表达参考/); assert.equal(h.calls.sent.length, 0);
  const sections = []; installPersonaSection({ systemPrompt: { section: value => sections.push(value) } }); assert.equal(sections[0].interpolate, false); assert.equal(sections[0].name, 'bigfatfish:trusted-persona');
});

test('same-term legacy group meanings migrate into one word and pending senses without leaking',t=>{
 const f=fixture(t),file=path.join(f.root,'state/slang.json');const original=[{id:'a',content:'鱼塘',scope:A,meaning:'本群游戏频道',status:'confirmed'},{id:'b',content:'鱼塘',scope:B,meaning:'本群摄影讨论区',status:'confirmed'}];fs.writeFileSync(file,JSON.stringify(original));
 const migrated=loadSlang(file);assert.equal(migrated.length,2);assert.ok(migrated.every(e=>e.senses.length===1));assert.deepEqual(migrated.map(e=>e.scope),[A,B]);assert.ok(fs.existsSync(file+'.pre-v3.bak'));
 for(const key of [A,B,P])assert.deepEqual(f.app.slang.contextEntries(migrated,key,'help','鱼塘是什么'),[]);
});
