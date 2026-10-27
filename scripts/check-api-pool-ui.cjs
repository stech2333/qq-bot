// UI acceptance with intercepted pool mutations. Never changes production keys or sends QQ messages.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const cfg = JSON.parse(fs.readFileSync(path.join(root, 'integrations/qq-bridge/config.json'), 'utf8'));
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(token => localStorage.setItem('consoleToken', token), cfg.consoleToken);
    const state = { ok: true, revision: 0, activeId: null, ready: true, fallback: { provider: 'deepseek-official', model: 'deepseek-flash' }, entries: [] };
    const writes = [];
    await page.route('**/api/model-pool**', async route => {
      const req = route.request();
      if (req.method() === 'GET') { await route.fulfill({ json: structuredClone(state) }); return; }
      const body = req.postDataJSON(), action = new URL(req.url()).pathname.split('/').pop(); writes.push({ body, action });
      if (body.revision !== state.revision) { await route.fulfill({ status: 409, json: { ok: false, error: 'API 池已被其他操作修改，请刷新后重试' } }); return; }
      let test;
      if (action === 'save') {
        const { apiKey, revision, ...entry } = body; entry.id ||= 'a'.repeat(32); entry.keyStored = true;
        state.entries = state.entries.filter(e => e.id !== entry.id).concat(entry);
      } else if (action === 'activate') state.activeId = body.id;
      else if (action === 'delete') state.entries = state.entries.filter(e => e.id !== body.id);
      else if (action === 'test') {
        test = { status: 'passed', message: '模型流式文本调用成功（页面验收）', elapsedMs: 100 };
        state.entries.find(e => e.id === body.id).lastTest = test;
      } else throw new Error('Unknown mock action');
      state.revision++;
      await route.fulfill({ json: { ...structuredClone(state), test } });
    });
    await page.goto(`http://127.0.0.1:${cfg.consolePort || 3106}/?token=${encodeURIComponent(cfg.consoleToken)}#model-pool`);
    await page.locator('#poolCurrent').filter({ hasText: '原接口' }).waitFor();
    assert.equal(await page.locator('#section-api-pool').isVisible(), true);
    await page.locator('#poolNew').click();
    await page.locator('#poolForm [name=name]').fill('页面验收 <img src=x>');
    await page.locator('#poolForm [name=baseURL]').fill('https://example.com/v1');
    await page.locator('#poolForm [name=model]').fill('test-model');
    await page.locator('#poolForm [name=apiKey]').fill('fixture-only-ui-key');
    await page.locator('#poolForm [name=deepseekCompat]').check();
    await page.locator('#poolForm [type=submit]').click();
    await page.locator('#poolNotice').filter({ hasText: '已保存' }).waitFor();
    assert.equal(writes.at(-1).body.apiKey, 'fixture-only-ui-key');
    assert.ok(!JSON.stringify(state).includes('fixture-only-ui-key'));
    assert.equal(await page.locator('#poolEntries img').count(), 0);
    assert.equal(await page.locator('#poolForm [name=apiKey]').inputValue(), '');
    await page.locator('[data-pool-action=edit]').click();
    assert.equal(await page.locator('#poolForm [name=apiKey]').inputValue(), '');
    await page.locator('#poolForm [name=name]').fill('编辑后的接口');
    await page.locator('#poolForm [type=submit]').click();
    await page.locator('#poolEntries h3').filter({ hasText: '编辑后的接口' }).waitFor();
    await page.locator('[data-pool-action=activate]').click();
    await page.locator('#poolCurrent').filter({ hasText: '编辑后的接口' }).waitFor();
    assert.equal(await page.locator('[data-pool-action=delete]').isDisabled(), true);
    await page.locator('[data-pool-action=test]').click();
    await page.locator('#poolNotice').filter({ hasText: '页面验收' }).waitFor();
    assert.equal(state.activeId, 'a'.repeat(32));
    await page.locator('#poolBuiltin').click();
    await page.locator('#poolCurrent').filter({ hasText: '原接口' }).waitFor();
    await page.locator('[data-pool-action=edit]').click();
    await page.locator('#poolForm [name=name]').fill('未保存草稿');
    state.revision++;
    await page.locator('#poolRefresh').click();
    await page.locator('#poolForm [type=submit]').click();
    await page.locator('#poolNotice').filter({ hasText: '其他操作修改' }).waitFor();
    assert.equal(await page.locator('#poolForm [name=name]').inputValue(), '未保存草稿');
    await page.locator('#poolCancel').click();
    page.once('dialog', dialog => dialog.accept()); await page.locator('[data-pool-action=delete]').click();
    await page.locator('#poolEntries').filter({ hasText: '尚无 API 条目' }).waitFor();
    assert.equal(state.entries.length, 0); assert.equal(errors.length, 0, errors.join('\n'));
    await page.locator('#poolNew').click();
    await page.screenshot({ path: path.join(root, 'logs/audit/api-pool-ui.png'), fullPage: true });
    console.log('PASS: pool page, add/edit, masked key, switching, internal test, active deletion guard, stale draft, delete, XSS safety; production pool unchanged.');
  } finally { await browser.close(); }
})().catch(error => { console.error(String(error.message).replaceAll(cfg.consoleToken, '[hidden]')); process.exitCode = 1; });
