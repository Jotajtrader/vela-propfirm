// Corre una página del playground en Chrome headless vía CDP, en TIEMPO REAL (a diferencia de
// `--dump-dom --virtual-time-budget`, que vence el presupuesto antes de que el worker de Pine
// responda), espera a que `document.title` empiece por "SPIKE DONE" y vuelca #spike-results más
// la consola del navegador. Uso: node scripts/headless-autotest.mjs [url]
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const url = process.argv[2] ?? 'http://localhost:5193/?autotest=1';
const chrome = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const timeoutMs = Number(process.env.TIMEOUT_MS) || 120_000;
const port = 9300 + Math.floor(Math.random() * 500);
const profile = mkdtempSync(join(tmpdir(), 'vela-spike-'));

const proc = spawn(
    chrome,
    ['--headless=new', '--disable-gpu', '--no-sandbox', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--window-size=1400,900', 'about:blank'],
    { stdio: 'ignore' },
);

async function waitForDevtools() {
    for (let i = 0; i < 100; i++) {
        try {
            const r = await fetch(`http://127.0.0.1:${port}/json/version`);
            if (r.ok) return;
        } catch {
            /* todavía no escucha */
        }
        await sleep(200);
    }
    throw new Error('Chrome no expuso el puerto de DevTools');
}

try {
    await waitForDevtools();
    const target = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
        ws.onopen = res;
        ws.onerror = rej;
    });

    let nextId = 0;
    const pending = new Map();
    const logs = [];
    ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.id && pending.has(msg.id)) {
            pending.get(msg.id)(msg);
            pending.delete(msg.id);
        } else if (msg.method === 'Runtime.consoleAPICalled') {
            logs.push(`[${msg.params.type}] ${msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`);
        } else if (msg.method === 'Runtime.exceptionThrown') {
            const d = msg.params.exceptionDetails;
            logs.push(`[exception] ${d.exception?.description ?? d.text}`);
        } else if (msg.method === 'Log.entryAdded') {
            logs.push(`[log:${msg.params.entry.level}] ${msg.params.entry.text}`);
        }
    };
    const send = (method, params = {}) =>
        new Promise((res) => {
            const id = ++nextId;
            pending.set(id, res);
            ws.send(JSON.stringify({ id, method, params }));
        });
    const evalJs = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true })).result?.result?.value;

    await send('Runtime.enable');
    await send('Log.enable');

    // WAIT_MS=n: en vez de esperar el "SPIKE DONE", espera n ms (modo captura visual).
    const waitMs = Number(process.env.WAIT_MS) || 0;
    const deadline = Date.now() + timeoutMs;
    let title = '';
    if (waitMs > 0) await sleep(waitMs);
    else {
        while (Date.now() < deadline) {
            title = (await evalJs('document.title')) ?? '';
            if (title.startsWith('SPIKE DONE')) break;
            await sleep(500);
        }
    }
    // SCREENSHOT=ruta.png: captura la página al terminar.
    if (process.env.SCREENSHOT) {
        const shot = await send('Page.captureScreenshot', { format: 'png' });
        const { writeFileSync } = await import('node:fs');
        writeFileSync(process.env.SCREENSHOT, Buffer.from(shot.result.data, 'base64'));
        console.log(`captura: ${process.env.SCREENSHOT}`);
    }
    const results = await evalJs('document.getElementById("spike-results")?.textContent ?? "(sin resultados)"');
    console.log(results);
    console.log('\n--- consola del navegador ---');
    for (const l of logs) console.log(l);
    console.log(`\n${title || (waitMs > 0 ? '(modo captura)' : '(timeout sin DONE)')}`);
    ws.close();
    process.exitCode = waitMs > 0 || title.includes('fail=0') ? 0 : 1;
} finally {
    proc.kill();
}
