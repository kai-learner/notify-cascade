/**
 * notify-cascade unit tests
 * Uses Node's built-in assert + lightweight HTTP mocks (no test framework needed).
 * Run: node test/index.test.js
 */

const assert = require('assert');
const http = require('http');

// ─── Test runner ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ ${name}`);
    console.error(`     ${err.message}`);
    failed++;
  }
}

function createMockServer(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, url: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

// ─── Set up minimal GitHub Actions env ───────────────────────────────────────

Object.assign(process.env, {
  GITHUB_REPOSITORY: 'test-owner/test-repo',
  GITHUB_RUN_ID: '12345',
  GITHUB_RUN_NUMBER: '42',
  GITHUB_ACTOR: 'test-actor',
  GITHUB_EVENT_NAME: 'push',
  GITHUB_REF: 'refs/heads/main',
  GITHUB_SHA: 'abc123def456',
  GITHUB_SERVER_URL: 'https://github.com',
});

// ─── Run all tests ────────────────────────────────────────────────────────────

(async () => {
  const { sendWebhook } = require('../src/webhook');
  const { sendSlack } = require('../src/slack');

  // ── webhook.js ──────────────────────────────────────────────────────────────
  console.log('\n📦 webhook.js');

  await test('skips when no URL provided', async () => {
    const result = await sendWebhook({ webhookUrl: null, method: 'POST', message: 'test', title: 'T' });
    assert.strictEqual(result.status, 'skipped');
  });

  await test('sends POST with default payload', async () => {
    let body = null, method = null;
    const { server, url } = await createMockServer((req, res) => {
      method = req.method;
      let d = '';
      req.on('data', c => d += c);
      req.on('end', () => { body = JSON.parse(d); res.writeHead(200); res.end('ok'); });
    });

    const result = await sendWebhook({ webhookUrl: url, method: 'POST', message: 'hello', title: 'Test' });
    await closeServer(server);

    assert.strictEqual(result.status, 'sent');
    assert.strictEqual(method, 'POST');
    assert.strictEqual(body.message, 'hello');
    assert.strictEqual(body.repository, 'test-owner/test-repo');
    assert.ok(body.run_url.includes('test-owner/test-repo'));
  });

  await test('substitutes template placeholders', async () => {
    let body = null;
    const { server, url } = await createMockServer((req, res) => {
      let d = '';
      req.on('data', c => d += c);
      req.on('end', () => { body = JSON.parse(d); res.writeHead(200); res.end('ok'); });
    });

    await sendWebhook({
      webhookUrl: url,
      method: 'POST',
      bodyTemplate: '{"summary": "{{title}} in {{repository}}", "msg": "{{message}}"}',
      message: 'deploy done',
      title: 'Deploy',
    });
    await closeServer(server);

    assert.strictEqual(body.summary, 'Deploy in test-owner/test-repo');
    assert.strictEqual(body.msg, 'deploy done');
  });

  await test('returns failed on 5xx response', async () => {
    const { server, url } = await createMockServer((req, res) => {
      req.resume(); res.writeHead(500); res.end('err');
    });
    const result = await sendWebhook({ webhookUrl: url, method: 'POST', message: 'x', title: 'X' });
    await closeServer(server);
    assert.strictEqual(result.status, 'failed');
    assert.ok(result.error.includes('500'));
  });

  await test('handles malformed headers JSON without throwing', async () => {
    const { server, url } = await createMockServer((req, res) => {
      req.resume(); res.writeHead(200); res.end('ok');
    });
    const result = await sendWebhook({
      webhookUrl: url, method: 'POST',
      headersJson: '{ not valid json',
      message: 'x', title: 'X',
    });
    await closeServer(server);
    assert.strictEqual(result.status, 'sent');
  });

  // ── slack.js ────────────────────────────────────────────────────────────────
  console.log('\n📦 slack.js');

  await test('skips when no webhook URL', async () => {
    const result = await sendSlack({ webhookUrl: null, message: 'test', title: 'T' });
    assert.strictEqual(result.status, 'skipped');
  });

  await test('sends block-kit payload with header + section + context blocks', async () => {
    let body = null;
    const { server, url } = await createMockServer((req, res) => {
      let d = '';
      req.on('data', c => d += c);
      req.on('end', () => { body = JSON.parse(d); res.writeHead(200); res.end('ok'); });
    });

    const result = await sendSlack({
      webhookUrl: url,
      message: '*Build passed*',
      title: 'CI',
      username: 'Bot',
      iconEmoji: ':rocket:',
    });
    await closeServer(server);

    assert.strictEqual(result.status, 'sent');
    assert.ok(Array.isArray(body.blocks), 'should have blocks array');
    const header = body.blocks.find(b => b.type === 'header');
    const section = body.blocks.find(b => b.type === 'section');
    const context = body.blocks.find(b => b.type === 'context');
    assert.ok(header, 'missing header block');
    assert.strictEqual(header.text.text, 'CI');
    assert.ok(section, 'missing section block');
    assert.strictEqual(section.text.text, '*Build passed*');
    assert.ok(context, 'missing context block');
    assert.ok(context.elements[0].text.includes('test-owner/test-repo'));
    assert.strictEqual(body.username, 'Bot');
    assert.strictEqual(body.icon_emoji, ':rocket:');
  });

  await test('overrides channel when provided', async () => {
    let body = null;
    const { server, url } = await createMockServer((req, res) => {
      let d = '';
      req.on('data', c => d += c);
      req.on('end', () => { body = JSON.parse(d); res.writeHead(200); res.end('ok'); });
    });
    await sendSlack({ webhookUrl: url, message: 'x', title: 'X', channel: '#alerts' });
    await closeServer(server);
    assert.strictEqual(body.channel, '#alerts');
  });

  await test('omits channel key when not provided', async () => {
    let body = null;
    const { server, url } = await createMockServer((req, res) => {
      let d = '';
      req.on('data', c => d += c);
      req.on('end', () => { body = JSON.parse(d); res.writeHead(200); res.end('ok'); });
    });
    await sendSlack({ webhookUrl: url, message: 'x', title: 'X' });
    await closeServer(server);
    assert.ok(!('channel' in body), 'channel should not be present when not specified');
  });

  await test('returns failed on 4xx Slack response', async () => {
    const { server, url } = await createMockServer((req, res) => {
      req.resume(); res.writeHead(400); res.end('invalid_payload');
    });
    const result = await sendSlack({ webhookUrl: url, message: 'x', title: 'X' });
    await closeServer(server);
    assert.strictEqual(result.status, 'failed');
  });

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(44)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
