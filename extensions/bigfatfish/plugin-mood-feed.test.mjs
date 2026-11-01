import test from 'node:test';
import assert from 'node:assert/strict';
import { pickPluginMood, createPluginMoodFeed, MOOD_STATE_PATH } from './plugin-mood-feed.mjs';

test('picks the plugin mood shape and clamps it', () => {
  const snap = pickPluginMood({ ok: true, mood: 70, moodLabel: '开心', emoji: '🙂', lastReason: '刚被夸', lastConfidence: 0.9, updatedAt: 1 });
  assert.equal(snap.value, 70);
  assert.equal(snap.label, '开心');
  assert.equal(snap.source, 'dsh-feiyu-mood');
  assert.equal(pickPluginMood({ mood: 200 }).value, 100);
  for (const bad of [null, undefined, {}, { mood: 'x' }, 'nope', []]) assert.equal(pickPluginMood(bad), null);
});

test('the feed reads the documented read-only route and caches the last good value', async () => {
  let payload = { ok: true, mood: 62, moodLabel: '平稳' };
  let calls = 0, fail = false;
  const feed = createPluginMoodFeed({
    baseUrl: 'http://127.0.0.1:3086/',
    fetchImpl: async url => {
      calls += 1;
      assert.equal(url, 'http://127.0.0.1:3086' + MOOD_STATE_PATH);
      if (fail) throw new Error('boom');
      return { ok: true, json: async () => payload };
    }
  });
  const updates = [];
  assert.equal((await feed.poll()).value, 62);
  payload = { ok: true, mood: 45, moodLabel: '低落' };
  const second = createPluginMoodFeed({ baseUrl: 'http://127.0.0.1:3086', fetchImpl: async () => ({ ok: true, json: async () => payload }), onUpdate: s => updates.push(s.value) });
  await second.poll();
  assert.deepEqual(updates, [45]);
  // 失败时保留上一次快照，只记录错误。
  fail = true;
  assert.equal(await feed.poll(), null);
  assert.equal(feed.snapshot().value, 62);
  assert.match(feed.status().lastError, /boom/);
  assert.equal(calls, 2);
});

test('a non-200 response or a payload without a number does not overwrite the snapshot', async () => {
  const bad = createPluginMoodFeed({ baseUrl: 'http://x', fetchImpl: async () => ({ ok: false, status: 404, json: async () => ({}) }) });
  assert.equal(await bad.poll(), null);
  assert.equal(bad.snapshot(), null);
  assert.match(bad.status().lastError, /404/);
  const empty = createPluginMoodFeed({ baseUrl: 'http://x', fetchImpl: async () => ({ ok: true, json: async () => ({ ok: true }) }) });
  assert.equal(await empty.poll(), null);
  assert.match(empty.status().lastError, /心情数值/);
});
