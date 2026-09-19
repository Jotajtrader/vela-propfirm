// Las preferencias que sobreviven a una recarga (lo que en el HTML se perdía al cerrar la pestaña
// salvo por export/import): plantillas y sus ATM, modo, instrumento, comisión, corte de jornada,
// intrabar y la CONFIGURACIÓN del agente (no su estado de ejecución). Sin cuentas ni barras: eso
// es la sesión (export/import), demasiado grande para el documento de estado del shell.
import type { AtmPreset, HourMinute, SimMode, SimState, Template, TradingDayCutoff } from './types';

export interface AgentPrefs {
    tplId: string | null;
    dateFrom: string | null;
    dateTo: string | null;
    startTimeOfDay: HourMinute | null;
    endTimeOfDay: HourMinute | null;
    challengeTarget: number;
    maxFundedActive: number;
    maxWaiting: number;
    qty: number;
    profitPauseChallenge: number;
    profitPauseFundedDay1: number;
    profitPauseFundedRest: number;
    waitMinMin: number;
    waitMaxMin: number;
}

export interface PropFirmPrefs {
    v: 1;
    templates: Template[];
    atmPresetsByTpl: Record<string, AtmPreset[]>;
    atmIdCounter: number;
    tid: number;
    simMode: SimMode;
    instr: string;
    comm: number;
    tradingDayCutoff: TradingDayCutoff;
    randomIntrabar: boolean;
    agent: AgentPrefs;
}

export function prefsFromState(state: SimState): PropFirmPrefs {
    const A = state.agent;
    return {
        v: 1,
        templates: state.templates,
        atmPresetsByTpl: state.atmPresetsByTpl,
        atmIdCounter: state.atmIdCounter,
        tid: state.tid,
        simMode: state.simMode,
        instr: state.instr,
        comm: state.comm,
        tradingDayCutoff: state.tradingDayCutoff,
        randomIntrabar: state.randomIntrabar,
        agent: {
            tplId: A.tplId,
            dateFrom: A.dateFrom ? A.dateFrom.toISOString() : null,
            dateTo: A.dateTo ? A.dateTo.toISOString() : null,
            startTimeOfDay: A.startTimeOfDay,
            endTimeOfDay: A.endTimeOfDay,
            challengeTarget: A.challengeTarget,
            maxFundedActive: A.maxFundedActive,
            maxWaiting: A.maxWaiting,
            qty: A.qty,
            profitPauseChallenge: A.profitPauseChallenge,
            profitPauseFundedDay1: A.profitPauseFundedDay1,
            profitPauseFundedRest: A.profitPauseFundedRest,
            waitMinMin: A.waitMinMin,
            waitMaxMin: A.waitMaxMin,
        },
    };
}

/** Huella barata para saber si hay algo nuevo que persistir tras un `change`. */
export function prefsFingerprint(state: SimState): string {
    return JSON.stringify(prefsFromState(state));
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const num = (x: unknown, fallback: number): number => (typeof x === 'number' && Number.isFinite(x) ? x : fallback);
const hm = (x: unknown): HourMinute | null => (isObj(x) && typeof x.h === 'number' && typeof x.m === 'number' ? { h: x.h, m: x.m } : null);
const date = (x: unknown): Date | null => {
    if (typeof x !== 'string') return null;
    const d = new Date(x);
    return isNaN(d.getTime()) ? null : d;
};

function validTemplate(t: unknown): t is Template {
    if (!isObj(t) || typeof t.id !== 'string' || typeof t.name !== 'string') return false;
    if (!Array.isArray(t.phases) || t.phases.length === 0 || !t.phases.every((p) => isObj(p) && typeof p.target === 'number' && typeof p.ddAmount === 'number')) return false;
    return isObj(t.funded) && typeof t.funded.ddAmount === 'number';
}

/**
 * Aplica un payload (NO confiable: viene del documento de estado tal cual) sobre el estado.
 * Devuelve false si no tenía la forma esperada; nunca lanza. Las plantillas solo se reemplazan
 * cuando el payload trae una lista válida y no rompen cuentas existentes (mismos ids).
 */
export function applyPrefs(state: SimState, payload: unknown): boolean {
    if (!isObj(payload) || payload.v !== 1) return false;
    if (Array.isArray(payload.templates) && payload.templates.length > 0 && payload.templates.every(validTemplate)) {
        const incoming = payload.templates as Template[];
        const ids = new Set(incoming.map((t) => t.id));
        if (state.accounts.every((a) => ids.has(a.tplId))) state.templates = incoming;
    }
    if (isObj(payload.atmPresetsByTpl)) {
        const out: Record<string, AtmPreset[]> = {};
        for (const [k, v] of Object.entries(payload.atmPresetsByTpl)) {
            if (Array.isArray(v)) out[k] = v.filter((p): p is AtmPreset => isObj(p) && typeof p.id === 'string' && typeof p.name === 'string');
        }
        state.atmPresetsByTpl = out;
    }
    state.atmIdCounter = Math.max(state.atmIdCounter, Math.trunc(num(payload.atmIdCounter, state.atmIdCounter)));
    state.tid = Math.max(state.tid, Math.trunc(num(payload.tid, state.tid)));
    if (payload.simMode === 'challenge' || payload.simMode === 'cushion' || payload.simMode === 'full') state.simMode = payload.simMode;
    if (typeof payload.instr === 'string' && payload.instr) state.instr = payload.instr;
    state.comm = num(payload.comm, state.comm);
    const cut = hm(payload.tradingDayCutoff);
    if (cut) state.tradingDayCutoff = cut;
    if (typeof payload.randomIntrabar === 'boolean') state.randomIntrabar = payload.randomIntrabar;
    if (isObj(payload.agent)) {
        const a = payload.agent;
        const A = state.agent;
        if (typeof a.tplId === 'string' || a.tplId === null) A.tplId = a.tplId;
        A.dateFrom = date(a.dateFrom);
        A.dateTo = date(a.dateTo);
        A.startTimeOfDay = hm(a.startTimeOfDay);
        A.endTimeOfDay = hm(a.endTimeOfDay);
        A.challengeTarget = num(a.challengeTarget, A.challengeTarget);
        A.maxFundedActive = num(a.maxFundedActive, A.maxFundedActive);
        A.maxWaiting = num(a.maxWaiting, A.maxWaiting);
        A.qty = num(a.qty, A.qty);
        A.profitPauseChallenge = num(a.profitPauseChallenge, A.profitPauseChallenge);
        A.profitPauseFundedDay1 = num(a.profitPauseFundedDay1, A.profitPauseFundedDay1);
        A.profitPauseFundedRest = num(a.profitPauseFundedRest, A.profitPauseFundedRest);
        A.waitMinMin = num(a.waitMinMin, A.waitMinMin);
        A.waitMaxMin = num(a.waitMaxMin, A.waitMaxMin);
    }
    return true;
}
