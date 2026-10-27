// Local adapter for upstream regression fixtures: use valid QQ IDs and explicit identity.
// Native wake tests disable the optional participation override; local policy tests use the real default.
import { bridgeHarness as originalHarness } from './audit-bridge-harness.mjs';
export async function bridgeHarness(options = {}) {
  const config = { ownerQQ: 123123, allow: { groups: ['123456'], private: ['123123'] },
    bigfatfish: { expectedQQ: '999999' }, ...options.config };
  const h = await originalHarness({ ...options, config, files: {
    'state/bigfatfish-settings.json': { participation: { enabled: false } }, ...options.files
  } });
  h.setSelfIdentity('FixtureQQ', config.bigfatfish.expectedQQ);
  return h;
}
