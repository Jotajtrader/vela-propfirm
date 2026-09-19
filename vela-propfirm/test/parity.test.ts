// Paridad motor TS ↔ <script> original del HTML: mismos datos, misma semilla, misma secuencia de
// acciones ⇒ estado final idéntico (cuentas, ledger, órdenes, cursor, agente) y mismos avisos.
import { afterAll, describe, expect, it } from 'vitest';
import { genSample, type SimBar } from '../src/engine/data';
import { Simulator } from '../src/engine/Simulator';
import type { Side, SimMode, SimState } from '../src/engine/types';
import { barsForHtml, loadHtmlSim, type HtmlSim } from './parity/html-harness';

function seeded(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

type AgentCfg = {
    tplId: string;
    from?: string;
    to?: string;
    start?: string;
    end?: string;
    challengeTarget: number;
    maxFundedActive: number;
    maxWaiting: number;
    profitPauseChallenge: number;
    profitPauseFundedDay1: number;
    profitPauseFundedRest: number;
    waitMinMin: number;
    waitMaxMin: number;
    qty: number;
};

type Step =
    | { op: 'buy'; tpl: string; n: number }
    | { op: 'select'; acc: number }
    | { op: 'open'; side: Side; qty: number; sl: number | null; tp: number | null }
    | { op: 'order'; side: Side; type: 'limit' | 'stop'; px: number; qty: number; sl: number | null; tp: number | null }
    | { op: 'cancel'; order: number }
    | { op: 'step'; n: number }
    | { op: 'skipDay' }
    | { op: 'goto'; iso: string }
    | { op: 'nextDay' }
    | { op: 'flatten' }
    | { op: 'activate'; acc: number }
    | { op: 'payout'; acc: number }
    | { op: 'intrabar'; on: boolean }
    | { op: 'mode'; mode: SimMode }
    | { op: 'agent'; cfg: AgentCfg }
    | { op: 'agentOff' }
    | { op: 'ff' }
    | { op: 'reset' };

const hm = (s?: string) => (s ? { h: +s.split(':')[0]!, m: +s.split(':')[1]! } : null);

async function runOnTs(sim: Simulator, steps: Step[]): Promise<void> {
    const st = sim.state;
    for (const s of steps) {
        switch (s.op) {
            case 'buy':
                sim.buyAccounts(st.templates.find((t) => t.id === s.tpl)!, s.n);
                break;
            case 'select':
                sim.selectAccount(st.accounts[s.acc]!.id);
                break;
            case 'open':
                sim.openPosition(s.side, s.qty, s.sl, s.tp);
                break;
            case 'order':
                sim.placeOrder(s.side, s.type, s.px, s.qty, s.sl, s.tp);
                break;
            case 'cancel':
                sim.cancelOrder(s.order);
                break;
            case 'step':
                for (let i = 0; i < s.n; i++) sim.step();
                break;
            case 'skipDay':
                sim.skipDay();
                break;
            case 'goto':
                sim.gotoDateTime(new Date(s.iso));
                break;
            case 'nextDay':
                sim.gotoNextDaySameTime(null);
                break;
            case 'flatten':
                sim.flatten();
                break;
            case 'activate':
                sim.activate(st.accounts[s.acc]!);
                break;
            case 'payout':
                sim.collectPayout(st.accounts[s.acc]!);
                break;
            case 'intrabar':
                sim.setRandomIntrabar(s.on);
                break;
            case 'mode':
                sim.setSimMode(s.mode);
                break;
            case 'agent':
                sim.applyAgentConfig({
                    tplId: s.cfg.tplId,
                    dateFrom: s.cfg.from ? new Date(`${s.cfg.from}T00:00:00`) : null,
                    dateTo: s.cfg.to ? new Date(`${s.cfg.to}T23:59:59`) : null,
                    startTimeOfDay: hm(s.cfg.start),
                    endTimeOfDay: hm(s.cfg.end),
                    challengeTarget: s.cfg.challengeTarget,
                    maxFundedActive: s.cfg.maxFundedActive,
                    maxWaiting: s.cfg.maxWaiting,
                    profitPauseChallenge: s.cfg.profitPauseChallenge,
                    profitPauseFundedDay1: s.cfg.profitPauseFundedDay1,
                    profitPauseFundedRest: s.cfg.profitPauseFundedRest,
                    waitMinMin: s.cfg.waitMinMin,
                    waitMaxMin: s.cfg.waitMaxMin,
                    qty: s.cfg.qty,
                });
                break;
            case 'agentOff':
                sim.deactivateAgent();
                break;
            case 'ff':
                await sim.fastForward({ chunkMs: 5 });
                break;
            case 'reset':
                sim.resetAgentRun();
                break;
        }
    }
}

async function runOnHtml(H: HtmlSim, steps: Step[]): Promise<void> {
    const st = H.state;
    const $ = (id: string) => H.win.document.getElementById(id) as HTMLInputElement;
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    for (const s of steps) {
        switch (s.op) {
            case 'buy': {
                const tpl = st.templates.find((t: { id: string }) => t.id === s.tpl);
                for (let i = 0; i < Math.max(1, s.n); i++) H.call('buyAccount', tpl, true);
                break;
            }
            case 'select':
                st.selAcct = st.accounts[s.acc].id;
                break;
            case 'open':
                H.call('openPosition', s.side, s.qty, s.sl, s.tp);
                break;
            case 'order':
                H.call('placeOrder', s.side, s.type, s.px, s.qty, s.sl, s.tp);
                break;
            case 'cancel':
                H.call('cancelOrder', s.order);
                break;
            case 'step':
                for (let i = 0; i < s.n; i++) H.call('stepForward');
                break;
            case 'skipDay':
                H.call('skipDay');
                break;
            case 'goto': {
                const D = (H.win as unknown as { Date: DateConstructor }).Date;
                H.call('gotoDateTime', new D(s.iso));
                break;
            }
            case 'nextDay':
                $('gotoInput').value = '';
                H.call('gotoNextDaySameTime');
                break;
            case 'flatten': {
                const acc = H.call<{ position: unknown } | undefined>('activeAcct');
                if (acc && acc.position) H.call('closePosition', acc, H.call('curPx'), 'manual');
                else H.call('alert', 'No hay posición abierta en esta cuenta.');
                break;
            }
            case 'activate':
                H.call('activateFundedAccount', st.accounts[s.acc]);
                break;
            case 'payout':
                H.call('collectPayout', st.accounts[s.acc]);
                break;
            case 'intrabar':
                st.randomIntrabar = s.on;
                break;
            case 'mode':
                st.simMode = s.mode;
                break;
            case 'agent': {
                // El HTML aplica la config leyendo sus inputs: se rellenan igual que lo haría el usuario.
                H.call('openAgentModal');
                const tpl = st.templates.find((t: { id: string }) => t.id === s.cfg.tplId);
                $('ag_company').value = tpl.company || 'Sin empresa';
                H.call('renderAgentTemplatePicker');
                $('ag_template').value = s.cfg.tplId;
                $('ag_from').value = s.cfg.from ?? '';
                $('ag_to').value = s.cfg.to ?? '';
                $('ag_starttime').value = s.cfg.start ?? '';
                $('ag_endtime').value = s.cfg.end ?? '';
                $('ag_challengetarget').value = String(s.cfg.challengeTarget);
                $('ag_maxfunded').value = String(s.cfg.maxFundedActive);
                $('ag_maxwaiting').value = String(s.cfg.maxWaiting);
                $('ag_profit_challenge').value = String(s.cfg.profitPauseChallenge);
                $('ag_profit_fday1').value = String(s.cfg.profitPauseFundedDay1);
                $('ag_profit_frest').value = String(s.cfg.profitPauseFundedRest);
                $('ag_waitmin').value = String(s.cfg.waitMinMin);
                $('ag_waitmax').value = String(s.cfg.waitMaxMin);
                $('ag_qty').value = String(s.cfg.qty);
                ($('agentModalApply') as unknown as { onclick: () => void }).onclick();
                break;
            }
            case 'agentOff':
                st.agent.active = false;
                break;
            case 'ff':
                H.call('startFastForward');
                while (st.fastForward.running) await sleep(5);
                break;
            case 'reset':
                H.call('resetAgentRun');
                break;
        }
    }
}

/** Proyección comparable del estado (sin funciones ni referencias cruzadas). */
function snapshot(st: SimState | any): unknown {
    return JSON.parse(
        JSON.stringify({
            idx: st.idx,
            dayIndex: st.dayIndex,
            tradingPnl: st.tradingPnl,
            aid: st.aid,
            oid: st.oid,
            selAcct: st.selAcct,
            accounts: st.accounts,
            ledger: st.ledger,
            orders: st.orders,
            live: st.agentLiveAccounts.map((a: { id: string }) => a.id),
            agent: {
                active: st.agent.active,
                lastDay: st.agent.lastDay,
                queue: st.agent.queue,
                queueIdx: st.agent.queueIdx,
                nextTradeAt: st.agent.nextTradeAt ? st.agent.nextTradeAt.getTime() : null,
                finishedToday: [...st.agent.finishedToday].sort(),
                fundedDayCounts: st.agent.fundedDayCounts,
                fundedGoalReached: st.agent.fundedGoalReached,
            },
            hasSnapshot: !!st.agentSnapshot,
        }),
    );
}

const opened: HtmlSim[] = [];
afterAll(() => {
    for (const H of opened) H.close();
});

async function parity(label: string, steps: Step[], seed = 42, days = 6): Promise<void> {
    const bars: SimBar[] = genSample(days, 180, { h: 17, m: 0 }, seeded(seed));

    const ts = new Simulator({ rng: seeded(seed + 1000) });
    const tsAlerts: string[] = [];
    const tsNotices: string[] = [];
    ts.on('alert', (m) => tsAlerts.push(m));
    ts.on('notice', ({ msg }) => tsNotices.push(msg));
    ts.loadBars(structuredClone(bars));

    const H = loadHtmlSim();
    opened.push(H);
    H.setRng(seeded(seed + 1000));
    H.call('loadBars', barsForHtml(H, bars));

    await runOnTs(ts, steps);
    await runOnHtml(H, steps);

    expect(snapshot(ts.state), `${label}: estado`).toEqual(snapshot(H.state));
    expect(tsAlerts, `${label}: alerts`).toEqual(H.alerts);
    expect(tsNotices, `${label}: avisos`).toEqual(H.notices);
    // sanidad: el escenario efectivamente movió el reloj y generó actividad
    expect(ts.state.idx).toBeGreaterThan(80);
}

describe('paridad con el <script> original', () => {
    it('manual: compra, market con SL/TP, órdenes limit/stop, saltar día, flatten, ir a fecha', async () => {
        await parity('manual', [
            { op: 'buy', tpl: 't1', n: 2 },
            { op: 'select', acc: 0 },
            { op: 'open', side: 1, qty: 2, sl: 8, tp: 12 },
            { op: 'step', n: 40 },
            { op: 'flatten' },
            { op: 'open', side: -1, qty: 1, sl: null, tp: 6 },
            { op: 'step', n: 30 },
            { op: 'select', acc: 1 },
            { op: 'open', side: -1, qty: 2, sl: 5, tp: 5 },
            { op: 'step', n: 20 },
            { op: 'skipDay' },
            { op: 'select', acc: 0 },
            { op: 'order', side: 1, type: 'limit', px: 19990, qty: 2, sl: 10, tp: 20 },
            { op: 'order', side: -1, type: 'stop', px: 19985, qty: 1, sl: 10, tp: 10 },
            { op: 'step', n: 120 },
            { op: 'cancel', order: 1 },
            { op: 'nextDay' },
            { op: 'step', n: 50 },
            { op: 'goto', iso: '2025-01-10T10:00:00' },
            { op: 'step', n: 10 },
        ]);
    });

    it('manual con intrabar aleatorio: mismo camino de ticks, mismo resultado', async () => {
        await parity(
            'intrabar',
            [
                { op: 'intrabar', on: true },
                { op: 'buy', tpl: 't2', n: 1 },
                { op: 'select', acc: 0 },
                { op: 'open', side: 1, qty: 2, sl: 6, tp: 9 },
                { op: 'step', n: 90 },
                { op: 'open', side: -1, qty: 2, sl: 4, tp: 30 },
                { op: 'step', n: 90 },
                { op: 'skipDay' },
                { op: 'open', side: 1, qty: 2, sl: 3, tp: 3 },
                { op: 'step', n: 200 },
            ],
            7,
        );
    });

    it('errores de validación: mismos alerts (sin cuenta, posición abierta, hedging, retroceso)', async () => {
        await parity('alerts', [
            { op: 'open', side: 1, qty: 1, sl: null, tp: null },
            { op: 'buy', tpl: 't1', n: 2 },
            { op: 'select', acc: 0 },
            { op: 'open', side: 1, qty: 1, sl: 50, tp: 50 },
            { op: 'open', side: 1, qty: 1, sl: null, tp: null },
            { op: 'select', acc: 1 },
            { op: 'open', side: -1, qty: 1, sl: null, tp: null },
            { op: 'flatten' },
            { op: 'goto', iso: '2025-01-06T09:00:00' },
            { op: 'payout', acc: 0 },
            { op: 'step', n: 15 },
            { op: 'activate', acc: 0 },
        ]);
    });

    it('agente en modo completo: corrida entera en modo rápido', async () => {
        await parity(
            'agente-full',
            [
                {
                    op: 'agent',
                    cfg: {
                        tplId: 't1',
                        from: '2025-01-07',
                        to: '2025-01-11',
                        start: '09:35',
                        end: '12:00',
                        challengeTarget: 3,
                        maxFundedActive: 2,
                        maxWaiting: 2,
                        profitPauseChallenge: 250,
                        profitPauseFundedDay1: 200,
                        profitPauseFundedRest: 100,
                        waitMinMin: 1,
                        waitMaxMin: 4,
                        qty: 2,
                    },
                },
                { op: 'ff' },
            ],
            11,
        );
    });

    it('agente en modo colchón y en modo challenge, con reset entre corridas', async () => {
        const cfg: AgentCfg = {
            tplId: 't2',
            challengeTarget: 2,
            maxFundedActive: 2,
            maxWaiting: 1,
            profitPauseChallenge: 400,
            profitPauseFundedDay1: 300,
            profitPauseFundedRest: 150,
            waitMinMin: 0,
            waitMaxMin: 2,
            qty: 2,
        };
        await parity(
            'agente-modos',
            [
                { op: 'mode', mode: 'cushion' },
                { op: 'agent', cfg },
                { op: 'step', n: 400 },
                { op: 'agentOff' },
                { op: 'reset' },
                { op: 'mode', mode: 'challenge' },
                { op: 'agent', cfg: { ...cfg, to: '2025-01-09' } },
                { op: 'ff' },
                { op: 'reset' },
                { op: 'mode', mode: 'full' },
                { op: 'agent', cfg },
                { op: 'ff' },
            ],
            23,
        );
    });

    it('sesión: export TS → import en el HTML deja el mismo estado', async () => {
        const bars = genSample(3, 120, { h: 17, m: 0 }, seeded(5));
        const ts = new Simulator({ rng: seeded(5) });
        ts.loadBars(bars);
        await runOnTs(ts, [
            { op: 'buy', tpl: 't1', n: 1 },
            { op: 'select', acc: 0 },
            { op: 'open', side: 1, qty: 1, sl: 10, tp: 10 },
            { op: 'step', n: 50 },
            { op: 'order', side: -1, type: 'stop', px: 19000, qty: 1, sl: null, tp: null },
        ]);
        const doc = JSON.parse(JSON.stringify(ts.exportSession()));
        const H = loadHtmlSim();
        opened.push(H);
        H.call('importSession', doc);
        // El documento v2 del HTML no transporta aid/oid ni la foto del agente: se compara el resto.
        const carried = (s: unknown) => {
            const { aid: _a, oid: _o, hasSnapshot: _h, ...rest } = snapshot(s) as Record<string, unknown>;
            return rest;
        };
        expect(carried(H.state)).toEqual(carried(ts.state));
        expect(H.state.bars.length).toBe(ts.state.bars.length);
        expect(H.state.bars[10].day).toBe(ts.state.bars[10]!.day);
    });
});
