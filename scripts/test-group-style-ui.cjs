// Offline browser acceptance: synthetic state, loopback fixture, every BFF request intercepted.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { Readable } = require('node:stream');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const moduleAt = file => import(pathToFileURL(path.join(root, file)).href);
(async () => {
  const { startConsoleFixture } = await moduleAt('integrations/qq-bridge/scripts/console-ui-fixture.mjs');
  const { fixture, A, B } = await moduleAt('extensions/bigfatfish/style-test-fixture.mjs');
  let cleanup; const f = fixture({ after(fn) { cleanup = fn; } }); f.enough(); await f.learn();
  const candidate = f.app.groupStyle.load(A).expressionExamples[0]; assert.ok(candidate);
  const server = await startConsoleFixture(); let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } }), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    // Chromium is sandboxed without network access. Serve the loopback fixture through
    // Playwright interception so the browser itself never opens a network connection.
    await page.route('**/*', async route => {
      const req = route.request(); if (!req.url().startsWith(server.url + '/')) { await route.abort(); return; }
      const incoming = Readable.from(req.postData() ? [req.postData()] : []);
      Object.assign(incoming, { url: new URL(req.url()).pathname + new URL(req.url()).search, method: req.method(), headers: req.headers() });
      let status = 200, headers = {}, body;
      await server.server.listeners('request')[0](incoming, { writeHead(s, h) { status = s; headers = h; }, end(value) { body = value; } });
      await route.fulfill({ status, headers, body });
    });
    await page.route('**/api/bigfatfish/**', async route => {
      const request = route.request(), url = new URL(request.url()), body = request.method() === 'GET' ? Object.fromEntries(url.searchParams) : request.postDataJSON();
      let data;
      try {
        if (url.pathname.endsWith('/group-style')) data = body.action === 'preview' ? { ok: true, ...f.app.styleResolver.assemble(body.key, f.app.states.get(body.key), { query: body.message, preview: true }) } : f.app.groupStyle.admin(request.method(), body);
        else if (url.pathname.endsWith('/global-style')) data = f.app.globalStyle.admin(request.method(), body);
        else if (url.pathname.endsWith('/personas')) data = { ok: true, revision: 0, roles: [], sessions: [], defaultRole: null };
        else if (url.pathname.endsWith('/status')) data = { ok: true, settings: f.app.settings, allow: f.config.allow, deny: f.config.deny, sessions: [], requests: [], capabilities: {}, nativeSwitches: {}, research: f.app.research.snapshot(), legacy: [], voice: {} };
        else data = { ok: true, entries: [], sessions: [], jobs: [], rows: [] };
      } catch(e) { data = { ok: false, error: e.message }; }
      await route.fulfill({ json: data });
    });
    await page.route('**/api/slang', route => route.fulfill({ json: { entries: [] } }));
    await page.goto(server.url + '/#bff-group-style');
    await page.locator('#bfGroupSelect').selectOption(A); await page.locator('#bfGroupStatus').filter({ hasText: '24 条' }).waitFor();
    assert.equal(await page.locator('#bfGroupExpressions details').count(), 1);
    await page.locator('#bfGroupExpressions button').filter({ hasText: '审核发布' }).click();
    await page.waitForFunction(() => document.querySelector('#bfGroupExpressions summary')?.textContent.includes('approved'));
    assert.equal(f.app.groupStyle.active(A).expressionExamples.length, 1); assert.equal(f.app.groupStyle.active(B).expressionExamples.length, 0);
    await page.locator('#bfGroupConfig input[name=apply]').uncheck(); await page.locator('#bfGroupConfig button').click();
    await page.waitForFunction(() => !document.querySelector('#bfGroupConfig input[name=apply]').checked); assert.equal(f.app.groupStyle.load(A).apply, false);
    await page.locator('#bfGroupPreview input').fill('请帮我解释代码为什么报错？'); await page.locator('#bfGroupPreview button').click();
    await page.locator('#bfGroupPreviewResult').filter({ hasText: 'help' }).waitFor(); assert.equal(f.app.groupStyle.load(B).version, 0);
    const version = f.app.groupStyle.load(A).version;
    await page.locator('#bfGroupPreview input').fill('<img src=x onerror=alert(1)>'); await page.locator('#bfGroupPreview button').click();
    assert.equal(f.app.groupStyle.load(A).version, version); assert.equal(await page.locator('#bfGroupPreviewResult img').count(), 0);
    await page.locator('#bfGroupSelect').selectOption(B); await page.locator('#bfGroupStatus').filter({ hasText: B }).waitFor();
    assert.equal(await page.locator('#bfGroupExpressions details').count(), 0);
    assert.deepEqual(errors, []);
    fs.mkdirSync(path.join(root, 'output'), { recursive: true });
    await page.locator('#bfGroupSelect').selectOption(A); await page.locator('#bfGroupStatus').filter({ hasText: A }).waitFor();
    await page.screenshot({ path: path.join(root, 'output/group-style-console.png'), fullPage: true });
    console.log('PASS: isolated console renders candidates, approves, toggles scope, previews safely, switches groups. Screenshot: output/group-style-console.png');
  } finally { if (browser) await browser.close(); await server.close(); cleanup(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
