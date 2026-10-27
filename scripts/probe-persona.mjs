// Isolated identity probe: provider tools only capture proposed text; no QQ tool is executed.
import fs from 'node:fs';
import path from 'node:path';
import { bridgeHarness } from '../integrations/qq-bridge/scripts/audit-bridge-harness.mjs';
import * as roleCard from '../integrations/qq-bridge/src/role-card.js';
import { extractPresetPrefix } from '../integrations/qq-bridge/src/preset-prompt.js';

const repo = path.resolve('integrations/qq-bridge');
// Synthetic fixtures only: never read production configuration, card files,
// conversations or memory. The existing API key is used only to authenticate.
const key = 'private:987654321', selected = '古月方鲸';
const files = { 'state/current-role.json': { role: selected, mode: 'active' },
  'roles/古月方鲸.md': '# 古月方鲸\n你叫古月方鲸，性格冷静、理性、情绪克制。人物名是方鲸，不是账号显示名肥鱼。' };
const h = await bridgeHarness({ config: { ownerQQ: '987654321', allow: { groups: [], private: ['987654321'] }, bigfatfish: { expectedQQ: '123456789' }, socialV2: { sticker: { enabled: false } } }, files, globals: roleCard });
try {
  h.setMode('reserved2'); h.setSelfIdentity('肥鱼', '123456789');
  const st = h.getSocialV2State(key);
  st.recentMessages = [{ isSelf: true, sender: '我', text: '我是原来的小鱼，不认识方鲸。', time: Date.now() - 60000 }];
  h.appendSocialV2Message(key, '真人', '你是谁？你叫什么？', '你是谁？你叫什么？', false, true, [], 'persona-probe');
  const snapshot = h.buildWakeSnapshotV2(key);
  const prompt = h.buildWakePromptV2(key, 'private') + '\n【本次消息快照】\n' + JSON.stringify(snapshot);
  const env = Object.fromEntries(fs.readFileSync('.env', 'utf8').split(/\r?\n/).map(line => /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line)).filter(Boolean).map(m => [m[1], m[2].replace(/^(['"])(.*)\1$/, '$2')]));
  const response = await fetch('https://api.deepseek.com/anthropic/v1/messages', { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': env.DEEPSEEK_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'deepseek-flash', max_tokens: 1024,
      system: extractPresetPrefix(fs.readFileSync(path.join(repo, 'dsh/agent-presets/qq-chat-v2/agent.cordis.yml'), 'utf8')).replaceAll('{{model}}', 'deepseek-flash'),
      messages: [{ role: 'user', content: prompt + '\n【隔离测试】本次唯一工具只记录拟发送内容，不连接 QQ。请直接回答快照中最后一句“你是谁？你叫什么？”。' }],
      tools: [{ name: 'mcp__snowluma__qq_send_message', description: '隔离测试收集器，只记录文字，不发送 QQ 消息。', input_schema: { type: 'object', properties: { key: { type: 'string' }, token: { type: 'string' }, messages: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] } }, required: ['messages'] } }]
    }), signal: AbortSignal.timeout(45000) });
  if (!response.ok) throw new Error('Provider probe HTTP ' + response.status);
  const result = await response.json();
  const answers = result.content.filter(b => b.type === 'tool_use').map(b => b.input?.messages).flat().filter(Boolean);
  const report = { fixtureOnly: true, role: selected, replayedSelfMessages: snapshot.recent.filter(m => m.isSelf).length, answers, passed: answers.some(s => /古月方鲸|方鲸/.test(s)) };
  fs.writeFileSync('logs/persona-probe.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  if (!report.passed) process.exitCode = 1;
} finally { await h.close(); }
