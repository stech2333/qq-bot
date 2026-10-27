// Prepare the standalone QQ bridge. Existing settings and memories are preserved.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..'), repo = path.join(root, 'integrations/qq-bridge');
const put = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 }); };
const configFile = path.join(repo, 'config.json');
if (!fs.existsSync(configFile)) {
  const cfg = JSON.parse(fs.readFileSync(path.join(repo, 'config.example.json')));
  cfg.ownerQQ = '3184522842'; cfg.allow = { groups: ['369527547'], private: ['3184522842'] }; cfg.allowAllWhenEmpty = false;
  cfg.dsh.baseUrl = 'http://127.0.0.1:3086'; cfg.consolePort = 3106; cfg.consoleToken = crypto.randomBytes(24).toString('hex');
  cfg.bigfatfish = { expectedQQ: '3486808375', voiceToolDir: '' };
  cfg.workspaceTitle = '大肥鱼 · QQ'; cfg.security.interceptNotify = false;
  cfg.socialV2.tools.collectSticker = true; cfg.socialV2.tools.getSelfImage = false; cfg.socialV2.tools.sendVoice = false;
  cfg.socialV2.voice.enabled = false;
  cfg.socialV2.voice.ffmpegPath = path.join(repo, 'node_modules/@ffmpeg-installer/win32-x64/ffmpeg.exe');
  cfg.socialV2.proactive.idleThresholdMs = 45 * 60000;
  cfg.socialV2.wake.recommendedKeywords = ['大肥鱼', '肥鱼', '小鲸鱼', '蓝色大肥鱼', 'DeepSeek', 'deepseek'];
  put(configFile, cfg);
}
{
  const cfg = JSON.parse(fs.readFileSync(configFile));
  const binary = path.join(repo, 'node_modules/@ffmpeg-installer/win32-x64/ffmpeg.exe');
  if (fs.existsSync(binary) && !cfg.socialV2.voice.ffmpegPath) { cfg.socialV2.voice.ffmpegPath = binary; put(configFile, cfg); }
}
const state = path.join(repo, 'state'); fs.mkdirSync(state, { recursive: true });
for (const [name, value] of [['mode.json', { mode: 'reserved2', closedAgentPreset: '' }], ['current-role.json', { role: '大肥鱼', mode: 'active' }]]) {
  const file = path.join(state, name); if (!fs.existsSync(file)) put(file, value);
}
const roleFile = path.join(repo, 'roles/大肥鱼.md');
if (!fs.existsSync(roleFile)) {
  fs.mkdirSync(path.dirname(roleFile), { recursive: true });
  fs.copyFileSync(path.join(root, 'extensions/bigfatfish/persona.md'), roleFile);
}
const legacy = path.join(state, 'legacy-import.json');
if (!fs.existsSync(legacy)) {
  const memory = path.join(root, 'data-bridge/legacy-memory');
  const tables = Object.fromEntries(['archives', 'facts', 'peers', 'policies', 'session_roots', 'summaries'].map(name => {
    const folder = path.join(memory, name);
    const entries = fs.existsSync(folder) ? fs.readdirSync(folder).filter(file => file.endsWith('.json')).map(file => ({
      key: path.basename(file, '.json'), data: JSON.parse(fs.readFileSync(path.join(folder, file), 'utf8'))
    })) : [];
    return [name, entries];
  }));
  put(legacy, { version: 1, bound: {}, tables, note: '历史会话需管理端显式绑定，未自动映射到QQ号或群号' });
}
console.log('Prepared standalone QQ bridge; existing credentials, settings and memory remain local.');
