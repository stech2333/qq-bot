// dsh-feiyu-mood 的只读镜像。
//
// 插件为主之后，心情的判定与持久化都在插件里（`$DSH_HOME/feiyu-mood/state.json`），
// 本项目不再自行判定、也不再注入自己那份心情。但"接话决策要能看到当前心情"是
// BigFatFish 的特殊需求，插件没有这个接口——这就是补丁所在：
//   定时读取插件的只读状态路由 `/dsh-feiyu-mood/state`，缓存成一句话的心情摘要，
//   由 runtime.externalMoodLine() 注入提示词，并供管理端/决策接口查看。
//
// 只读、失败不阻塞：插件没起来或路由变了，就保持上一次快照（超过 30 分钟自然过期）。
export const MOOD_STATE_PATH = '/dsh-feiyu-mood/state';

export function pickPluginMood(payload) {
  if (!payload || typeof payload !== 'object') return null;
  // 插件状态形状：{ ok, mood: 70, moodLabel: '开心', emoji, lastReason, updatedAt, ... }
  const value = Number(payload.mood);
  if (!Number.isFinite(value)) return null;
  return {
    value: Math.max(0, Math.min(100, value)),
    label: String(payload.moodLabel ?? '').slice(0, 20),
    emoji: String(payload.emoji ?? '').slice(0, 4),
    reason: String(payload.lastReason ?? '').slice(0, 80),
    confidence: Number(payload.lastConfidence) || 0,
    updatedAt: Number(payload.updatedAt) || 0,
    source: 'dsh-feiyu-mood'
  };
}

export function createPluginMoodFeed({ baseUrl, intervalMs = 60000, fetchImpl = globalThis.fetch, onUpdate } = {}) {
  if (!baseUrl) throw new Error('插件心情镜像需要 DSH baseUrl');
  let timer = null, snapshot = null, lastError = '', polls = 0, failures = 0;
  const url = String(baseUrl).replace(/\/+$/, '') + MOOD_STATE_PATH;

  async function poll() {
    polls += 1;
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const next = pickPluginMood(await response.json());
      if (!next) throw new Error('插件状态里没有可用的心情数值');
      snapshot = { ...next, at: Date.now() };
      lastError = '';
      try { onUpdate?.(snapshot); } catch { /* 回调失败不影响轮询 */ }
      return snapshot;
    } catch (error) {
      failures += 1;
      lastError = String(error?.message || error).slice(0, 200);
      return null;
    }
  }

  return {
    url,
    poll,
    start() {
      if (timer) return this;
      void poll();
      timer = setInterval(() => { void poll(); }, intervalMs);
      timer.unref?.();
      return this;
    },
    stop() { if (timer) { clearInterval(timer); timer = null; } return this; },
    snapshot() { return snapshot; },
    status() { return { url, intervalMs, polls, failures, lastError, snapshot }; }
  };
}
