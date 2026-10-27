import test from 'node:test';
import assert from 'node:assert/strict';
import { bridgeHarness } from '../../integrations/qq-bridge/scripts/audit-bridge-harness.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+k3ioAAAAASUVORK5CYII=', 'base64');
// Two frames: sending must keep the original GIF bytes, without model preview conversion.
const GIF = Buffer.from('47494638396101000100800000000000ffffff21ff0b4e45545343415045322e30030100000021f904000a0000002c000000000100010000020244010021f904000a0000002c00000000010001000002024c01003b', 'hex');

async function fixture(t, image, globals = {}) {
  const h = await bridgeHarness({
    config: { bigfatfish: { expectedQQ: '123456789' },
      allow: { groups: ['123456'], private: ['987654321'] } },
    globals: { safeFetchBuffer: async () => ({ buffer: image }), ...globals }
  });
  t.after(() => h.close());
  h.setMode('reserved2');
  h.setSelfIdentity('大肥鱼', '123456789');
  return h;
}

for (const [name, key, image, options] of [
  ['group static favorite with reply and mention', 'group:123456', PNG, { replyToMessageId: '-123', atUserId: '987654321' }],
  ['private animated favorite', 'private:987654321', GIF, {}]
]) {
  test(name + ' retains QQ sticker display and original bytes', async t => {
    const h = await fixture(t, image);
    const sent = await h.sendStickerV2(key, 'fixture-sticker', options);
    const calls = h.calls.http.filter(c => /\/send_(group|private)_msg$/.test(c.url));
    assert.equal(calls.length, 1);
    const { body } = calls[0];
    assert.equal(body[key.startsWith('group:') ? 'group_id' : 'user_id'], Number(key.split(':')[1]));
    const images = body.message.filter(s => s.type === 'image');
    assert.equal(images.length, 1);
    assert.equal(images[0].data.sub_type, 1, 'QQ must receive a custom face rather than a normal picture (sub_type=0)');
    assert.equal(images[0].data.summary, '[动画表情]');
    assert.equal(images[0].data.file, 'base64://' + image.toString('base64'));
    assert.equal(images[0].data.emoji_id, undefined, 'favorite IDs must not be interpreted as market-face IDs');
    assert.equal(body.message.some(s => s.type === 'text'), false);
    if (options.replyToMessageId) assert.equal(body.message.find(s => s.type === 'reply').data.id, '-123');
    if (options.atUserId) assert.equal(body.message.find(s => s.type === 'at').data.qq, '987654321');
    assert.equal(sent.messageId, 9001);
    assert.equal(sent.entry.useCount, 1);
  });
}

test('failed favorite download never sends or marks it used', async t => {
  const h = await fixture(t, GIF, { safeFetchBuffer: async () => { throw new Error('CDN unavailable'); } });
  await assert.rejects(h.sendStickerV2('private:987654321', 'fixture-sticker'), /图片下载失败/);
  assert.equal(h.calls.http.length, 0);
  const list = await h.listStickersForV2();
  assert.equal(list.stickers[0].useCount, 0);
});

test('favorite send rechecks access after downloading', async t => {
  let h;
  h = await fixture(t, PNG, { safeFetchBuffer: async () => {
    h.cfg.allow.groups = [];
    return { buffer: PNG };
  } });
  await assert.rejects(h.sendStickerV2('group:123456', 'fixture-sticker'), /白名单已变化/);
  assert.equal(h.calls.http.length, 0);
});
