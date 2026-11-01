// config.json 的退役配置清理。
//
// 两类东西要在这里处理，都是"磁盘上的值盖住了代码里的新默认值"这一类 bug：
//
// 1) 整段退役：V1 的 `social.*`（triggerProbability / idleRetryProbability / burstEnabled …）
//    在 reserved2 下**没有任何读取点**，生效的是 `socialV2.*`。留着 28 个键，
//    运维会以为调它们能改聊天行为，改完没反应。
//
// 2) 旧默认值残留：`socialV2.sticker.promptMaxStickers` / `collect.maxPerMinute` /
//    `maxPerHour` 曾经由首次生成写进 config.json（8 / 2 / 10）。深合并的规则是"文件优先"，
//    所以代码把默认改成 0（按语境动态挑、不做频率限制）以后，磁盘上的旧值仍然生效——
//    表现就是"改了代码没变化"。只有等于旧默认值时才删（管理员显式改过的不动），
//    删掉后新默认值才会接管。
//
// 只原地修改传入的对象；是否落盘、备份由调用方决定。
export const RETIRED_CONFIG_SECTIONS = Object.freeze(['social']);

// path 指向的具体键，legacy 是"当年的默认值"。值不相等就说明是管理员显式设置的，保留。
export const RETIRED_CONFIG_VALUES = Object.freeze([
  { path: ['socialV2', 'sticker', 'promptMaxStickers'], legacy: 8, reason: '旧的"固定列出 8 张常用表情"默认值' },
  { path: ['socialV2', 'sticker', 'collect', 'maxPerMinute'], legacy: 2, reason: '旧的收藏频率默认值' },
  { path: ['socialV2', 'sticker', 'collect', 'maxPerHour'], legacy: 10, reason: '旧的收藏频率默认值' }
]);

export function pruneRetiredConfig(file) {
  if (!file || typeof file !== 'object' || Array.isArray(file)) return { changed: false, removed: [] };
  const removed = [];
  for (const name of RETIRED_CONFIG_SECTIONS) {
    if (!Object.hasOwn(file, name)) continue;
    delete file[name];
    removed.push(name);
  }
  return { changed: removed.length > 0, removed };
}

/**
 * 摘掉退役段与"仍是旧默认值"的残留键。
 * @returns {{changed: boolean, removed: string[]}}
 */
export function migrateRetiredConfig(file) {
  const pruned = pruneRetiredConfig(file);
  const removed = [...pruned.removed];
  if (!file || typeof file !== 'object' || Array.isArray(file)) return { changed: pruned.changed, removed };
  for (const { path, legacy } of RETIRED_CONFIG_VALUES) {
    let parent = file;
    for (const key of path.slice(0, -1)) {
      if (!parent || typeof parent !== 'object' || Array.isArray(parent)) { parent = null; break; }
      parent = parent[key];
    }
    const leaf = path[path.length - 1];
    if (!parent || typeof parent !== 'object' || Array.isArray(parent) || !Object.hasOwn(parent, leaf)) continue;
    if (parent[leaf] !== legacy) continue; // 管理员显式改过，保留
    delete parent[leaf];
    removed.push(path.join('.'));
  }
  return { changed: removed.length > 0, removed };
}
