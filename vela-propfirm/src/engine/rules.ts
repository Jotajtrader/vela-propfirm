// Port 1:1 de "MOTOR DE REGLAS PROP" del <script> de fondeo-sim: funciones sobre cuenta + plantilla.
// Los `renderAll()` / `alert()` del HTML pasan por `sim.hooks`.
import type { Account, AccountCategory, AccountStatus, FundedRules, Phase, Rules, Side, Sim, SimState, Template } from './types';
import { money } from './format';
import { takeAgentSnapshot } from './snapshot';

export function tplOf(state: SimState, acc: Account): Template | undefined {
    return state.templates.find((t) => t.id === acc.tplId);
}

export function curBar(state: SimState) {
    return state.bars[state.idx];
}

/**
 * ¿Puede `acc` abrir en `side`, mirando las demás cuentas DE LA MISMA PLANTILLA?
 * Hedging (sentido opuesto en otra cuenta) nunca; mismo sentido según el toggle de la plantilla.
 */
export function canOpenPosition(state: SimState, acc: Account, side: Side): { ok: true } | { ok: false; reason: 'hedge' | 'samedirection'; other: Account } {
    const tpl = tplOf(state, acc);
    if (!tpl) return { ok: true };
    for (const other of state.agentLiveAccounts) {
        if (other.id === acc.id || !other.position || other.tplId !== tpl.id) continue;
        if (other.position.side !== side) return { ok: false, reason: 'hedge', other };
        if (!tpl.allowSameDirectionMultiAccount) return { ok: false, reason: 'samedirection', other };
    }
    return { ok: true };
}

/** Reglas activas: la fase de challenge en curso, o las de fondeada. null en blown/paid/paused/passed. */
export function rulesFor(acc: Account, tpl: Template | undefined): Rules | null {
    if (!tpl) return null;
    if (acc.status === 'challenge') return tpl.phases[acc.phaseIdx] ?? null;
    if (acc.status === 'funded') return tpl.funded;
    return null;
}

export function isPhase(rules: Rules): rules is Phase {
    return 'target' in rules;
}

export function thresholdOf(acc: Account, rules: Rules | null): number {
    if (!rules) return -Infinity;
    const base = acc.stageStartBalance;
    if (rules.ddType === 'static') return base - rules.ddAmount;
    let thr = acc.peakBalance - rules.ddAmount; // trailing / eod-trailing
    if (rules.lockAtStart) thr = Math.min(thr, base);
    return thr;
}

export function targetBalOf(acc: Account, rules: Phase): number {
    return acc.stageStartBalance + rules.target;
}

export function newAccountInstance(sim: Sim, tpl: Template, day: number, skipToFunded: boolean): Account {
    const { state } = sim;
    const acc: Account = {
        id: `a${state.aid++}`,
        tplId: tpl.id,
        name: `${tpl.name.split(' ')[0]} #${state.aid}`,
        status: 'challenge',
        phaseIdx: 0,
        startBalance: tpl.size,
        balance: tpl.size,
        peakBalance: tpl.size,
        stageStartBalance: tpl.size,
        dayStartBalance: tpl.size,
        dailyPnl: 0,
        payouts: 0,
        createdDay: day,
        payoutCount: 0,
        dayProfits: [],
        cycleValidDays: 0,
        cycleProfitSum: 0,
        activated: false,
        position: null,
        everFunded: false,
        everReachedCushion: false,
        tradeLog: [],
        milestones: [],
        fundedCushionDeficit: 0,
    };
    if (skipToFunded) {
        // Modo Colchón, compra MANUAL: directo a fondeada activada (el agente sigue arrancando por el challenge).
        acc.status = 'funded';
        acc.phaseIdx = tpl.phases.length;
        acc.activated = true;
        acc.everFunded = true;
        acc.milestones.push({ type: 'approved', time: curBar(state) ? curBar(state)!.t.toISOString() : null, balance: acc.balance });
    }
    return acc;
}

/** Mejor día individual ≤ consistencyPct% del total acumulado en la ventana activa. */
export function consistencyOk(rules: RulesLike, dayProfitsSoFar: readonly number[], currentDayPnl: number): boolean {
    if (!rules.consistencyOn) return true;
    const days = dayProfitsSoFar.concat([currentDayPnl]);
    const total = days.reduce((s, v) => s + v, 0);
    if (total <= 0) return true;
    const best = Math.max(...days);
    return best <= (rules.consistencyPct / 100) * total + 1e-6;
}
type RulesLike = Pick<Rules, 'consistencyOn' | 'consistencyPct'>;

export function checkAccount(sim: Sim, acc: Account, tpl: Template | undefined): void {
    const { state } = sim;
    if (acc.status === 'blown' || acc.status === 'paid') return;
    const rules = rulesFor(acc, tpl);
    if (!rules) return;
    const thr = thresholdOf(acc, rules);
    if (acc.balance <= thr + 1e-6) {
        acc.status = 'blown';
        return;
    }
    if (rules.dailyLoss > 0 && acc.dailyPnl <= -rules.dailyLoss + 1e-6) {
        if (acc.status !== 'paused') {
            acc.prevStatus = acc.status;
            acc.prevPhaseIdx = acc.phaseIdx;
        }
        acc.status = 'paused';
        return;
    }
    if (acc.status === 'challenge' && isPhase(rules)) {
        const tgt = targetBalOf(acc, rules);
        if (acc.balance >= tgt - 1e-6 && consistencyOk(rules, acc.dayProfits, acc.dailyPnl)) {
            acc.phaseIdx++;
            if (acc.phaseIdx >= tpl!.phases.length) {
                acc.everFunded = true;
                acc.milestones.push({ type: 'approved', time: curBar(state) ? curBar(state)!.t.toISOString() : null, balance: acc.balance });
                if (state.simMode === 'challenge') {
                    // Modo Challenge: acá termina — nunca se activa como fondeada.
                    acc.status = 'passed';
                    retireFromAgentLive(state, acc);
                } else {
                    acc.status = 'funded';
                    if (tpl!.activationCost > 0) state.ledger.push({ type: 'cost', amount: -tpl!.activationCost, day: state.dayIndex, acc: acc.name });
                }
            }
            // nueva etapa: reinicia línea base, peak y ventana de consistencia
            acc.stageStartBalance = acc.balance;
            acc.peakBalance = acc.balance;
            acc.dayProfits = [];
        }
    }
}

export function applyRealized(sim: Sim, acc: Account, pnl: number): void {
    const tpl = tplOf(sim.state, acc);
    acc.balance += pnl;
    acc.dailyPnl += pnl;
    const rules = rulesFor(acc, tpl);
    if (rules && rules.ddType === 'trailing') acc.peakBalance = Math.max(acc.peakBalance, acc.balance);
    checkAccount(sim, acc, tpl);
}

export function rollDay(sim: Sim): void {
    const { state } = sim;
    state.dayIndex++;
    for (const acc of state.accounts) {
        if (acc.status === 'blown' || acc.status === 'paid') continue;
        const tpl = tplOf(state, acc);
        const effStatus: AccountStatus | undefined = acc.status === 'paused' ? acc.prevStatus : acc.status;
        const effPhase = acc.status === 'paused' ? acc.prevPhaseIdx! : acc.phaseIdx;
        const rules: Rules | null = effStatus === 'challenge' ? (tpl?.phases[effPhase] ?? null) : effStatus === 'funded' ? (tpl?.funded ?? null) : null;
        if (rules && rules.ddType === 'eod-trailing') acc.peakBalance = Math.max(acc.peakBalance, acc.balance);
        acc.dayProfits.push(acc.dailyPnl);
        // arrastre de pérdidas al objetivo del intento de colchón
        if (effStatus === 'funded' && acc.activated && !acc.everReachedCushion && acc.dailyPnl < 0) {
            acc.fundedCushionDeficit = (acc.fundedCushionDeficit || 0) + -acc.dailyPnl;
        }
        if (effStatus === 'funded' && rules && acc.dailyPnl >= (rules as FundedRules).minDayProfit) {
            acc.cycleValidDays++;
            acc.cycleProfitSum += acc.dailyPnl;
        }
        if (acc.status === 'paused') {
            acc.status = acc.prevStatus!;
            acc.phaseIdx = acc.prevPhaseIdx!;
            delete acc.prevStatus;
            delete acc.prevPhaseIdx;
        }
        acc.dayStartBalance = acc.balance;
        acc.dailyPnl = 0;
    }
}

export function buyAccount(sim: Sim, tpl: Template, manual?: boolean): Account {
    const { state } = sim;
    // La primera compra tras cargar datos o tras el último Reset fija el punto de retorno de "Reset".
    if (!state.agentSnapshot) takeAgentSnapshot(state);
    const skipToFunded = !!manual && state.simMode === 'cushion';
    const acc = newAccountInstance(sim, tpl, state.dayIndex, skipToFunded);
    state.accounts.push(acc);
    state.agentLiveAccounts.push(acc);
    state.ledger.push({ type: 'cost', amount: -tpl.cost, day: state.dayIndex, acc: acc.name });
    state.selAcct = acc.id;
    sim.hooks.render();
    return acc;
}

/** Estados de los que una cuenta NUNCA vuelve. 'passed' = challenge aprobado en Modo Challenge. */
export function isTerminalStatus(status: AccountStatus): boolean {
    return status === 'blown' || status === 'paid' || status === 'passed';
}

export function retireFromAgentLive(state: SimState, acc: Account): void {
    if (isTerminalStatus(acc.status)) {
        const i = state.agentLiveAccounts.indexOf(acc);
        if (i !== -1) state.agentLiveAccounts.splice(i, 1);
    }
}

/** Fondeadas que OCUPAN CUPO — una pausada por límite diario sigue ocupando el suyo. */
export function countFundedActive(state: SimState): number {
    return state.agentLiveAccounts.filter((a) => {
        if (!a.activated) return false;
        const s = a.status === 'paused' ? a.prevStatus || '' : a.status;
        return s === 'funded';
    }).length;
}

/** Activa la fondeada ("Fondear"): saldo NOMINAL de la plantilla, métricas de la etapa desde cero. */
export function activateFundedAccount(sim: Sim, acc: Account): boolean {
    const { state } = sim;
    const A = state.agent;
    const activeCount = countFundedActive(state);
    if (activeCount >= A.maxFundedActive) {
        sim.hooks.alert(
            `No se puede activar: ya hay ${activeCount} cuenta(s) fondeada(s) activa(s), el máximo configurado es ${A.maxFundedActive}. Subí el cupo en "Configurar" del Modo Agente si querés activar más.`,
        );
        return false;
    }
    const tpl = tplOf(state, acc)!;
    acc.balance = tpl.size;
    acc.peakBalance = tpl.size;
    acc.stageStartBalance = tpl.size;
    acc.dailyPnl = 0;
    acc.dayProfits = [];
    acc.cycleValidDays = 0;
    acc.cycleProfitSum = 0;
    acc.payoutCount = 0;
    acc.fundedCushionDeficit = 0;
    acc.activated = true;
    sim.hooks.render();
    return true;
}

/** Misma lógica de gating que collectPayout, sin efectos: pinta el botón "Cobrar". */
export function isPayoutEligible(acc: Account, tpl: Template): boolean {
    if (acc.status !== 'funded' || !acc.activated) return false;
    const f = tpl.funded;
    if (f.maxPayouts > 0 && acc.payoutCount >= f.maxPayouts) return false;
    if (f.minDays > 0 && acc.cycleValidDays < f.minDays) return false;
    if (f.minCycleSum > 0 && acc.cycleProfitSum < f.minCycleSum) return false;
    if (!consistencyOk(f, acc.dayProfits, acc.dailyPnl)) return false;
    const profit = acc.balance - acc.stageStartBalance;
    const avail = f.bufferOn ? profit - f.buffer : profit;
    return avail > 0;
}

export function collectPayout(sim: Sim, acc: Account): void {
    const { state, hooks } = sim;
    const tpl = tplOf(state, acc)!;
    if (acc.status !== 'funded') return;
    if (!acc.activated) {
        hooks.alert('Primero tenés que activar la cuenta fondeada (botón "Fondear").');
        return;
    }
    const f = tpl.funded;
    if (f.maxPayouts > 0 && acc.payoutCount >= f.maxPayouts) {
        hooks.alert(`Esta cuenta ya alcanzó el máximo de ${f.maxPayouts} retiros permitidos por la plantilla.`);
        return;
    }
    if (f.minDays > 0 && acc.cycleValidDays < f.minDays) {
        hooks.alert(`Faltan días válidos para poder retirar: ${acc.cycleValidDays} / ${f.minDays}.`);
        return;
    }
    if (f.minCycleSum > 0 && acc.cycleProfitSum < f.minCycleSum) {
        hooks.alert(`Aún no se alcanzó la suma mínima de esos días: ${money(acc.cycleProfitSum)} / ${money(f.minCycleSum)}.`);
        return;
    }
    if (!consistencyOk(f, acc.dayProfits, acc.dailyPnl)) {
        hooks.alert('El mejor día supera el % de consistencia permitido para este retiro.');
        return;
    }
    const profit = acc.balance - acc.stageStartBalance; // ganancia YA fondeada (sin el colchón del challenge)
    const avail = f.bufferOn ? profit - f.buffer : profit;
    if (avail <= 0) {
        hooks.alert(`No hay excedente retirable${f.bufferOn ? ' por encima del buffer.' : ' en esta etapa fondeada.'}`);
        return;
    }

    const cap = f.capScheduleOn && f.capSchedule && f.capSchedule.length ? f.capSchedule[Math.min(acc.payoutCount, f.capSchedule.length - 1)]! : f.payoutCap;
    let withdrawal = (f.payoutPct / 100) * avail;
    if (cap > 0) withdrawal = Math.min(withdrawal, cap);
    if (withdrawal <= 0) {
        hooks.alert('El monto a retirar da 0.');
        return;
    }

    const cashToTrader = withdrawal * (f.splitPct / 100);
    acc.payouts += cashToTrader;
    acc.payoutCount++;
    state.ledger.push({ type: 'payout', amount: +cashToTrader, day: state.dayIndex, acc: acc.name });
    // el colchón no se pierde al cobrar: los ciclos siguientes siguen en régimen de extracción
    state.agent.fundedGoalReached[acc.id] = true;
    state.agent.fundedDayCounts[acc.id] = 2;
    const balanceBefore = acc.balance;
    // al máximo de retiros la cuenta se cierra SIEMPRE, sin importar closeOnPayout
    const reachedMaxPayouts = f.maxPayouts > 0 && acc.payoutCount >= f.maxPayouts;
    if (f.closeOnPayout || reachedMaxPayouts) {
        acc.status = 'paid';
        retireFromAgentLive(state, acc);
    } else {
        // Solo baja el BALANCE: stageStartBalance y peakBalance no se tocan (si no, el mismo excedente
        // se podía retirar una y otra vez).
        acc.balance -= withdrawal;
        acc.dayProfits = [];
        acc.cycleValidDays = 0;
        acc.cycleProfitSum = 0;
    }
    acc.milestones.push({
        type: 'payout',
        time: curBar(state) ? curBar(state)!.t.toISOString() : null,
        balance: acc.balance,
        balanceBefore,
        withdrawal,
        cashToTrader,
        closed: !!(f.closeOnPayout || reachedMaxPayouts),
    });
    hooks.render();
}

/** Pestaña a la que pertenece una cuenta (paused hereda la categoría previa; paid/passed van juntas). */
export function acctCategory(acc: Account): AccountCategory {
    let s: AccountStatus = acc.status;
    if (s === 'paused') s = acc.prevStatus || 'challenge';
    if (s === 'paid' || s === 'passed') return 'paid';
    if (s === 'funded') return 'funded';
    // quemada tras haber cobrado alguna vez cuenta como "cobrada"
    if (s === 'blown') return acc.payouts > 0 ? 'paid' : 'blown';
    return 'challenge';
}
