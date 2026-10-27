import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { GroupStyle } from './group-style.mjs';
import { fixture, A, B, P } from './style-test-fixture.mjs';

test('A group candidates need review, stay isolated, persist provenance without copying chat', async t => {
  const f = fixture(t); f.enough(); await f.learn();
  const candidate = f.app.groupStyle.load(A).expressionExamples[0]; assert.equal(candidate.status, 'candidate');
  assert.equal(f.app.groupStyle.active(A).expressionExamples.length, 0);
  f.admin(A, { action: 'approve', id: candidate.id });
  assert.equal(f.app.groupStyle.active(A).expressionExamples.length, 1);
  const sources = f.app.groupStyle.admin('GET', { key: A, action: 'evidence', id: candidate.id }); assert.equal(sources.sources.length, 24); assert.match(sources.sources[0].text, /这段讨论/);
  assert.throws(() => f.app.groupStyle.admin('GET', { key: B, action: 'evidence', id: candidate.id }), /不存在/);
  assert.equal(f.app.groupStyle.active(B).expressionExamples.length, 0); assert.equal(f.app.groupStyle.active(P), null);
  const saved = fs.readFileSync(f.app.groupStyle.file(A), 'utf8'); assert.doesNotMatch(saved, /这段讨论|111111|222222|这件私事/);
  assert.equal(new GroupStyle(f.app).load(A).expressionExamples[0].id, candidate.id);
  assert.notEqual(f.app.groupStyle.file(A), f.app.groupStyle.file(B)); assert.throws(() => f.app.groupStyle.file('../../escape'));
});
test('disabled application leaves facts, queues, other groups and learning intact', t => {
  const f = fixture(t), st = f.app.states.get(A); f.enough();
  f.admin(A, { action: 'setFeature', feature: 'tone', value: 'playful' }); f.admin(B, { action: 'setFeature', feature: 'wording', value: 'plain' });
  st.unread.push({ seq: 100, plain: '待回答' }); st.bigfatfish.facts.push({ text: '这个群的事实' });
  const before = structuredClone(st); f.admin(A, { action: 'configure', apply: false });
  assert.equal(f.app.groupStyle.active(A), null); assert.ok(f.app.groupStyle.active(B).features.wording); assert.deepEqual(st, before);
  assert.equal(f.app.styleLearning.jobs(Date.now()).length, 1);
});
test('turning learning off stops new evidence but retains independently enabled application', t => {
  const f = fixture(t); f.enough(); f.admin(A, { action: 'setFeature', feature: 'tone', value: 'playful' }); f.admin(A, { action: 'configure', enabled: false });
  assert.equal(f.app.styleLearning.jobs(Date.now()).length, 0); assert.ok(f.app.groupStyle.active(A).features.tone);
  f.config.deny.groups.push('123456'); assert.deepEqual(f.app.groupStyle.rows(A), []);
  const count = f.app.learningWindow.load(A, Date.now()).rows.size; f.feed(A, 100, { time: Date.now() - 1000 }); assert.equal(f.app.learningWindow.load(A, Date.now()).rows.size, count);
});
test('stale revisions, broken files, failed writes cannot overwrite last valid state', t => {
  const f = fixture(t); f.admin(A, { action: 'setFeature', feature: 'tone', value: 'playful' });
  assert.throws(() => f.app.groupStyle.admin('POST', { key: A, revision: 0, action: 'reset' }));
  const file = f.app.groupStyle.file(A), before = f.app.groupStyle.load(A); fs.writeFileSync(file, '{broken');
  const broken = new GroupStyle(f.app); broken.load(A); assert.ok(broken.errors.get(A)); assert.throws(() => broken.save(A, before)); assert.equal(fs.readFileSync(file, 'utf8'), '{broken');
  const original = f.app.groupStyle.file.bind(f.app.groupStyle); f.app.groupStyle.file = () => path.join(f.root, 'state');
  assert.throws(() => f.admin(A, { action: 'reset' })); assert.equal(f.app.groupStyle.load(A), before); f.app.groupStyle.file = original;
});
test('manual features win, deletion and rollback cannot revive tombstoned entries', async t => {
  const f = fixture(t); f.enough(); f.admin(A, { action: 'setFeature', feature: 'tone', value: 'restrained' });
  await f.learn(async job => ({ features: { tone: { value: 'playful', sourceMessageIds: JSON.parse(job.prompt.slice(job.prompt.lastIndexOf('\n') + 1)).map(r => r.id) } }, expressions: [] }));
  assert.equal(f.app.groupStyle.load(A).features.tone.value, 'restrained');
  const version = f.app.groupStyle.load(A).version; f.admin(A, { action: 'delete', feature: 'tone' }); f.admin(A, { action: 'rollback', version });
  assert.equal(f.app.groupStyle.load(A).features.tone, undefined);
  f.admin(A, { action: 'reset' }); assert.equal(f.app.groupStyle.load(A).history.length, 0); assert.deepEqual(f.app.groupStyle.rows(A), []);
});
test('new candidate does not displace the previously reviewed active feature', async t => {
  const f = fixture(t); f.enough();
  const result = value => async job => ({ expressions: [], features: { tone: { value, sourceMessageIds: JSON.parse(job.prompt.slice(job.prompt.lastIndexOf('\n') + 1)).map(r => r.id) } } });
  await f.learn(result('restrained')); f.admin(A, { action: 'approve', feature: 'tone' }); f.admin(A, { action: 'lock', feature: 'tone', locked: false });
  f.app.groupStyle.load(A).lastSources = []; f.app.research.lastTickAt = 0; await f.learn(result('playful'));
  assert.equal(f.app.groupStyle.load(A).features.tone.status, 'candidate'); assert.equal(f.app.groupStyle.active(A).features.tone.value, 'restrained');
  f.admin(A, { action: 'approve', feature: 'tone' }); assert.equal(f.app.groupStyle.active(A).features.tone.value, 'playful');
});
test('administration remains console-only and preview is read-only', async t => {
  const f = fixture(t); f.enough(); const before = structuredClone(f.app.groupStyle.load(A)), win = fs.readFileSync(f.app.learningWindow.file(A), 'utf8'); let status, result;
  await f.app.handle({ method: 'POST', headers: { 'x-agent-token': 'fixture' } }, new URL('http://localhost/api/bigfatfish/group-style'), async () => ({}), (r,c) => { status = c; }, {}); assert.equal(status, 403);
  await f.app.handle({ method: 'POST', headers: {} }, new URL('http://localhost/api/bigfatfish/group-style'), async () => ({ key: A, action: 'preview', message: '怎么解决代码报错？' }), r => { result = r; }, { roleState: () => ({ role: null }) });
  assert.equal(result.ok, true); assert.equal(result.resolved.scene, 'help'); assert.deepEqual(f.app.groupStyle.load(A), before); assert.equal(fs.readFileSync(f.app.learningWindow.file(A), 'utf8'), win);
});
