// Port 1:1 de "MODO AGENTE" del <script> de fondeo-sim: la operativa día a día de un trader sin
// edge, con el mismo reloj de barras que Play/Step.
import type { Account, HourMinute, Side, Sim, SimState } from './types';
import { fmtTime } from './data';
import { activateFundedAccount, buyAccount, canOpenPosition, collectPayout, countFundedActive, curBar, isPayoutEligible, isTerminalStatus, retireFromAgentLive, rulesFor, thresholdOf, tplOf, isPhase } from './rules';
import { canTrade, closePosition, curPx, pv } from './trading';
import { advanceToIndexSilent, gotoDateTime } from './replay';
import { takeAgentSnapshot } from './snapshot';

/** Abre en silencio (sin alert ni cuenta seleccionada); si está bloqueada, no hace nada y se reintenta después. */
export function agentTryOpenPosition(sim: Sim, acc: Account, side: Side, qty: number, sl: number | null, tp: number | null, atmName: string | null): boolean {
    const { state } = sim;
    if (!canTrade(acc) || acc.position) return false;
    if (!canOpenPosition(state, acc, side).ok) return false;
    const px = curPx(state);
    acc.position = {
        side,
        qty,
        entry: px,
        entryIdx: state.idx,
        atmName: atmName || null,
        sl: sl != null && Number.isFinite(sl) ? px - side * sl : null,
        tp: tp != null && Number.isFinite(tp) ? px + side * tp : null,
    };
    return true;
}

/** 'day1' (el día 1 real), 'retry' (día 2+ sin haber logrado el colchón), 'rest' (ya lo logró: extracción). */
export function agentFundedDaySlot(state: SimState, acc: Account): 'day1' | 'retry' | 'rest' {
    const A = state.agent;
    const day = A.fundedDayCounts[acc.id] || 1;
    if (day <= 1) return 'day1';
    return A.fundedGoalReached[acc.id] ? 'rest' : 'retry';
}

/** Una cuenta "termina por hoy" si se quemó, quedó pausada, no es operable, o llegó al freno de profit diario. */
export function agentAccountFinishedToday(sim: Sim, acc: Account): boolean {
    const { state } = sim;
    const A = state.agent;
    if (acc.status === 'blown' || acc.status === 'paid') return true;
    if (acc.status === 'paused') return true;
    if (!canTrade(acc)) return true;
    if (acc.status === 'challenge') {
        const waitingCount = state.agentLiveAccounts.filter((a) => a.status === 'funded' && !a.activated).length;
        if (waitingCount >= A.maxWaiting) return true;
    }
    let target = 0;
    if (acc.status === 'challenge') target = A.profitPauseChallenge;
    else if (acc.status === 'funded' && acc.activated) {
        const slot = agentFundedDaySlot(state, acc);
        target = slot === 'rest' ? A.profitPauseFundedRest : A.profitPauseFundedDay1;
        if (slot !== 'rest' && target > 0 && acc.dailyPnl >= target) {
            A.fundedGoalReached[acc.id] = true;
            if (!acc.everReachedCushion) acc.milestones.push({ type: 'cushion', time: curBar(state) ? curBar(state)!.t.toISOString() : null, balance: acc.balance });
            acc.everReachedCushion = true;
            acc.fundedCushionDeficit = 0;
            if (state.simMode === 'cushion') {
                // Modo Colchón: logró lo único que interesaba medir — no sigue a extracción.
                acc.status = 'paid';
                retireFromAgentLive(state, acc);
            }
        }
    }
    if (target > 0 && acc.dailyPnl >= target) return true;
    return false;
}

/**
 * El agente no usa ATM: SL = riesgo disponible HOY (lo menor entre lo que queda del límite diario y
 * del drawdown); TP = lo que falta del objetivo del día (en challenge, tampoco más de lo que falta
 * para pasar la fase), en bruto (la comisión se cobra igual).
 */
export function agentAdaptiveOrder(sim: Sim, acc: Account): { qty: number; slPts: number; tpPts: number } | null {
    const { state } = sim;
    const A = state.agent;
    const tpl = tplOf(state, acc);
    if (!tpl) return null;
    const rules = rulesFor(acc, tpl);
    if (!rules) return null;
    const qty = Math.max(1, A.qty || 1);

    const ddRoom = acc.balance - thresholdOf(acc, rules);
    const dailyRoom = rules.dailyLoss > 0 ? rules.dailyLoss + acc.dailyPnl : Infinity;
    const riskUsd = Math.min(ddRoom, dailyRoom);
    if (!(riskUsd > 0)) return null;

    let targetDay: number;
    if (acc.status === 'challenge') targetDay = A.profitPauseChallenge;
    else targetDay = agentFundedDaySlot(state, acc) === 'rest' ? A.profitPauseFundedRest : A.profitPauseFundedDay1;
    let remainingUsd = targetDay > 0 ? targetDay - acc.dailyPnl : Infinity;
    if (acc.status === 'challenge' && isPhase(rules)) {
        const remainToPass = rules.target - (acc.balance - acc.stageStartBalance);
        remainingUsd = Math.min(remainingUsd, remainToPass);
    } else if (!acc.everReachedCushion && acc.fundedCushionDeficit > 0 && Number.isFinite(remainingUsd)) {
        remainingUsd += acc.fundedCushionDeficit;
    }
    if (!Number.isFinite(remainingUsd)) remainingUsd = riskUsd; // sin objetivo: 1:1 al riesgo
    if (!(remainingUsd > 0)) return null;

    const commissionCost = state.comm * 2 * qty;
    return { qty, slPts: riskUsd / (qty * pv(state)), tpPts: (remainingUsd + commissionCost) / (qty * pv(state)) };
}

/** Compra challenge hasta el techo configurado, salvo que la cola de espera ya esté llena. */
export function agentReplenish(sim: Sim): void {
    const { state } = sim;
    const A = state.agent;
    const tpl = state.templates.find((t) => t.id === A.tplId) || state.templates[0];
    if (!tpl) return;
    const challengeCount = state.agentLiveAccounts.filter((a) => a.status === 'challenge').length;
    const waitingCount = state.agentLiveAccounts.filter((a) => a.status === 'funded' && !a.activated).length;
    let toBuy = A.challengeTarget - challengeCount;
    if (waitingCount >= A.maxWaiting) toBuy = 0;
    for (let i = 0; i < Math.max(0, toBuy); i++) buyAccount(sim, tpl);
}

/** Activa (Fondear) cuentas en espera mientras haya cupo libre en fondeadas activas. */
export function agentTryActivateWaiting(sim: Sim): void {
    const { state } = sim;
    const A = state.agent;
    let activeCount = countFundedActive(state);
    const waiting = state.agentLiveAccounts.filter((a) => a.status === 'funded' && !a.activated).sort((a, b) => (a.id < b.id ? -1 : 1));
    for (const acc of waiting) {
        if (activeCount >= A.maxFundedActive) break;
        activateFundedAccount(sim, acc);
        // "día 1" es el día del PRIMER TRADE real, no el de activación — no se fija el contador acá.
        activeCount++;
    }
}

/** Salta al próximo momento en que la ventana horaria [inicio, cierre) vuelva a aplicar. */
export function agentJumpToNextDayStart(sim: Sim): void {
    const { state } = sim;
    const b = curBar(state);
    if (!b) return;
    const A = state.agent;
    const startMin = A.startTimeOfDay ? A.startTimeOfDay.h * 60 + A.startTimeOfDay.m : null;
    const endMin = A.endTimeOfDay ? A.endTimeOfDay.h * 60 + A.endTimeOfDay.m : null;
    let skipDay = b.day;
    let j = state.idx + 1;
    let guard = 0;
    while (j < state.bars.length) {
        if (++guard > 500000) return;
        while (j < state.bars.length && state.bars[j]!.day === skipDay) j++;
        if (j >= state.bars.length) return;
        const dayLabel = state.bars[j]!.day;
        let k = j;
        let found = -1;
        while (k < state.bars.length && state.bars[k]!.day === dayLabel) {
            const bk = state.bars[k]!;
            const mins = bk.t.getHours() * 60 + bk.t.getMinutes();
            if ((startMin == null || mins >= startMin) && (endMin == null || mins < endMin)) {
                found = k;
                break;
            }
            k++;
        }
        if (found >= 0) {
            advanceToIndexSilent(sim, found);
            return;
        }
        skipDay = dayLabel;
        j = k;
    }
}

/** Texto de estado del agente (el `#agentStatus` del HTML). */
export function agentStatusText(state: SimState): string {
    const A = state.agent;
    if (!A.active) return '';
    const b = curBar(state);
    const acc = A.queue[A.queueIdx] ? state.agentLiveAccounts.find((a) => a.id === A.queue[A.queueIdx]) : undefined;
    return b ? `${b.day} ${fmtTime(b.t)} · ${acc ? `${acc.name} (${A.queueIdx + 1}/${A.queue.length})` : 'sin cuentas operables hoy'}` : '';
}

export function stopAgent(sim: Sim, msg?: string): void {
    sim.state.agent.active = false;
    if (msg) sim.hooks.showAlert(msg, '');
    sim.hooks.render();
}

/** El botón Reset: hay foto y el replay no está corriendo AHORA MISMO (pausar no apaga el agente). */
export function canResetAgent(state: SimState): boolean {
    return !!(state.agentSnapshot && !state.playing && !(state.fastForward && state.fastForward.running));
}

export function resetAgentRun(sim: Sim): void {
    const { state, hooks } = sim;
    const snap = state.agentSnapshot;
    if (!snap) return;
    try {
        state.accounts = JSON.parse(JSON.stringify(snap.accounts));
        state.ledger = JSON.parse(JSON.stringify(snap.ledger));
        state.orders = JSON.parse(JSON.stringify(snap.orders));
        state.idx = snap.idx;
        state.dayIndex = snap.dayIndex;
        state.tradingPnl = snap.tradingPnl;
        state.aid = snap.aid;
        state.selAcct = snap.selAcct;
        // agentLiveAccounts apuntaba a los objetos VIEJOS: se reconstruye desde las cuentas nuevas.
        state.agentLiveAccounts = state.accounts.filter((a) => !isTerminalStatus(a.status));
        state.agent.lastDay = null;
        state.agent.queue = [];
        state.agent.queueIdx = 0;
        state.agent.nextTradeAt = null;
        state.agent.finishedToday = new Set();
        state.agent.fundedDayCounts = {};
        state.agent.fundedGoalReached = {};
    } catch (err) {
        console.error('Reset del agente: error al restaurar la foto', err);
        hooks.showAlert(`No se pudo resetear: ${(err as Error)?.message || err}`, '');
    } finally {
        state.agentSnapshot = null; // la próxima aplicación toma una foto nueva desde este punto
        hooks.render();
    }
}

/** Cobra automáticamente toda fondeada-activa elegible, sin esperar al botón "Cobrar". */
export function agentAutoCollectPayouts(sim: Sim): void {
    const { state } = sim;
    for (const acc of [...state.agentLiveAccounts]) {
        if (acc.status === 'funded' && acc.activated) {
            const tpl = tplOf(state, acc);
            if (tpl && isPayoutEligible(acc, tpl)) collectPayout(sim, acc);
        }
    }
}

/** Un paso del agente = una decisión por barra revelada (se llama desde stepForwardSilent). */
export function agentStep(sim: Sim): void {
    const { state, hooks } = sim;
    const A = state.agent;
    if (!A.active) return;
    const b = curBar(state);
    if (!b) return;

    if (A.dateTo && b.t.getTime() > A.dateTo.getTime()) {
        stopAgent(sim, '🤖 Modo agente: ventana de fechas completada.');
        return;
    }

    agentAutoCollectPayouts(sim);

    const today = b.day;
    if (A.lastDay !== today) {
        A.lastDay = today;
        A.finishedToday = new Set();
        for (const acc of [...state.agentLiveAccounts]) {
            if (acc.status === 'funded' && acc.activated && A.fundedDayCounts[acc.id] != null) {
                if (state.simMode === 'cushion' && !acc.everReachedCushion) {
                    // Modo Colchón: el día 1 se resolvió sin éxito — se cierra como fracaso.
                    acc.status = 'blown';
                    retireFromAgentLive(state, acc);
                } else {
                    A.fundedDayCounts[acc.id]!++;
                }
            }
        }
        agentReplenish(sim);
        agentTryActivateWaiting(sim);
        A.queue = state.agentLiveAccounts.filter((acc) => canTrade(acc)).map((acc) => acc.id);
        A.queueIdx = 0;
        A.nextTradeAt = null;
    }

    if (A.startTimeOfDay) {
        const mins = b.t.getHours() * 60 + b.t.getMinutes();
        if (mins < A.startTimeOfDay.h * 60 + A.startTimeOfDay.m) return;
    }
    if (A.endTimeOfDay) {
        const mins = b.t.getHours() * 60 + b.t.getMinutes();
        if (mins >= A.endTimeOfDay.h * 60 + A.endTimeOfDay.m) {
            agentJumpToNextDayStart(sim);
            return;
        }
    }

    while (A.queueIdx < A.queue.length) {
        const acc = state.agentLiveAccounts.find((a) => a.id === A.queue[A.queueIdx]);
        if (!acc || A.finishedToday.has(acc.id) || agentAccountFinishedToday(sim, acc)) {
            if (acc) A.finishedToday.add(acc.id);
            A.queueIdx++;
            A.nextTradeAt = null;
            continue;
        }
        break;
    }
    agentTryActivateWaiting(sim); // por si se liberó un cupo fondeado en este mismo tick

    if (A.queueIdx >= A.queue.length) {
        agentJumpToNextDayStart(sim);
        return;
    }

    const acc = state.agentLiveAccounts.find((a) => a.id === A.queue[A.queueIdx])!;
    state.selAcct = acc.id; // el chart/panel siguen a la cuenta que el agente está operando

    if (acc.position) return; // esperando a que la posición se resuelva sola

    if (A.nextTradeAt == null) {
        const waitMin = A.waitMinMin + hooks.rng() * Math.max(0, A.waitMaxMin - A.waitMinMin);
        A.nextTradeAt = new Date(b.t.getTime() + waitMin * 60000);
        return;
    }
    if (b.t.getTime() < A.nextTradeAt.getTime()) return;

    const order = agentAdaptiveOrder(sim, acc);
    if (!order) {
        A.finishedToday.add(acc.id);
        A.queueIdx++;
        A.nextTradeAt = null;
        return;
    }
    if (acc.status === 'funded' && acc.activated && A.fundedDayCounts[acc.id] == null) A.fundedDayCounts[acc.id] = 1; // hoy es su día 1 de verdad
    const side: Side = hooks.rng() < 0.5 ? 1 : -1;
    agentTryOpenPosition(sim, acc, side, order.qty, order.slPts, order.tpPts, 'Agente');
    A.nextTradeAt = null;
}

/**
 * Justo antes de revelar la primera barra de un día nuevo (con state.idx TODAVÍA en la última del
 * día que se deja): cierra posiciones trabadas al cierre de ESE día. Solo con el agente corriendo.
 */
export function agentFlattenStuckPositionsOnDayChange(sim: Sim): void {
    const { state } = sim;
    if (!state.agent.active) return;
    const lastClosePx = state.bars[state.idx]!.c;
    const lastCloseIdx = state.idx;
    for (const acc of [...state.agentLiveAccounts]) {
        if (acc.position && (acc.status === 'challenge' || (acc.status === 'funded' && acc.activated))) {
            closePosition(sim, acc, lastClosePx, 'day-end', lastCloseIdx);
        }
    }
}

export interface AgentConfigInput {
    tplId: string;
    dateFrom: Date | null;
    dateTo: Date | null;
    startTimeOfDay: HourMinute | null;
    endTimeOfDay: HourMinute | null;
    challengeTarget: number;
    maxFundedActive: number;
    maxWaiting: number;
    profitPauseChallenge: number;
    profitPauseFundedDay1: number;
    profitPauseFundedRest: number;
    waitMinMin: number;
    waitMaxMin: number;
    qty: number;
}

/** El "Aplicar y activar" del modal del agente. false = validación fallida (ya avisó por alert). */
export function applyAgentConfig(sim: Sim, cfg: AgentConfigInput): boolean {
    const { state, hooks } = sim;
    const A = state.agent;
    if (!cfg.tplId) {
        hooks.alert('Elegí qué challenge va a comprar el agente en esta corrida.');
        return false;
    }
    if (cfg.startTimeOfDay && cfg.endTimeOfDay && cfg.endTimeOfDay.h * 60 + cfg.endTimeOfDay.m <= cfg.startTimeOfDay.h * 60 + cfg.startTimeOfDay.m) {
        hooks.alert('La hora de cierre tiene que ser posterior a la de inicio.');
        return false;
    }
    A.tplId = cfg.tplId;
    A.dateFrom = cfg.dateFrom;
    A.dateTo = cfg.dateTo;
    A.startTimeOfDay = cfg.startTimeOfDay;
    A.endTimeOfDay = cfg.endTimeOfDay;
    A.challengeTarget = Math.max(0, Math.trunc(cfg.challengeTarget) || 0);
    A.maxFundedActive = Math.max(0, Math.trunc(cfg.maxFundedActive) || 0);
    A.maxWaiting = Math.max(0, Math.trunc(cfg.maxWaiting) || 0);
    A.profitPauseChallenge = cfg.profitPauseChallenge || 0;
    A.profitPauseFundedDay1 = cfg.profitPauseFundedDay1 || 0;
    A.profitPauseFundedRest = cfg.profitPauseFundedRest || 0;
    A.waitMinMin = Math.max(0, cfg.waitMinMin || 0);
    A.waitMaxMin = Math.max(A.waitMinMin, cfg.waitMaxMin || A.waitMinMin);
    A.qty = Math.max(1, Math.trunc(cfg.qty) || 1);
    A.lastDay = null;
    A.queue = [];
    A.queueIdx = 0;
    A.nextTradeAt = null;
    A.finishedToday = new Set();
    A.fundedDayCounts = {};
    A.fundedGoalReached = {};
    const hadPriorRun = !!state.agentSnapshot;
    try {
        // La foto se toma UNA sola vez: Reset siempre vuelve al punto REAL de partida.
        if (!hadPriorRun) takeAgentSnapshot(state);
        A.active = true;
        let warnedAboutRewind = false;
        if (A.dateFrom && state.bars.length) {
            const cb = curBar(state);
            const curT = cb ? cb.t.getTime() : -Infinity;
            if (A.dateFrom.getTime() > curT) {
                gotoDateTime(sim, A.dateFrom);
            } else if (hadPriorRun) {
                hooks.showAlert(
                    'El "Desde" configurado ya quedó atrás en el replay — el agente va a seguir desde donde está parado ahora, no puede rebobinar. Si querés repetir ese período completo, primero apretá "Reset" y volvé a aplicar.',
                    '',
                );
                warnedAboutRewind = true;
            }
        }
        if (!warnedAboutRewind && hadPriorRun && state.bars.length && state.idx >= state.bars.length - 1) {
            hooks.showAlert(
                'El replay ya está en el final de los datos cargados — esta corrida no va a tener ninguna barra nueva para operar. Si querés repetir el período, primero apretá "Reset" (o cargá más datos).',
                '',
            );
        }
    } finally {
        hooks.render();
    }
    return true;
}

/** El toggle del agente en OFF. */
export function deactivateAgent(sim: Sim): void {
    sim.state.agent.active = false;
    sim.hooks.render();
}
