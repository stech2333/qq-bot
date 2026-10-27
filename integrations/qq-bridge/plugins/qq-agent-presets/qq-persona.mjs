import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
export function personaSectionText(sessionId, base = root) {
  if (!sessionId) return '';
  const file = path.join(base, 'state', 'persona-prompts', createHash('sha256').update(String(sessionId)).digest('hex') + '.json');
  if (!fs.existsSync(file)) return '';
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (value.schemaVersion !== 1 || value.sessionId !== sessionId || typeof value.content !== 'string' || !/^persona-v3:/.test(value.signature)) throw Error('会话人格可信快照无效');
  return value.content;
}
export function installPersonaSection(ctx) {
  // Real DSH provides systemPrompt through inject. Tiny legacy tool-guard fixtures may omit it.
  if (!ctx.systemPrompt) return;
  ctx.systemPrompt.section({ name: 'bigfatfish:trusted-persona', order: 90, interpolate: false,
    text: context => personaSectionText(context.agent?.id) });
}
