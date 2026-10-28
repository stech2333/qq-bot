// reserved2 提示词与插件边界的静态契约；不调用模型，不向 QQ 发送消息。
// 这些检查只能防止关键协议/能力被误删，不能证明聊天质量无损。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import yaml from 'js-yaml';

const preset = yaml.load(fs.readFileSync(
  new URL('../dsh/agent-presets/qq-chat-v2/agent.cordis.yml', import.meta.url), 'utf8',
));
const persona = preset.find((row) => row.id === 'persona');
const prefix = persona?.config?.prefix ?? '';

test('reserved2 YAML resolves to the expected persona and template variables', () => {
  assert.equal(persona?.name, '@deepseek-ai/dsh-persona');
  assert.match(prefix, /\{\{model\}\}/);
  // DSH 0.2.1 起 agent loop 只注册 provider / model 两个提示词变量（0.2.0 还有 cwd），
  // 未知变量会让 system prompt 装配直接抛错 ⇒ 每回合 error、模型一次都不跑。
  // 这里钉住「只用已注册变量」，而不只是「有 {{model}}」。
  const used = [...JSON.stringify(persona.config).matchAll(/\{\{([a-z][a-z0-9_]*)\}\}/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(used)].filter((v) => !['provider', 'model'].includes(v)), []);
  assert.equal(Object.hasOwn(persona.config, 'text'), false);
});

test('local/admin tool restrictions and existing compaction budgets stay intact', () => {
  assert.deepEqual(preset.map((row) => row.id), [
    'persona', 'tool-web', 'tool-ask-user', 'tool-todo', 'qq-tool-restrict', 'compaction',
  ]);
  assert.deepEqual(preset.find((row) => row.id === 'tool-web').config, { search: false, fetch: false });
  assert.equal(preset.find((row) => row.id === 'qq-tool-restrict').name, './qq-tool-restrict.mjs');
  const compaction = preset.find((row) => row.id === 'compaction');
  assert.deepEqual(compaction.isolate, { compaction: true, toolResultPruner: true });
  assert.deepEqual(compaction.config.find((row) => row.id === 'tool-result-pruner').config, {
    thresholdChars: 50000, headChars: 45000, tailChars: 2000,
  });
  for (const text of ['你没有本地工具', '群友没有管理权限', 'API 令牌', '角色由桥接注入']) {
    assert.ok(prefix.includes(text), `missing safety rule: ${text}`);
  }
});

test('snapshot receipts, recipient limits and server-managed closing are described without forced five minute waits',()=>{
 for(const value of ['本次消息快照','partial=true','afterSeq=readThroughSeq','本地seq水位','不是QQ messageId','throughSeq','purpose="reply"','没有待答消息','token','当前会话'])assert.ok(prefix.includes(value),value);
 assert.doesNotMatch(prefix,/timeoutMs=300000/);assert.match(prefix,/不必先强制等待五分钟/);
});
test('image, forward, sticker, voice and public search capabilities remain discoverable with safety limits',()=>{
 for(const value of ['qq_get_message_images','qq_get_forward_msg','nestedForwardIds','qq_send_poke','qq_list_stickers','qq_get_sticker_image','qq_send_sticker','qq_collect_sticker','qq_sticker_note','qq_get_self_image','qq_set_sticker_remark','只有管理端明确开启','qq_list_voices','qq_send_voice','语音默认关闭','verified=true','web_search','web_fetch'])assert.ok(prefix.includes(value),value);
});
test('current-member memory, evidence, global learning and silence rules are retained',()=>{
 for(const value of ['sourceMessageId','factKey','群内各成员分开','未确认推断','不注入整库','没有合适切入点就沉默','triggers.speakerIds','不凭记忆乱填'])assert.ok(prefix.includes(value),value);
});
console.log(`reserved2 persona prefix: ${prefix.length} characters (not model tokens)`);
