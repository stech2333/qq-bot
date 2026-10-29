// Trusted service bootstrap only. No keys, model tools, or administrative APIs.
import { createRequire } from 'node:module';
import { createDirectModelFetch, modelLookup } from './model-network.mjs';

const marker = Symbol.for('bigfatfish:direct-campus-model');
if (!globalThis[marker]) {
  const require = createRequire(import.meta.resolve('@deepseek-ai/dsh-http-proxy'));
  // Use fetch and Agent from the same undici version; Node's bundled fetch may
  // speak a different dispatcher-handler ABI than the installed DSH dependency.
  const { Agent, fetch } = require('undici');
  const dispatcher = new Agent({ connect: { lookup: modelLookup, rejectUnauthorized: true, timeout: 10000 } });
  globalThis.fetch = createDirectModelFetch(globalThis.fetch.bind(globalThis), dispatcher, fetch);
  globalThis[marker] = true;
}
