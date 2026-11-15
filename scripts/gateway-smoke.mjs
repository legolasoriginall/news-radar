// بررسی دودی درگاه Respan: یک تأمین‌کنندهٔ ساختگی محلی (بدون کلید واقعی) بالا می‌آید،
// درگاه Respan از مسیر gateway/serve.py اجرا می‌شود و گفت‌وگوی ابزاری دستیار مدیر
// دقیقاً از مسیر برنامه (runAssistant → chatWithTools → درگاه) عبور می‌کند.
//
// اجرا: npm run gateway:check   (پیش‌نیاز: .venv با respan-gateway==0.3.0)

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runAssistant, llmConfig } from '../src/admin.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const FINAL_REPLY = 'وضعیت سایت از درگاه Respan خوانده شد.';

/** تأمین‌کنندهٔ ساختگی سازگار با OpenAI: یک دور ابزار و بعد پاسخ نهایی. */
function startFixture() {
  const seen = [];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method === 'GET' && url.pathname === '/v1/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ object: 'list', data: [{ id: 'gpt-4o-mini', object: 'model', owned_by: 'fixture' }] }));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw || '{}');
      seen.push({ model: body.model, tools: Array.isArray(body.tools) ? body.tools.length : 0, messages: body.messages?.length || 0 });
      const toolAnswered = (body.messages || []).some((message) => message.role === 'tool');
      const message = toolAnswered
        ? { role: 'assistant', content: FINAL_REPLY }
        : {
            role: 'assistant',
            content: '',
            tool_calls: [
              { id: 'call_fixture_1', type: 'function', function: { name: 'site_status', arguments: '{}' } },
            ],
          };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 'fixture-1', object: 'chat.completion', choices: [{ index: 0, message, finish_reason: 'stop' }] }));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end('{"error":"not found"}');
  });
  return { server, seen };
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function waitFor(url, { timeoutMs = 25000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (response.ok) return await response.json();
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`درگاه در زمان مقرر پاسخ نداد: ${lastError?.message || 'بی‌پاسخ'}`);
}

async function main() {
  const fixture = startFixture();
  fixture.server.listen(0, '127.0.0.1');
  await once(fixture.server, 'listening');
  const fixtureUrl = `http://127.0.0.1:${fixture.server.address().port}`;

  const gatePort = await freePort();
  // کلید آزمایشی در یک env-file موقت می‌نشیند تا مسیر مستندشده (خواندن کلید از فایل) هم آزموده شود.
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'respan-smoke-'));
  const envFile = path.join(tempDir, 'gateway.env');
  await writeFile(envFile, `OPENAI_API_KEY=test-fixture-key\nRESPAN_OPENAI_BASE_URL=${fixtureUrl}/v1\n`, 'utf8');

  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/_API_KEY$/.test(key) || /^RESPAN_/.test(key)) delete env[key];
  }
  Object.assign(env, {
    RESPAN_GATEWAY_ENV_FILE: envFile,
    RESPAN_GATEWAY_HOST: '127.0.0.1',
    RESPAN_GATEWAY_PORT: String(gatePort),
    PYTHONUNBUFFERED: '1',
  });

  const python = path.join(ROOT, '.venv', 'bin', 'python');
  const gateway = spawn(python, [path.join(ROOT, 'gateway', 'serve.py')], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  gateway.stdout.on('data', (chunk) => { log += chunk; });
  gateway.stderr.on('data', (chunk) => { log += chunk; });

  const shutdown = async (code) => {
    gateway.kill('SIGTERM');
    fixture.server.close();
    await rm(tempDir, { recursive: true, force: true });
    if (code !== 0) console.error(log.trim());
    process.exit(code);
  };

  try {
    const models = await waitFor(`http://127.0.0.1:${gatePort}/v1/models`);
    const ids = (models.data || []).map((item) => item.id);
    if (!ids.includes('gpt-4o-mini')) throw new Error(`مدل آزمایشی در فهرست درگاه نیست: ${ids.join(', ') || 'خالی'}`);

    const config = llmConfig({ RESPAN_GATEWAY_URL: `http://127.0.0.1:${gatePort}`, RESPAN_GATEWAY_MODEL: 'gpt-4o-mini' });
    if (config.provider !== 'respan-gateway') throw new Error(`پیکربندی برنامه به درگاه وصل نشد: ${config.provider}`);

    const result = await runAssistant({
      messages: [{ role: 'user', content: 'وضعیت سایت چطور است؟' }],
      config,
      execute: async (name) => ({ ok: true, tool: name, sources_ok: 9, sources_total: 9 }),
    });

    if (result.reply !== FINAL_REPLY) throw new Error(`پاسخ از مسیر درگاه نیامد: ${JSON.stringify(result.reply)}`);
    if (!result.used.includes('site_status')) throw new Error('فراخوانی ابزار از درگاه رد نشد');
    if (fixture.seen.length < 2) throw new Error('درخواست‌ها به تأمین‌کننده نرسیدند');

    console.log('✓ درگاه Respan بالا آمد:', `http://127.0.0.1:${gatePort}/v1`);
    console.log('✓ مدل‌های درگاه:', ids.join(', '));
    console.log('✓ گفت‌وگوی ابزاری دستیار از درگاه عبور کرد؛ ابزارها:', result.used.join(', '));
    console.log('✓ درخواست‌های رسیده به تأمین‌کنندهٔ ساختگی:', fixture.seen.length);
    console.log('✓ پاسخ نهایی:', result.reply);
    await shutdown(0);
  } catch (error) {
    console.error('× بررسی درگاه شکست خورد:', error.message);
    await shutdown(1);
  }
}

main();
