import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkReadiness, formatReport } from '../extensions/bigfatfish/readiness.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const usage = '用法：node scripts/check-bridge-readiness.mjs [--online] [--json] [--report <文件前缀>]';
let online = false, jsonOutput = false, output;
try {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--online') online = true;
    else if (args[i] === '--json') jsonOutput = true;
    else if (args[i] === '--report' && args[i + 1] && !args[i + 1].startsWith('--')) output = args[++i];
    else if (args[i] === '--help') { console.log(usage); process.exit(0); }
    else throw new Error('参数无效。' + usage);
  }
  let prefix;
  if (output) {
    prefix = path.resolve(root, output);
    // Generated reports stay in logs/acceptance/; a report cannot replace config,
    // runtime files or state even if a path was entered by mistake.
    const directory = path.join(root, 'logs/acceptance');
    if (path.dirname(prefix) !== directory || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(path.basename(prefix))) throw new Error('报告前缀须直接位于 logs/acceptance 目录，名称仅使用字母、数字、下划线或连字符');
    const logDirectory = path.join(root, 'logs');
    if (fs.realpathSync(logDirectory) !== path.join(fs.realpathSync(root), 'logs')) throw new Error('日志目录不能通过链接指向项目之外');
    fs.mkdirSync(directory, { recursive: true });
    if (fs.realpathSync(directory) !== path.join(fs.realpathSync(root), 'logs/acceptance')) throw new Error('报告目录不能通过链接指向项目之外');
    if (['json', 'md'].some(extension => fs.existsSync(`${prefix}.${extension}`))) throw new Error('报告已存在，请使用新的文件前缀。');
  }
  const managerPort = Number(process.env.BFF_MANAGER_PORT || 3105);
  const report = await checkReadiness(root, { online, managerPort });
  if (prefix) {
    for (const [extension, content] of [['json', JSON.stringify(report, null, 2) + '\n'], ['md', formatReport(report)]]) {
      // Exclusive creation also protects existing files and symlink targets.
      fs.writeFileSync(`${prefix}.${extension}`, content, { flag: 'wx', mode: 0o600 });
    }
  }
  console.log(jsonOutput ? JSON.stringify(report, null, 2) : formatReport(report));
  process.exitCode = report.summary.fail ? 1 : 0;
} catch (error) {
  console.error(error.code === 'EEXIST' ? '报告已存在，请使用新的文件前缀。' : error.code ? '验收或报告写入失败，请检查本机文件权限。' : error.message);
  process.exitCode = 1;
}
