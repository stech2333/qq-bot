// Reproducible isolated audit. Does not send QQ messages or change production settings.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..'), repo = path.join(root, 'integrations/qq-bridge');
const out = path.join(root, 'logs/audit'); fs.mkdirSync(out, { recursive: true });
const temp = path.join(out, 'temp'); fs.mkdirSync(temp, { recursive: true });
const env = { ...process.env, TEMP: temp, TMP: temp, DSH_HOME: path.join(root, 'data-bridge'), DSH_INSTALL_MODULES: path.join(root, 'node_modules') };
const ffmpeg = path.join(repo, 'node_modules/@ffmpeg-installer/win32-x64/ffmpeg.exe'); if (fs.existsSync(ffmpeg)) env.FFMPEG_PATH = ffmpeg;
async function run(name, args, cwd = root) {
  const file = path.join(out, name + '.log'), stream = fs.createWriteStream(file);
  const child = spawn(process.execPath, args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.pipe(stream, { end: false }); child.stderr.pipe(stream, { end: false });
  const result = await new Promise(resolve => { child.once('error', () => resolve({ code: -1 })); child.once('close', code => resolve({ code })); });
  await new Promise(resolve => stream.end(resolve)); console.log(name + ': ' + (result.code === 0 ? 'PASS' : 'FAIL') + ' (logs/audit/' + name + '.log)');
  return { name, ...result };
}
(async () => {
  const localTests = fs.readdirSync(path.join(root, 'extensions/bigfatfish')).filter(name => name.endsWith('.test.mjs')).map(name => path.join(root, 'extensions/bigfatfish', name));
  const results = await Promise.all([run('local', ['--test', ...localTests]), run('upstream', ['scripts/test-audit.mjs'], repo), run('mcp-stdio', ['scripts/test-mcp-servers-stdio.mjs'], repo)]);
  if (process.argv.includes('--ui')) results.push(await run('console-ui', ['scripts/check-console-ui.cjs']));
  fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify({ at: new Date().toISOString(), results,
    limitations: ['Independent voice-tool is not installed.', 'QQ chat, favorites/GIF delivery and reconnect were not exercised against real peers.'] }, null, 2));
  process.exitCode = results.every(result => result.code === 0) ? 0 : 1;
})().catch(() => { console.error('Audit runner failed; check logs/audit.'); process.exitCode = 1; });
