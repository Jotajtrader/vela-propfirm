// FASE 0 — spike. Valida los dos riesgos del diseño antes de portar la UI:
//  1. el replay entra por la vía de datos en vivo (ReplayProvider.subscribe) y Vela recalcula
//     indicadores nativos + Pine en cada paso;
//  2. un salto grande (saltar día) y el Reset (rebobinar) se resuelven forzando una recarga del
//     mercado contra la caché de barras cerradas de Vela.
// La barra de control de abajo es provisional: la definitiva llega en la fase 2.
// `?autotest=1` corre la secuencia completa sin intervención y escribe el resultado en #spike-results.
import { VelaWorkspace } from '@luxalgo/vela/workspace';
import { sharedBarStore, type Vela } from '@luxalgo/vela';
import { registerWidgetAttachment } from '@luxalgo/vela/plugin';
import { PineWorkerEngine } from '@luxalgo/vela-pinets';
import { ReplayProvider } from '../src/vela/ReplayProvider';
import { genSample, fmtTime } from '../src/engine/data';

const params = new URLSearchParams(location.search);
const AUTOTEST = params.has('autotest');
// Estrategia de recarga forzada para saltos/Reset. `setMarket` con el mismo mercado es no-op, así
// que hay que cambiar la identidad: 'session' alterna regular/extended (Vela conserva el zoom en un
// flip de sesión); 'suffix' cambia el sufijo opaco del ticker (NQ.r1 → NQ.r2). `?reload=suffix` prueba la otra.
const RELOAD: 'session' | 'suffix' = params.get('reload') === 'suffix' ? 'suffix' : 'session';
const TF = '5';

const replay = new ReplayProvider();
replay.load(genSample(6, 180));

let generation = 0;
async function forceReload(chart: Vela): Promise<void> {
    sharedBarStore.clear();
    generation++;
    if (RELOAD === 'session') await chart.setMarket({ session: generation % 2 ? 'extended' : 'regular' });
    else await chart.setMarket({ symbol: `replay:NQ.r${generation}` });
}

function endOfDayIndex(): number {
    const today = replay.current()?.day;
    let i = replay.cursor;
    while (i < replay.length - 1 && replay.native[i]!.day === today) i++;
    return i;
}

registerWidgetAttachment({
    id: 'propfirm.spike-bar',
    mount: (ctx) => {
        const bar = document.createElement('div');
        bar.style.cssText =
            'position:absolute;left:50%;bottom:44px;transform:translateX(-50%);z-index:20;display:flex;gap:6px;align-items:center;' +
            'padding:6px 10px;border-radius:var(--vela-radius-md);background:var(--vela-surface-overlay);border:1px solid var(--vela-border-soft);' +
            'color:var(--vela-fg);font:12px/1.4 var(--vela-font-family,system-ui);box-shadow:0 4px 16px #0006';
        const mk = (label: string, onClick: () => void): HTMLButtonElement => {
            const b = document.createElement('button');
            b.textContent = label;
            b.style.cssText =
                'all:unset;padding:4px 10px;border-radius:var(--vela-radius-sm);background:var(--vela-surface-raised,#2a2e39);cursor:pointer;';
            b.addEventListener('click', onClick);
            bar.appendChild(b);
            return b;
        };
        const status = document.createElement('span');
        status.style.cssText = 'margin-left:8px;color:var(--vela-fg-muted);font-variant-numeric:tabular-nums;';

        const startIdx = replay.cursor;
        let timer: ReturnType<typeof setInterval> | null = null;
        const refresh = (): void => {
            const b = replay.current();
            status.textContent = b ? `bar ${replay.cursor + 1} / ${replay.length} · ${b.day} ${fmtTime(b.t)}` : '—';
        };
        const stop = (): void => {
            if (timer) clearInterval(timer);
            timer = null;
            play.textContent = '▶ Play';
        };
        const step = (): void => {
            if (!replay.step()) stop();
            refresh();
        };
        const play = mk('▶ Play', () => {
            if (timer) return stop();
            play.textContent = '⏸ Pause';
            timer = setInterval(step, 120);
        });
        mk('Step ▸', step);
        mk('⏭ Saltar día', () => {
            stop();
            replay.setCursor(endOfDayIndex());
            refresh();
            void forceReload(ctx.chart).then(() => ctx.toast(`Recarga tras salto (${RELOAD})`, 'info'));
        });
        mk('🔄 Reset', () => {
            stop();
            replay.setCursor(startIdx);
            refresh();
            void forceReload(ctx.chart).then(() => ctx.toast(`Reset → bar ${startIdx + 1} (${RELOAD})`, 'info'));
        });
        bar.appendChild(status);
        refresh();
        ctx.host.appendChild(bar);
        return () => {
            stop();
            bar.remove();
        };
    },
});

const ws = new VelaWorkspace('#chart', {
    layout: false,
    symbol: 'replay:NQ',
    timeframe: TF,
    live: true,
    theme: 'dark',
    autofocus: true,
    persist: false,
    timeframes: ['1', '5', '15', '30', '60', '240', 'D'],
    providers: { replay: () => replay },
    engines: { pine: () => new PineWorkerEngine() },
    defaultLanguage: 'pine',
    indicators: [
        {
            name: 'EMA 20',
            enabled: true,
            script: `//@version=5
indicator("EMA 20", overlay=true)
plot(ta.ema(close, 20), color=color.orange, linewidth=2)`,
        },
        {
            // Sonda del autotest: lo que Pine ve como última vela (open-time y close) tiene que
            // coincidir con la cubeta agregada del cursor del replay en todo momento.
            name: 'PROBE',
            enabled: AUTOTEST,
            script: `//@version=5
indicator("PROBE", overlay=true)
plot(time, "t", display=display.none)
plot(close, "c", display=display.none)`,
        },
    ],
});

// Telemetría del spike: cada barra que entra al core y cada recálculo del script.
let barsIn = 0;
let runs = 0;
ws.chart.on('bar', () => {
    barsIn++;
});
ws.on('script:run', (run) => {
    runs++;
    if (!AUTOTEST && runs % 25 === 0) console.log(`[spike] ${barsIn} barras recibidas · ${runs} runs de "${run.title}" (última causa: ${run.cause})`);
});
void ws.chart.ready().then(() => console.log('[spike] chart listo — cursor en', replay.cursor + 1, '/', replay.length));

(window as unknown as { ws: VelaWorkspace; replay: ReplayProvider }).ws = ws;
(window as unknown as { ws: VelaWorkspace; replay: ReplayProvider }).replay = replay;

// ── autotest ──────────────────────────────────────────────────────────────────────────────
interface Run {
    title: string;
    cause: string;
    bar: number;
    plots: Record<string, unknown>;
}

if (AUTOTEST) void runAutotest();

async function runAutotest(): Promise<void> {
    const pre = document.createElement('pre');
    pre.id = 'spike-results';
    pre.style.cssText =
        'position:absolute;top:40px;left:8px;z-index:99;color:#9f9;background:#000c;padding:8px;font:11px/1.4 monospace;max-width:640px;white-space:pre-wrap;margin:0';
    document.body.appendChild(pre);
    const out: string[] = [];
    let ok = 0;
    let fail = 0;
    const log = (s: string): void => {
        out.push(s);
        pre.textContent = out.join('\n');
        console.log('[autotest]', s);
    };
    const check = (cond: boolean, label: string, detail = ''): void => {
        cond ? ok++ : fail++;
        log(`${cond ? 'PASS' : 'FAIL'} ${label}${detail ? ' — ' + detail : ''}`);
    };
    const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
    const waitFor = async (pred: () => boolean, ms: number): Promise<boolean> => {
        const t0 = Date.now();
        while (Date.now() - t0 < ms) {
            if (pred()) return true;
            await sleep(100);
        }
        return pred();
    };

    // Objeto contenedor a propósito: TS estrecha un `let` asignado solo desde un callback a `never`.
    const probe: { last: Run | null } = { last: null };
    ws.on('script:run', (run) => {
        if (run.title === 'PROBE') probe.last = run;
    });
    const last = (): Run | null => probe.last;
    const probeT = (): number => (last()?.plots as Record<string, number> | undefined)?.t ?? NaN;
    const probeC = (): number => (last()?.plots as Record<string, number> | undefined)?.c ?? NaN;
    const expected = (): { t: number; c: number } => {
        const b = replay.currentBucket(TF)!;
        return { t: b.t.getTime(), c: b.c };
    };
    const probeMatches = (): boolean => probeT() === expected().t && probeC() === expected().c;
    const describeProbe = (): string => `probe t=${probeT()} c=${probeC()} · esperado t=${expected().t} c=${expected().c} · bar#${last()?.bar} causa=${last()?.cause}`;

    try {
        log(`reload=${RELOAD} tf=${TF} dataset=${replay.length} barras · cursor inicial ${replay.cursor + 1}`);
        await ws.chart.ready();
        log('chart.ready()');
        check(await waitFor(() => last() != null, 20000), '1. Pine (worker) ejecutó la sonda tras la carga inicial', describeProbe());
        check(probeMatches(), '2. carga inicial: última vela de Pine = cubeta del cursor', describeProbe());

        const bars0 = barsIn;
        const bar0 = last()?.bar ?? -1;
        for (let i = 0; i < 12; i++) {
            replay.step();
            await sleep(40);
        }
        const streamed = await waitFor(probeMatches, 6000);
        check(streamed, '3. stream: 12 pasos por subscribe → Pine recalculó hasta el cursor', describeProbe());
        check(barsIn - bars0 === 12, '4. stream: el core recibió exactamente 12 barras', `recibidas ${barsIn - bars0}`);
        check((last()?.bar ?? -1) > bar0, '5. stream: el índice de barra creció (5m: 12 pasos de 1m ≈ 2-3 velas nuevas)', `bar# ${bar0} → ${last()?.bar}`);

        const beforeJump = replay.cursor;
        replay.setCursor(endOfDayIndex());
        const barBeforeJump = last()?.bar ?? -1;
        await forceReload(ws.chart);
        const jumped = await waitFor(() => probeMatches() && (last()?.bar ?? -1) > barBeforeJump, 10000);
        check(jumped, `6. salto: saltar día (${beforeJump + 1} → ${replay.cursor + 1}) + recarga forzada → Pine ve el nuevo cursor`, describeProbe());

        const startIdx = 80;
        const barBeforeReset = last()?.bar ?? -1;
        replay.setCursor(startIdx);
        await forceReload(ws.chart);
        const rewound = await waitFor(() => probeMatches() && (last()?.bar ?? -1) < barBeforeReset, 10000);
        check(rewound, `7. reset: rebobinado a la barra ${startIdx + 1} + recarga → la caché no devolvió barras futuras`, `${describeProbe()} · bar# ${barBeforeReset} → ${last()?.bar}`);

        const bars1 = barsIn;
        for (let i = 0; i < 6; i++) {
            replay.step();
            await sleep(40);
        }
        const streamed2 = await waitFor(probeMatches, 6000);
        check(streamed2, '8. stream tras recarga: la suscripción se restableció sola', describeProbe());
        check(barsIn - bars1 === 6, '9. stream tras recarga: 6 barras recibidas', `recibidas ${barsIn - bars1}`);
        check(!!document.querySelector('.vela-topbar, [class*="vela-"]'), '10. shell de Vela montado (chrome presente)');
    } catch (err) {
        fail++;
        log(`EXCEPCIÓN: ${(err as Error)?.stack ?? String(err)}`);
    }
    log(`DONE ok=${ok} fail=${fail} · runs totales=${runs} · barras al core=${barsIn}`);
    document.title = `SPIKE DONE ok=${ok} fail=${fail}`;
}
