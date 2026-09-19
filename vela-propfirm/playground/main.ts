// Playground de vela-propfirm: el workspace de Vela + Pine (worker) + el simulador de fondeo.
// `?autotest=1` corre una secuencia sin intervención y escribe el resultado en #spike-results.
import { VelaWorkspace } from '@luxalgo/vela/workspace';
import { PineWorkerEngine } from '@luxalgo/vela-pinets';
import { Simulator } from '../src/engine/Simulator';
import { genSample } from '../src/engine/data';
import { createPropFirm, currentOverlay } from '../src/vela';

const params = new URLSearchParams(location.search);
const AUTOTEST = params.has('autotest');
const TF = '5';

const sim = new Simulator();
sim.loadBars(genSample(6, 180));
const propfirm = createPropFirm(sim);

const ws = new VelaWorkspace('#chart', {
    layout: false,
    symbol: 'replay:NQ',
    timeframe: TF,
    live: true,
    theme: params.get('theme') === 'light' ? 'light' : 'dark',
    autofocus: true,
    // Persistencia del shell (mercado, config, dibujos, paneles) + nuestras prefs vía registerStatePersistence.
    // El autotest y las capturas corren en perfiles de Chrome vacíos, así que arrancan limpios igual.
    persist: params.has('nopersist') ? false : 'vela-propfirm',
    timeframes: ['1', '5', '15', '30', '60', '240', 'D'],
    providers: { replay: () => propfirm.provider },
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
const install = propfirm.attach(ws);

let barsIn = 0;
let runs = 0;
ws.chart.on('bar', () => {
    barsIn++;
});
ws.on('script:run', () => {
    runs++;
});
void ws.chart.ready().then(() => console.log('[propfirm] chart listo — cursor en', sim.state.idx + 1, '/', sim.state.bars.length));

Object.assign(window as unknown as Record<string, unknown>, { ws, sim, propfirm: install });

// `?demo=1`: deja una posición con SL/TP, órdenes de trabajo y un trade cerrado a la vista.
// `?agent=1`: corre una corrida entera del agente en modo rápido (datos para el Tracker).
// `&panel=backtest|tracker`: abre ese panel por su botón del topbar, como lo haría el usuario.
// `&dialog=buy|order|agent`: abre además un diálogo desde el panel Backtest.
const openPanel = params.get('panel');
const clickTopbar = (label: string): void => {
    (document.querySelector(`[aria-label="${label}"]`) as HTMLElement | null)?.click();
};
void ws.chart.ready().then(async () => {
    if (params.has('demo')) {
        sim.buyAccounts(sim.state.templates[0]!, 1);
        sim.openPosition(1, 2, 6, 9);
        for (let i = 0; i < 25; i++) sim.step();
        sim.flatten();
        sim.openPosition(-1, 2, 12, 18);
        const px = sim.currentPrice();
        sim.placeOrder(1, 'limit', px - 20, 1, 5, 10);
        sim.placeOrder(-1, 'stop', px - 30, 1, 5, 10);
    }
    if (params.has('agent')) {
        sim.applyAgentConfig({
            tplId: 't1',
            dateFrom: null,
            dateTo: null,
            startTimeOfDay: { h: 9, m: 35 },
            endTimeOfDay: { h: 12, m: 0 },
            challengeTarget: 3,
            maxFundedActive: 2,
            maxWaiting: 2,
            profitPauseChallenge: 250,
            profitPauseFundedDay1: 200,
            profitPauseFundedRest: 100,
            waitMinMin: 1,
            waitMaxMin: 4,
            qty: 2,
        });
        await sim.fastForward({ chunkMs: 20 });
    }
    if (openPanel) setTimeout(() => clickTopbar(openPanel === 'tracker' ? 'Centro de control' : 'Trading Panel'), 300);
    // `&sub=equity|log&acct=N`: en el Tracker, elige la sub-pestaña y la N-ésima cuenta listada.
    if (openPanel === 'tracker' && (params.has('sub') || params.has('acct')))
        setTimeout(() => {
            const n = Number(params.get('acct') ?? -1);
            if (n >= 0) (document.querySelectorAll<HTMLElement>('.pf-trk .pf-card')[n] ?? null)?.click();
            const sub = params.get('sub');
            if (sub) [...document.querySelectorAll<HTMLButtonElement>('.pf-trk .subtabs .pf-btn')].find((b) => b.textContent?.includes(sub === 'equity' ? 'Equity' : 'Registro'))?.click();
        }, 900);
    const dlg = params.get('dialog');
    if (dlg)
        setTimeout(() => {
            const label = dlg === 'buy' ? '+ Comprar cuentas' : dlg === 'order' ? '▲ COMPRAR' : '⚙ Configurar';
            [...document.querySelectorAll<HTMLButtonElement>('.pf-btn')].find((x) => x.textContent?.trim() === label)?.click();
        }, 900);
});

// ── autotest ──────────────────────────────────────────────────────────────────────────────
interface Run {
    title: string;
    cause: string;
    bar: number;
    plots: Record<string, unknown>;
}

if (params.get('autotest') === 'persist') void runPersistTest();
else if (AUTOTEST) void runAutotest();

/** `?autotest=persist`: cambia prefs, deja que el shell las guarde, recarga y comprueba que volvieron. */
async function runPersistTest(): Promise<void> {
    const pre = document.createElement('pre');
    pre.id = 'spike-results';
    pre.style.cssText = 'position:absolute;top:40px;left:8px;z-index:99;color:#9f9;background:#000c;padding:8px;font:11px/1.4 monospace;margin:0';
    document.body.appendChild(pre);
    const out: string[] = [];
    let ok = 0;
    let fail = 0;
    const log = (s: string): void => {
        out.push(s);
        pre.textContent = out.join('\n');
    };
    const check = (cond: boolean, label: string): void => {
        cond ? ok++ : fail++;
        log(`${cond ? 'PASS' : 'FAIL'} ${label}`);
    };
    await ws.chart.ready();
    if (params.get('phase') !== '2') {
        sim.setSimMode('challenge');
        sim.setInstrument('GC');
        sim.setCommission(1.75);
        sim.saveAtmPreset('t1', { name: 'Persistido', type: 'market', qty: 1, sl: 5, tp: 5, price: null });
        log('fase 1: prefs cambiadas, esperando el guardado del shell…');
        await new Promise((r) => setTimeout(r, 1500));
        const url = new URL(location.href);
        url.searchParams.set('phase', '2');
        location.href = url.toString();
        return;
    }
    check(sim.state.simMode === 'challenge', `fase 2: simMode restaurado (${sim.state.simMode})`);
    check(sim.state.instr === 'GC', `fase 2: instrumento restaurado (${sim.state.instr})`);
    check(sim.state.comm === 1.75, `fase 2: comisión restaurada (${sim.state.comm})`);
    check(sim.atmPresets('t1').some((p) => p.name === 'Persistido'), 'fase 2: preset ATM restaurado');
    check(sim.state.accounts.length === 0 && sim.state.agent.active === false, 'fase 2: sin cuentas ni agente activo (solo prefs)');
    log(`DONE ok=${ok} fail=${fail}`);
    document.title = `SPIKE DONE ok=${ok} fail=${fail}`;
}

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
    const probe: { last: Run | null } = { last: null };
    ws.on('script:run', (run) => {
        if (run.title === 'PROBE') probe.last = run;
    });
    const last = (): Run | null => probe.last;
    const probeT = (): number => (last()?.plots as Record<string, number> | undefined)?.t ?? NaN;
    const probeC = (): number => (last()?.plots as Record<string, number> | undefined)?.c ?? NaN;
    const expected = (): { t: number; c: number } => {
        const b = propfirm.provider.currentBucket(TF)!;
        return { t: b.t.getTime(), c: b.c };
    };
    const probeMatches = (): boolean => probeT() === expected().t && probeC() === expected().c;
    const describeProbe = (): string => `probe t=${probeT()} c=${probeC()} · esperado t=${expected().t} c=${expected().c} · bar#${last()?.bar} causa=${last()?.cause}`;

    try {
        log(`tf=${TF} dataset=${sim.state.bars.length} barras · cursor inicial ${sim.state.idx + 1}`);
        await ws.chart.ready();
        check(await waitFor(() => last() != null, 20000), '1. Pine (worker) ejecutó la sonda tras la carga inicial', describeProbe());
        check(probeMatches(), '2. carga inicial: última vela de Pine = cubeta del cursor', describeProbe());
        check(!!document.querySelector('.pf-replay'), '3. la barra de replay está montada sobre el chart');

        const bars0 = barsIn;
        for (let i = 0; i < 12; i++) {
            sim.step();
            await sleep(40);
        }
        check(await waitFor(probeMatches, 6000), '4. stream: 12 pasos del simulador → Pine recalculó hasta el cursor', describeProbe());
        check(barsIn - bars0 === 12, '5. stream: el core recibió exactamente 12 barras', `recibidas ${barsIn - bars0}`);

        sim.buyAccounts(sim.state.templates[0]!, 1);
        sim.openPosition(1, 2, 10, 20);
        await sleep(50);
        const ov = currentOverlay();
        check(!!ov?.position && ov.position.side === 1 && ov.position.qty === 2, '6. overlay: la posición abierta llegó a la capa', JSON.stringify(ov?.position));
        check(ov?.ddPrice != null && ov.dailyPrice != null, '7. overlay: niveles de DD y límite diario calculados', `dd=${ov?.ddPrice} dll=${ov?.dailyPrice}`);

        const startIdx = sim.state.idx;
        const barBeforeJump = last()?.bar ?? -1;
        sim.skipDay();
        check(await waitFor(() => probeMatches() && (last()?.bar ?? -1) > barBeforeJump, 12000), `8. saltar día (${startIdx + 1} → ${sim.state.idx + 1}) → recarga → Pine ve el nuevo cursor`, describeProbe());
        check(!sim.state.accounts[0]!.position && sim.state.accounts[0]!.tradeLog.length === 1, '9. saltar día flateó la posición y quedó en el registro', `trades=${sim.state.accounts[0]!.tradeLog.length}`);
        check(install.bridge.reloads === 1, '10. una sola recarga forzada para el salto', `reloads=${install.bridge.reloads}`);

        const barBeforeReset = last()?.bar ?? -1;
        sim.resetAgentRun();
        check(await waitFor(() => probeMatches() && (last()?.bar ?? -1) < barBeforeReset, 12000), '11. Reset: rebobinado a la foto + recarga → la caché no devolvió barras futuras', `${describeProbe()} · bar# ${barBeforeReset} → ${last()?.bar}`);
        check(sim.state.accounts.length === 0, '12. Reset deshizo la compra (foto tomada antes de la primera compra)');

        const bars1 = barsIn;
        for (let i = 0; i < 6; i++) {
            sim.step();
            await sleep(40);
        }
        check(await waitFor(probeMatches, 6000), '13. stream tras recarga: la suscripción se restableció sola', describeProbe());
        check(barsIn - bars1 === 6, '14. stream tras recarga: 6 barras recibidas', `recibidas ${barsIn - bars1}`);

        await sim.fastForward({ chunkMs: 20 });
        check(await waitFor(() => probeMatches() && sim.state.idx === sim.state.bars.length - 1, 15000), '15. modo rápido hasta el final → una recarga → Pine ve la última barra', describeProbe());
        check(install.bridge.reloads === 3, '16. recargas totales = salto + reset + modo rápido', `reloads=${install.bridge.reloads}`);
    } catch (err) {
        fail++;
        log(`EXCEPCIÓN: ${(err as Error)?.stack ?? String(err)}`);
    }
    log(`DONE ok=${ok} fail=${fail} · runs totales=${runs} · barras al core=${barsIn}`);
    document.title = `SPIKE DONE ok=${ok} fail=${fail}`;
}
