import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BigFatFish } from './runtime.mjs';
export const A = 'group:123456', B = 'group:123457', P = 'private:333333', DAY = 86400000;
export function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bff-v3-style-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const config = { bigfatfish: { expectedQQ: '123456789' }, allow: { groups: ['123456', '123457'], private: ['333333'] }, deny: { groups: [], private: [] }, slang: { enabled: true } };
  const app = new BigFatFish(root, config); app.settings.topicLearning.enabled = false; app.settings.slangPolicy.enabled = false;
  for (const key of [A, B, P]) app.bind(key, { recentMessages: [], unread: [], pendingThoughts: [], activeTopics: [] });
  const feed = (key, i, extra = {}) => {
    const st = app.states.get(key), m = { messageId: String(i + 1), userId: i % 2 ? '111111' : '222222', time: Date.now() - (2 - Math.floor((i % 24) / 8)) * DAY - (8 - i % 8) * 600000 + Math.floor(i / 24) * 120000,
      plain: '这段讨论先说具体想法和理由' + i, styleSourceVersion: 2, sourceScope: key, seq: i + 1, ...extra };
    st.recentMessages.push(m); app.observeTopics(key, st); return m;
  };
  const enough = (key = A) => { for (let i = 0; i < 24; i++) feed(key, i); };
  const admin = (body) => app.globalStyle.admin('POST', { revision: app.globalStyle.state.revision, ...body });
  const output = job => ({ features: {}, expressions: [{ scene: 'casual_chat', action: 'add_view', structure: 'short', strategy: 'independent_view', when: ['general'], avoid: ['help', 'technical'],
    confidence: 0.95, sourceMessageIds: JSON.parse(job.prompt.slice(job.prompt.lastIndexOf('\n') + 1)).map(r => r.id) }] });
  const learn = async (runner = async job => output(job)) => { app.globalStyle.state.research.nextAt=0;app.research.lastTickAt=0;app.research.connect(runner, () => true); await app.research.tick(); };
  const mature=async(key=A)=>{for(let round=0;round<3;round++){for(let i=round*24;i<(round+1)*24;i++)feed(key,i);await learn();}};
  return { root, config, app, feed, enough, admin, output, learn, mature };
}
