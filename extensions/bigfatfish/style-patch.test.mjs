import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

test('integration patch replay is idempotent against virtual files and never touches production state', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url)), script = path.join(root, 'scripts/apply-bridge-extension.cjs');
  const localRequire = createRequire(script), writes = new Map();
  const fakeFs = { ...fs, readFileSync(file, ...args) { return writes.has(String(file)) ? writes.get(String(file)) : fs.readFileSync(file, ...args); },
    writeFileSync(file, data) { assert.ok(String(file).startsWith(path.join(root, 'integrations/qq-bridge') + path.sep)); assert.ok(!String(file).includes(path.sep + 'state' + path.sep)); writes.set(String(file), data); } };
  const run = () => vm.runInNewContext(fs.readFileSync(script, 'utf8'), { __dirname: path.dirname(script), console: { log() {} },
    require(name) { return name === 'node:fs' ? fakeFs : localRequire(name); } });
  run(); const before = new Map(writes); run(); assert.deepEqual(writes, before); assert.ok([...writes.keys()].some(file => file.endsWith('console.html')));
});
