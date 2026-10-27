import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { managerHandler } from '../extensions/bigfatfish/manager-http.mjs';
import { ServiceManager } from '../extensions/bigfatfish/services.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manager = new ServiceManager(root);
const host = '127.0.0.1', port = Number(process.env.BFF_MANAGER_PORT || 3105);
const server = http.createServer(managerHandler(manager, { port }));
server.on('error', error => { console.error('管理入口启动失败:', error.code); process.exitCode = 1; });
server.listen(port, host, () => {
  console.log(`BigFatFish manager ready at http://${host}:${port} (authentication required)`);
  if (process.argv.includes('--autostart')) manager.action({ action: 'start', service: 'all' }).catch(() => console.error('自动启动未完成，请在本机管理页检查服务状态'));
});
