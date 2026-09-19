// Port de "TRACKER" del <script> de fondeo-sim: las métricas y series; la UI las pinta.
import type { Account, LedgerEntry, SimMode, SimState } from './types';

export interface TrackerStats {
    total: number;
    everFundedCount: number;
    payoutCount: number;
    cushionCount: number;
    extractionCount: number;
    netTotal: number;
    approvalRate: number;
    payoutRate: number;
    cushionRate: number;
    extractionRate: number;
    evPerAccount: number;
}

/** Las 5 métricas del tracker. everFunded/everReachedCushion/payouts son permanentes. */
export function computeTrackerStats(state: SimState): TrackerStats {
    const accounts = state.accounts;
    const total = accounts.length;
    const everFundedCount = accounts.filter((a) => a.everFunded).length;
    const payoutCount = accounts.filter((a) => a.payouts > 0).length;
    const cushionCount = accounts.filter((a) => a.everReachedCushion).length;
    const extractionCount = accounts.filter((a) => a.everReachedCushion && a.payouts > 0).length;
    const netTotal = state.ledger.reduce((s, l) => s + l.amount, 0);
    return {
        total,
        everFundedCount,
        payoutCount,
        cushionCount,
        extractionCount,
        netTotal,
        approvalRate: total > 0 ? everFundedCount / total : 0,
        payoutRate: total > 0 ? payoutCount / total : 0,
        cushionRate: everFundedCount > 0 ? cushionCount / everFundedCount : 0,
        extractionRate: cushionCount > 0 ? extractionCount / cushionCount : 0,
        evPerAccount: total > 0 ? netTotal / total : 0,
    };
}

/** Curva del negocio: acumulado del ledger, arrancando en 0 (un punto por movimiento). */
export function ledgerEquitySeries(ledger: readonly LedgerEntry[]): number[] {
    let cum = 0;
    const pts = [0];
    for (const l of ledger) {
        cum += l.amount;
        pts.push(cum);
    }
    return pts;
}

/** Drawdown = pico previo − valor actual (≥ 0), misma serie que el equity. */
export function ledgerDrawdownSeries(ledger: readonly LedgerEntry[]): number[] {
    let cum = 0;
    let peak = 0;
    const dd = [0];
    for (const l of ledger) {
        cum += l.amount;
        if (cum > peak) peak = cum;
        dd.push(peak - cum);
    }
    return dd;
}

/** Resumen del panel "Negocio de cuentas". */
export function businessStats(state: SimState): { bought: number; funded: number; blown: number; cost: number; payout: number; net: number; tradingPnl: number } {
    const cost = state.ledger.filter((l) => l.type === 'cost').reduce((s, l) => s + l.amount, 0);
    const payout = state.ledger.filter((l) => l.type === 'payout').reduce((s, l) => s + l.amount, 0);
    return {
        bought: state.accounts.length,
        funded: state.accounts.filter((a) => a.status === 'funded').length,
        blown: state.accounts.filter((a) => a.status === 'blown').length,
        cost,
        payout,
        net: cost + payout,
        tradingPnl: state.tradingPnl,
    };
}

export interface StatusBadge {
    text: string;
    cls: 'b-p1' | 'b-funded' | 'b-blown' | 'b-paid' | 'b-paused';
}

export function statusBadge(acc: Account): StatusBadge {
    if (acc.status === 'challenge') return { text: `FASE ${acc.phaseIdx + 1}`, cls: 'b-p1' };
    if (acc.status === 'blown' && acc.payouts > 0) return { text: 'COBRADA (quemada después)', cls: 'b-paid' };
    const map: Record<string, StatusBadge> = {
        funded: { text: 'FONDEADA', cls: 'b-funded' },
        blown: { text: 'QUEMADA', cls: 'b-blown' },
        paid: { text: 'COBRADA', cls: 'b-paid' },
        paused: { text: 'PAUSADA', cls: 'b-paused' },
        passed: { text: 'APROBADA', cls: 'b-paid' },
    };
    return map[acc.status] ?? { text: acc.status, cls: 'b-p1' };
}

export const SIM_MODE_HINTS: Record<SimMode, string> = {
    challenge: 'Solo interesa si el challenge se aprueba o no — las cuentas nunca se activan como fondeadas.',
    cushion: 'Las cuentas sí se fondean, pero solo se juega el colchón (día 1): logrado o no, ahí termina.',
    full: 'Ciclo completo: challenge → fondeada → colchón → extracción → payouts, como siempre.',
};

/** La vista simple del tracker (modos challenge/colchón): un solo porcentaje. */
export function trackerSimpleStats(state: SimState): { title: string; pct: number; num: number; den: number; desc: string } {
    const s = computeTrackerStats(state);
    if (state.simMode === 'challenge') {
        return {
            title: '% de aprobación del Challenge',
            pct: s.approvalRate,
            num: s.everFundedCount,
            den: s.total,
            desc: 'Challenges comprados que llegaron a aprobar la fase — en este modo nunca se activan como fondeadas, solo interesa si pasaron o no.',
        };
    }
    return {
        title: '% de aprobación del Colchón',
        pct: s.cushionRate,
        num: s.cushionCount,
        den: s.everFundedCount,
        desc: 'De las cuentas que llegaron a fondearse, cuántas lograron el colchón en su único intento (día 1) — no siguen a extracción.',
    };
}
