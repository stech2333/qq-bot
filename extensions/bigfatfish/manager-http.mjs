import fs from 'node:fs';
import path from 'node:path';
import { timingSafeEqual } from 'node:crypto';

const equal = (a, b) => { const x = Buffer.from(String(a ?? '')), y = Buffer.from(String(b ?? '')); return x.length === y.length && x.length > 0 && timingSafeEqual(x, y); };
const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
  'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer' };
export function managerHandler(manager, { port = 3105 } = {}) {
  return async (req, res) => {
    const send = (value, code = 200) => { if (!res.writableEnded) { res.writeHead(code, headers); res.end(JSON.stringify(value)); } };
    try {
      if (![ `127.0.0.1:${port}`, `localhost:${port}` ].includes(String(req.headers.host || '').toLowerCase())) { send({ ok: false, error: '管理入口只接受本机回环地址' }, 403); return; }
      let url;
      try { url = new URL(req.url, `http://127.0.0.1:${port}`); } catch { send({ ok: false, error: '请求地址无效' }, 400); return; }
      if (req.method === 'GET' && url.pathname === '/') {
        const html = fs.readFileSync(path.join(manager.root, 'extensions/bigfatfish/manager.html'));
        res.writeHead(200, { ...headers, 'content-type': 'text/html; charset=utf-8' }); res.end(html); return;
      }
      if (req.headers['x-agent-token'] !== undefined || req.headers['x-agent-call'] !== undefined) { send({ ok: false, error: '仅管理端可用' }, 403); return; }
      if (!equal(req.headers['x-console-token'], manager.config().consoleToken)) { send({ ok: false, error: '请输入管理令牌' }, 401); return; }
      if (req.headers.origin && ![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(req.headers.origin)) { send({ ok: false, error: '跨站请求被拒绝' }, 403); return; }
      if (req.method === 'GET' && url.pathname === '/api/manager/status') { send(await manager.status()); return; }
      if (req.method !== 'POST' || url.pathname !== '/api/manager/action') { send({ ok: false, error: '接口不存在' }, 404); return; }
      if (!String(req.headers['content-type']).toLowerCase().includes('application/json')) { send({ ok: false, error: '请求格式无效' }, 415); return; }
      let body;
      try {
        const chunks = []; let bytes = 0; req.setTimeout(10000, () => req.destroy());
        for await (const chunk of req) {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); bytes += buffer.length;
          if (bytes > 4096) { send({ ok: false, error: '请求体过大' }, 413); return; }
          chunks.push(buffer);
        }
        req.setTimeout(0); body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch { send({ ok: false, error: '请求体必须是有效 JSON 对象' }, 400); return; }
      if (!body || Array.isArray(body) || typeof body !== 'object') { send({ ok: false, error: '请求体必须是 JSON 对象' }, 400); return; }
      try { send(await manager.action(body)); }
      catch (error) {
        // Config parse failures may contain complete credentials. Only known operational messages are returned.
        const message = String(error?.message || '');
        const safe = /^(?:已有启停操作进行中|操作参数无效|该服务由其他入口启动，请在原入口停止|停止尚未完成，请稍后刷新|请先启动 DSH，或使用一键启动|SnowLuma 安装不完整)$/.test(message)
          || /^(?:snowluma|dsh|bridge) (?:启动失败：(?:ENOENT|EACCES|退出码 \d+)|未在等待时间内就绪，请查看管理页中的错误和本机日志)$/.test(message);
        send({ ok: false, error: safe ? message : '服务操作未完成，请检查本机配置及管理日志' }, 400);
      }
    } catch { send({ ok: false, error: '管理服务暂不可用，请检查本机配置与组件状态' }, 503); }
  };
}
