import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { resolveModelAddresses, createDirectModelFetch } from './model-network.mjs';
import { completion, createCommunityModel, communityModelProfile } from './community-model.mjs';
import { communitySettings } from './community-learning.mjs';
import { poolCredential } from './api-pool.mjs';

const entry = id => ({ id: id.repeat(32), name: id, enabled: true, keyStored: true, model: 'deepseek-flash', protocol: 'openai-completions', baseURL: 'https://token.nuaa.edu.cn/v1', deepseekCompat: true });
test('chat campus fetch forces direct dispatcher and redirect refusal within a fixed API scope', async () => {
  const calls = [], dispatcher = {}, fetch = createDirectModelFetch(async (...args) => { calls.push(args); return 'ok'; }, dispatcher);
  await fetch('https://token.nuaa.edu.cn/v1/chat/completions', { method: 'POST', redirect: 'follow', dispatcher: 'proxy' });
  assert.equal(calls[0][1].dispatcher, dispatcher); assert.equal(calls[0][1].redirect, 'error');
  await fetch(new Request('https://token.nuaa.edu.cn/v1/models')); assert.equal(calls[1][1].dispatcher, dispatcher);
  for (const url of ['http://token.nuaa.edu.cn/v1/models', 'https://token.nuaa.edu.cn:8443/v1/models', 'https://token.nuaa.edu.cn/admin', 'https://token.nuaa.edu.cn/v1/models?url=http://localhost/', 'https://user:pass@token.nuaa.edu.cn/v1/models']) await assert.rejects(fetch(url), /只允许/);
  const options = { method: 'POST' }; await fetch('https://api.deepseek.com/chat/completions', options);
  assert.equal(calls.at(-1)[1], options, 'unrelated providers are unchanged');
});
test('campus split DNS returns only public addresses and refuses all-private answers', async () => {
  const publicIp = '2001:da8:1006:1001::101';
  assert.deepEqual(await resolveModelAddresses('token.nuaa.edu.cn', { lookup: async () => [{ address: '10.0.241.133' }, { address: publicIp }, { address: '127.0.0.1' }] }), [publicIp]);
  for (const address of ['10.0.241.133', '127.0.0.1', '169.254.169.254', '::1', '::ffff:127.0.0.1', 'fd00::1', 'bad-dns']) {
    await assert.rejects(resolveModelAddresses('token.nuaa.edu.cn', { lookup: async () => [{ address }] }), /已阻止/);
  }
});
test('other domains use the unchanged strict SSRF resolver, without a campus exception', async () => {
  for (const host of ['localhost', 'attacker.example', 'token.nuaa.edu.cn.attacker.example']) {
    await assert.rejects(resolveModelAddresses(host, { lookup: () => assert.fail('campus lookup must not run'), resolve: async name => { assert.equal(name, host); throw Error('strict resolver rejected'); } }), /strict resolver/);
  }
});
test('dedicated community routes stay independent of chat and fail closed if missing or disabled', async () => {
  const a = entry('a'), b = entry('b'), pool = { state: { activeId: a.id, entries: [a, b] } }, refs = [];
  const model = createCommunityModel({ pool, config: {}, route: () => b.id, env: {}, readCredential: ref => { refs.push(ref); return 'fixture-key'; }, request: async (_p, body) => {
    assert.equal(body.tools, undefined); assert.equal(body.messages.length, 2); assert.deepEqual(body.thinking, { type: 'disabled' });
    return { choices: [{ finish_reason: 'stop', message: { content: '{"ok":true}' } }] };
  } });
  pool.state.activeId = null;
  await model.run({ prompt: '{}', signal: new AbortController().signal, maxOutputTokens: 256, stage: 'test' });
  assert.ok(refs.every(ref => ref === poolCredential(b))); assert.equal(model.describe().route, b.id); assert.equal(model.describe().tools, false);
  assert.equal(pool.state.activeId, null);
  pool.state.entries = [a]; assert.throws(() => model.ready(), /不存在/);
  pool.state.entries.push({ ...b, enabled: false }); assert.throws(() => model.ready(), /已启用/);
  assert.equal(communityModelProfile(pool, {}, { DEEPSEEK_API_KEY: 'fixture-original' }, () => '', 'builtin').key, 'fixture-original');
});
test('model route settings preserve old defaults and reject executable or malformed values', () => {
  assert.equal(communitySettings().modelRoute, 'follow-chat');
  for (const route of ['builtin', 'follow-chat', 'a'.repeat(32)]) assert.equal(communitySettings({ modelRoute: route }).modelRoute, route);
  for (const route of ['__proto__', 'http://localhost/', '../secret', null, {}]) assert.throws(() => communitySettings({ modelRoute: route }), /路由/);
});
test('model HTTPS transport pins public DNS, verifies TLS, uses a fresh direct socket and refuses redirects', async () => {
  for (const statusCode of [200, 302]) {
    let options;
    const response = new PassThrough(); response.statusCode = statusCode; response.headers = { 'content-type': 'application/json', location: 'http://127.0.0.1/' };
    const request = (opts, callback) => {
      options = opts; const req = new EventEmitter(); req.destroy = () => {};
      req.end = () => queueMicrotask(() => { callback(response); response.end('{"choices":[]}'); }); return req;
    };
    const result = completion({ baseURL: 'https://token.nuaa.edu.cn/v1', key: 'fixture-only-key' }, {}, new AbortController().signal, () => {}, { request, resolveAddresses: async () => ['2001:da8:1006:1001::101'] });
    if (statusCode === 200) await result; else await assert.rejects(result, /HTTP 302/);
    assert.equal(options.hostname, '2001:da8:1006:1001::101'); assert.equal(options.servername, 'token.nuaa.edu.cn'); assert.equal(options.headers.host, 'token.nuaa.edu.cn');
    assert.equal(options.agent, false); assert.equal(options.rejectUnauthorized, true); assert.equal(options.path, '/v1/chat/completions');
  }
});
