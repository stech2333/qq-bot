import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { bridgeHarness } from '../../integrations/qq-bridge/scripts/audit-bridge-harness.mjs';

const BOT = '123456789', TOKEN = 'cross-fixture-token';

async function fixture(t, { tools = {} } = {}) {
  let handler;
  const server = { address: () => ({ port: 3106 }), listen(_p, _h, cb) { cb(); }, on() {} };
  const h = await bridgeHarness({
    config: { consolePort: 3106, consoleToken: TOKEN, ownerQQ: '987654321',
      allow: { groups: ['123456'], private: ['987654321'] }, bigfatfish: { expectedQQ: BOT },
      socialV2: { sticker: { enabled: false }, tools } },
    globals: { http: { createServer(cb) { handler = cb; return server; } } }
  });
  t.after(() => h.close());
  h.setMode('reserved2'); h.setSelfIdentity('肥鱼', BOT); h.startConsoleServer();
  const tokenFor = key => h.getSocialV2State(key).agentToken;
  const call = async (route, body, token) => {
    const req = Readable.from([JSON.stringify(body)]);
    Object.assign(req, { url: route, method: 'POST', headers: { host: '127.0.0.1:3106', 'content-type': 'application/json',
      'x-console-token': TOKEN, ...(token ? { 'x-agent-token': token } : {}) } });
    let response; await handler(req, { writeHead() {}, on() {}, off() {}, end(raw) { response = JSON.parse(raw); } });
    return response;
  };
  return { h, call, tokenFor };
}

test('the model can record a person once and it is shared across groups by QQ id', async t => {
  const { h, call, tokenFor } = await fixture(t);
  // 必须先"见过"这个人才有号码可记：inbound 时会自动把人写进群友簿。
  await h.handleIncoming('group', 123456, { self_id: BOT, user_id: '111111', message_id: 'm1',
    message: [{ type: 'text', data: { text: '肥鱼在吗' } }], sender: { nickname: '山鬼' } }, h.cfg);
  assert.equal(h.bff.people.find('111111').nickname, '山鬼');
  const first = await call('/api/socialV2/people/remember', { key: 'group:123456', who: '111111', note: '爱用「典」，说话很短' }, tokenFor('group:123456'));
  assert.equal(first.ok, true, first.error);
  // 同一个人在私聊里也能读到这份印象（身份按 QQ 号合并）。
  assert.match(h.bff.people.summary('111111'), /爱用「典」/);
  assert.equal(h.bff.people.find('山鬼').qq, '111111');
});

test('common memory keeps the source scope it was written from', async t => {
  const { h, call, tokenFor } = await fixture(t);
  h.getSocialV2State('private:987654321');
  const res = await call('/api/socialV2/common-memory/remember',
    { key: 'private:987654321', note: '私聊里说周五要交论文', category: '约定' }, tokenFor('private:987654321'));
  assert.equal(res.ok, true, res.error);
  assert.equal(res.entry.scope, 'private');
  assert.equal(res.entry.category, '约定');
  assert.match(h.bff.commonMemory.digest('private', '论文 周五'), /约定/);
  assert.equal(h.bff.commonMemory.digest('group', '论文 周五', '123456'), '', '私聊内容不能进群');
});

test('cross-session tools respect agent tokens, allowlists and tool switches', async t => {
  const { h, call, tokenFor } = await fixture(t, { tools: { commonMemory: false } });
  h.getSocialV2State('group:123456');
  const noToken = await call('/api/socialV2/people/remember', { key: 'group:123456', who: '111111', note: 'x' });
  assert.equal(noToken.ok, false); assert.match(noToken.error, /agent token/);
  const wrong = await call('/api/socialV2/people/remember', { key: 'group:123456', who: '111111', note: 'x' }, 'nope');
  assert.equal(wrong.ok, false); assert.match(wrong.error, /无效/);
  // 不在允许范围内的会话
  const outside = await call('/api/socialV2/common-memory/remember', { key: 'group:999999', note: 'x' }, tokenFor('group:123456'));
  assert.equal(outside.ok, false);
  // 开关关掉的工具必须拒绝（而不是静默写入）
  const disabled = await call('/api/socialV2/common-memory/remember', { key: 'group:123456', note: 'x' }, tokenFor('group:123456'));
  assert.equal(disabled.ok, false); assert.match(disabled.error, /未启用/);
});
