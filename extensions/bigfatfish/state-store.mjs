import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
export function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true }); const tmp = file + '.' + randomUUID() + '.tmp';
  try { fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 }); fs.renameSync(tmp, file); }
  finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
}
export function backupOnce(file) {
  if (!fs.existsSync(file)) return;
  const backup = file + '.pre-v3.bak';
  if (!fs.existsSync(backup)) fs.copyFileSync(file, backup, fs.constants.COPYFILE_EXCL);
}
export function numberSetting(value, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) {
  if (value === undefined || value === null) return fallback;
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  if (!Number.isFinite(n) || n < min || n > max) throw Error('数值配置无效');
  return n;
}
