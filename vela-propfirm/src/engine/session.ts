// Port de "SESIÓN: export / import" del <script> de fondeo-sim. El JSON es el mismo (v2) que el
// HTML exporta/importa, así una sesión viaja en las dos direcciones.
import type { Account, AtmPreset, LedgerEntry, Order, Sim, Template, TradingDayCutoff } from './types';
import { fmtDay } from './data';
import { defaultAtmPresets, defaultTemplates } from './templates';
import { isTerminalStatus } from './rules';

export interface SessionDocument {
    v: 2;
    instr: string;
    comm: number;
    idx: number;
    dayIndex: number;
    tradingDayCutoff: TradingDayCutoff;
    templates: Template[];
    accounts: Account[];
    ledger: LedgerEntry[];
    orders: Order[];
    tradingPnl: number;
    /** Dibujos del chart propio del HTML — Vela tiene los suyos; se conserva vacío por compatibilidad. */
    drawings: unknown[];
    selAcct: string | null;
    tid: number;
    atmPresetsByTpl: Record<string, AtmPreset[]>;
    atmIdCounter: number;
    theme: 'light' | 'dark';
    bars: [string, number, number, number, number, number][];
}

export function exportSession(sim: Sim, theme: 'light' | 'dark' = 'dark'): SessionDocument {
    const s = sim.state;
    return {
        v: 2,
        instr: s.instr,
        comm: s.comm,
        idx: s.idx,
        dayIndex: s.dayIndex,
        tradingDayCutoff: s.tradingDayCutoff,
        templates: s.templates,
        accounts: s.accounts,
        ledger: s.ledger,
        orders: s.orders,
        tradingPnl: s.tradingPnl,
        drawings: [],
        selAcct: s.selAcct,
        tid: s.tid,
        atmPresetsByTpl: s.atmPresetsByTpl,
        atmIdCounter: s.atmIdCounter,
        theme,
        bars: s.bars.map((b) => [b.t.toISOString(), b.o, b.h, b.l, b.c, b.v]),
    };
}

export function importSession(sim: Sim, obj: Partial<SessionDocument>): void {
    const s = sim.state;
    s.instr = obj.instr ?? s.instr;
    s.comm = obj.comm ?? s.comm;
    s.tradingDayCutoff = obj.tradingDayCutoff || { h: 17, m: 0 };
    s.bars = (obj.bars || []).map((a) => ({ t: new Date(a[0]), o: a[1], h: a[2], l: a[3], c: a[4], v: a[5], day: fmtDay(new Date(a[0]), s.tradingDayCutoff) }));
    s.idx = obj.idx ?? -1;
    s.dayIndex = obj.dayIndex || 0;
    s.templates = obj.templates || defaultTemplates();
    s.accounts = obj.accounts || [];
    s.ledger = obj.ledger || [];
    s.agentLiveAccounts = s.accounts.filter((a) => !isTerminalStatus(a.status));
    s.orders = obj.orders || [];
    s.atmPresetsByTpl = obj.atmPresetsByTpl || defaultAtmPresets();
    s.atmIdCounter = obj.atmIdCounter || 7;
    s.tradingPnl = obj.tradingPnl || 0;
    s.selAcct = obj.selAcct || null;
    s.selTpl = s.templates[0]?.id || null;
    s.selCompany = null;
    s.tid = obj.tid || 100;
    // Desviación deliberada del HTML (que deja aid/oid en 1 tras importar y puede repetir ids):
    // los contadores siguen desde el mayor id importado.
    s.aid = s.accounts.reduce((m, a) => Math.max(m, (parseInt(a.id.slice(1), 10) || 0) + 1), 1);
    s.oid = s.orders.reduce((m, o) => Math.max(m, o.id + 1), 1);
    sim.hooks.render();
}
