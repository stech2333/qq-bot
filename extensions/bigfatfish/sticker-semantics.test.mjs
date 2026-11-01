import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStickerEntry, stickerSemanticsReady, ambiguityBlocksAutoSend, parseStickerUnderstanding, stickerCandidateScore } from '../../integrations/qq-bridge/src/sticker-lib.js';

const base = {
  id: 's1', url: 'https://example.invalid/s1.png', localNote: '面无表情地看着，表示无语',
  usage: '群聊里对离谱发言做冷淡回应', tags: ['无语', '冷淡'], usageScenes: ['casual_chat'], avoidScenes: ['help', 'technical', 'serious'],
  tone: ['冷淡'], understandingStatus: 'reviewed', understandingSource: 'visual', understandingConfidence: 0.86, semanticPersistence: 'saved'
};

test('a secondary "could also mean" note no longer blocks auto-send', () => {
  // 真实模型输出：语义清楚、置信度 0.86，但总会写一句"也可能被读成…"。
  // 旧规则因此把每张表情都判 uncertain，选图恒定 0 候选。
  const entry = normalizeStickerEntry({ ...base, ambiguity: '左边缘被裁掉一半的眼睛增加歧义，也可能被读成眨眼或困倦' });
  assert.equal(ambiguityBlocksAutoSend(entry), false);
  assert.equal(stickerSemanticsReady(entry), true);
});

test('risky ambiguity, low confidence and privacy still block auto-send', () => {
  for (const patch of [
    { ambiguity: '可能被读成嘲讽对方' },
    { ambiguity: '含有政治意味' },
    { ambiguity: '无法排除隐私泄露' },
    { ambiguity: '不确定', understandingConfidence: 0.5 }
  ]) {
    const entry = normalizeStickerEntry({ ...base, ...patch });
    assert.equal(ambiguityBlocksAutoSend(entry), true, JSON.stringify(patch));
    assert.equal(stickerSemanticsReady(entry), false, JSON.stringify(patch));
  }
  const privateEntry = normalizeStickerEntry({ ...base, privacySensitive: true });
  assert.equal(stickerSemanticsReady(privateEntry), false);
});

test('an ambiguous but usable candidate is ranked below a clean one', () => {
  const clean = normalizeStickerEntry({ ...base, id: 'a' });
  const ambiguous = normalizeStickerEntry({ ...base, id: 'b', ambiguity: '也可能只是觉得图好笑' });
  const now = 1_800_000_000_000;
  assert.ok(stickerCandidateScore(clean, { matchCount: 1, now }) > stickerCandidateScore(ambiguous, { matchCount: 1, now }));
});

test('vision output with a low-risk ambiguity is kept as reviewed, not uncertain', () => {
  const patch = parseStickerUnderstanding(JSON.stringify({
    visualGrounded: true, visualContent: '一张被P出五官的满月图', imageText: '', note: '面无表情地看着，表示无语',
    subtext: '就这？', usage: '对离谱发言做冷淡回应', tags: ['无语', '冷淡'], usageScenes: ['casual_chat'],
    avoidScenes: ['help', 'technical', 'serious'], tone: ['冷淡'], ambiguity: '左边缘被裁掉的眼睛也可能被读成眨眼',
    privacySensitive: false, understandingConfidence: 0.86
  }));
  assert.equal(patch.understandingStatus, 'reviewed');
});

test('vision output with risky ambiguity still degrades to uncertain', () => {
  const patch = parseStickerUnderstanding(JSON.stringify({
    visualGrounded: true, visualContent: '一张嘲讽图', imageText: '', note: '嘲讽对方', subtext: '就你？',
    usage: '嘲讽别人', tags: ['嘲讽'], usageScenes: ['casual_banter'], avoidScenes: ['help', 'technical', 'serious'],
    tone: ['刻薄'], ambiguity: '明显是嘲讽，可能冒犯对方', privacySensitive: false, understandingConfidence: 0.9
  }));
  assert.equal(patch.understandingStatus, 'uncertain');
});
