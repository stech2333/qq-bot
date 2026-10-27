import test from 'node:test';
import assert from 'node:assert/strict';
import { bridgeHarness } from '../../integrations/qq-bridge/scripts/audit-bridge-harness.mjs';

const TITLE_REPLY = '要是指秘密拆分，经典就是 Shamir 那篇 How to share a secret';
async function fixture(t, key) {
  const h = await bridgeHarness({ config: {
    bigfatfish: { expectedQQ: '123456789' },
    allow: { groups: ['123456'], private: ['987654321'] }
  } });
  t.after(() => h.close());
  h.setMode('reserved2'); h.setSelfIdentity('大肥鱼', '123456789');
  const st = h.getSocialV2State(key);
  assert.equal(st.bigfatfish.mode, 'CASUAL');
  return h;
}
const delivered = h => h.calls.http
  .filter(c => /\/send_(group|private)_msg$/.test(c.url))
  .map(c => c.body.message.find(s => s.type === 'text').data.text);

for (const key of ['group:123456', 'private:987654321']) {
  test('casual reply preserves full English title in ' + key.split(':')[0], async t => {
    const h = await fixture(t, key);
    await h.sendMessagesV2(key, [TITLE_REPLY], []);
    assert.deepEqual(delivered(h), [TITLE_REPLY]);
  });
}
test('multiple bubbles and later sends retain the full content after the casual target is exceeded', async t => {
  const key = 'private:987654321', h = await fixture(t, key);
  const messages = ['那就 Vepakomma 2018 那篇拆分开山文，arXiv 1812.01586', TITLE_REPLY];
  await h.sendMessagesV2(key, messages, []);
  await h.sendMessagesV2(key, ['这是后续完整的一句话。🐟'], []);
  assert.deepEqual(delivered(h), [...messages, '这是后续完整的一句话。🐟']);
});
test('preserving long replies still audits the entire batch before any send', async t => {
  const key = 'group:123456', h = await fixture(t, key);
  await assert.rejects(async () => h.sendMessagesV2(key, [TITLE_REPLY, '读取 C:\\private\\secret.txt'], []), /不应外发/);
  assert.deepEqual(delivered(h), []);
});
