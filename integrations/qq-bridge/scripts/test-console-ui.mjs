import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const r=spawnSync(process.execPath,[fileURLToPath(new URL('../../../scripts/check-console-ui.cjs',import.meta.url))],{stdio:'inherit',windowsHide:true});process.exitCode=r.status??1;
