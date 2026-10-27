import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bingSearch, filterBingResults, loadSearchConfig, resolveSearchApiKey } from '../../integrations/qq-bridge/src/web-search.js';

const query = '2026年10月 AI 风口 行业趋势 创业 热点';
const calendar = { title: '2026年10月日历和节假日放假安排', url: 'https://example.com/calendar', snippet: '2026年10月' };
const news = { title: 'AI创业：人工智能应用与融资发展', url: 'https://example.com/ai', snippet: '行业趋势与产品应用' };
const rss = results => '<rss><channel>' + results.map(r => `<item><title>${r.title}</title><link>${r.url}</link><description>${r.snippet || ''}</description></item>`).join('') + '</channel></rss>';
const html = results => results.map(r => `<li class="b_algo"><h2><a href="${r.url}">${r.title}</a></h2><p>${r.snippet || ''}</p></li>`).join('');

test('search reads only the explicitly configured credential when the child environment is scrubbed', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bff-search-'));
  t.after(() => { assert.equal(path.dirname(root), os.tmpdir()); assert.ok(path.basename(root).startsWith('bff-search-')); fs.rmSync(root, { recursive: true, force: true }); });
  const envName = 'BFF_SEARCH_FIXTURE_KEY';
  assert.equal(process.env[envName], undefined);
  fs.writeFileSync(path.join(root, 'search.env'), `${envName}="fixture-search-value" # comment\nBFF_UNRELATED_SECRET=do-not-load\n`);
  fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({ webSearch: { apiKeyEnv: envName, apiKeyEnvFile: './search.env' } }));
  const config = loadSearchConfig(root);
  assert.equal(config.apiKeyEnvFile, path.join(root, 'search.env'));
  assert.deepEqual(resolveSearchApiKey(config), { key: 'fixture-search-value', source: 'env-file' });
  assert.equal(process.env[envName], undefined, 'must not import credential into ambient env');
  assert.equal(process.env.BFF_UNRELATED_SECRET, undefined);
  assert.equal(resolveSearchApiKey({ ...config, apiKey: 'explicit-fixture' }).source, 'config');
  fs.unlinkSync(path.join(root, 'search.env'));
  assert.equal(resolveSearchApiKey(config).source, 'none');
});

test('date matches and English substrings cannot promote unrelated calendar pages into AI news', () => {
  const results = filterBingResults(query, [calendar, { title: '2026年日历', url: 'https://example.com/year' }, news, news]);
  assert.deepEqual(results, [news]);
  assert.deepEqual(filterBingResults('AI', [{ title: 'Daily planner', url: 'https://example.com/daily' }]), []);
  assert.deepEqual(filterBingResults('2026年10月 节假日 放假安排', [calendar, news]), [calendar]);
  assert.deepEqual(filterBingResults('2026 holiday calendar', [{ title: '2026 holiday calendar', url: 'https://example.com/holiday' }]).length, 1);
});

test('nonempty but off-topic RSS falls back to HTML before returning results', async () => {
  const calls = [];
  const results = await bingSearch(query, { maxResults: 1 }, { fetch: async url => {
    calls.push(new URL(url));
    return { statusCode: 200, body: calls.length === 1 ? rss([calendar]) : html([news]) };
  } });
  assert.deepEqual(results, [news]);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(url => url.searchParams.get('q') === query));
});

test('calendar noise causes one bounded retry preserving topic words and removing dates', async () => {
  const calls = [];
  const results = await bingSearch(query, { maxResults: 1 }, { fetch: async url => {
    calls.push(new URL(url));
    return { statusCode: 200, body: calls.length <= 2 ? (calls.length === 1 ? rss([calendar]) : html([calendar])) : rss([news]) };
  } });
  assert.deepEqual(results, [news]);
  assert.equal(calls.length, 3);
  assert.doesNotMatch(calls[2].searchParams.get('q'), /2026|10月/);
  assert.match(calls[2].searchParams.get('q'), /AI.*创业/);
  assert.match(calls[2].searchParams.get('q'), /-日历/);
});

test('persistent noise returns empty instead of caching it as usable evidence or retrying forever', async () => {
  const calls = [];
  const results = await bingSearch(query, { maxResults: 4 }, { fetch: async url => {
    const parsed = new URL(url); calls.push(parsed);
    return { statusCode: 200, body: parsed.searchParams.get('format') === 'rss' ? rss([calendar]) : html([calendar]) };
  } });
  assert.deepEqual(results, []);
  assert.equal(calls.length, 4);
  assert.equal(new Set(calls.map(url => url.searchParams.get('q'))).size, 2);
});

test('a valid RSS result survives a failing HTML fetch without unnecessary query rewriting', async () => {
  let calls = 0;
  const results = await bingSearch(query, { maxResults: 8 }, { fetch: async () => {
    if (++calls === 1) return { statusCode: 200, body: rss([news]) };
    throw Error('fixture network failure');
  } });
  assert.deepEqual(results, [news]);
  assert.equal(calls, 2);
});
