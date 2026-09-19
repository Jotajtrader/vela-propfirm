// Port 1:1 de "TRADING / FILLS" del <script> de fondeo-sim.
import type { Account, Order, Side, Sim, SimState } from './types';
import { PV, type SimBar } from './data';
import { applyRealized, canOpenPosition, curBar, retireFromAgentLive, rulesFor, thresholdOf, tplOf } from './rules';

export function curPx(state: SimState): number {
    const b = curBar(state);
    return b ? b.c : 0;
}

export function pv(state: SimState): number {
    return PV[state.instr] || 1;
}

export function activeAcct(state: SimState): Account | undefined {
    return state.accounts.find((a) => a.id === state.selAcct);
}

export function canTrade(acc: Account | undefined): acc is Account {
    return !!acc && (acc.status === 'challenge' || (acc.status === 'funded' && acc.activated));
}

const finite = (x: number | null | undefined): x is number => x != null && Number.isFinite(x);

export function openPosition(sim: Sim, side: Side, qty: number, slPts: number | null, tpPts: number | null, atmName?: string | null): boolean {
    const { state, hooks } = sim;
    const acc = activeAcct(state);
    if (!canTrade(acc)) {
        hooks.alert('Seleccioná una cuenta activa (no quemada/pausada/cobrada).');
        return false;
    }
    if (acc.position) {
        hooks.alert('Esta cuenta ya tiene una posición abierta. Cerrala primero.');
        return false;
    }
    const chk = canOpenPosition(state, acc, side);
    if (!chk.ok) {
        if (chk.reason === 'hedge')
            hooks.alert(`Bloqueado: ${chk.other.name} (misma plantilla) ya tiene una posición en sentido contrario. Hedging entre cuentas no está permitido.`);
        else hooks.alert('Bloqueado: la plantilla no permite el mismo sentido en simultáneo entre varias cuentas (activá el toggle en la plantilla si querés permitirlo).');
        return false;
    }
    const px = curPx(state);
    acc.position = {
        side,
        qty,
        entry: px,
        entryIdx: state.idx,
        atmName: atmName || null,
        sl: finite(slPts) ? px - side * slPts : null,
        tp: finite(tpPts) ? px + side * tpPts : null,
    };
    hooks.render();
    return true;
}

/**
 * Ajusta el SL/TP de la posición YA ABIERTA de `acc` (precios absolutos, no puntos) — capacidad
 * nueva sin equivalente en el HTML (arrastrar el nivel en el chart y confirmar en el panel de
 * orden). `null` en un campo lo desactiva; pasar `undefined` deja ese nivel como está.
 */
export function updatePositionLevels(sim: Sim, acc: Account, patch: { sl?: number | null; tp?: number | null }): boolean {
    const p = acc.position;
    if (!p) return false;
    if (patch.sl !== undefined) p.sl = patch.sl;
    if (patch.tp !== undefined) p.tp = patch.tp;
    sim.hooks.render();
    return true;
}

export function closePosition(sim: Sim, acc: Account, exitPx: number, reason: string, exitIdx?: number | null): void {
    const { state, hooks } = sim;
    const p = acc.position;
    if (!p) return;
    const gross = (exitPx - p.entry) * p.side * p.qty * pv(state);
    const commission = state.comm * 2 * p.qty;
    const net = gross - commission;
    state.tradingPnl += net;
    const entryBar = state.bars[p.entryIdx];
    const exitBar = exitIdx != null ? state.bars[exitIdx] : curBar(state);
    applyRealized(sim, acc, net); // actualiza acc.balance ANTES de registrar el trade
    acc.tradeLog.push({
        entryTime: entryBar ? entryBar.t.toISOString() : null,
        exitTime: exitBar ? exitBar.t.toISOString() : null,
        side: p.side,
        qty: p.qty,
        atmName: p.atmName || null,
        entry: p.entry,
        exit: exitPx,
        pnl: net,
        reason,
        balance: acc.balance,
    });
    acc.position = null;
    retireFromAgentLive(state, acc);
    hooks.render();
}

export function placeOrder(sim: Sim, side: Side, type: 'limit' | 'stop', px: number, qty: number, slPts: number | null, tpPts: number | null, atmName?: string | null): boolean {
    const { state, hooks } = sim;
    const acc = activeAcct(state);
    if (!canTrade(acc)) {
        hooks.alert('Seleccioná una cuenta activa.');
        return false;
    }
    if (!Number.isFinite(px)) {
        hooks.alert('Precio inválido.');
        return false;
    }
    state.orders.push({
        id: state.oid++,
        accId: acc.id,
        side,
        type,
        px,
        qty,
        atmName: atmName || null,
        sl: finite(slPts) ? slPts : null,
        tp: finite(tpPts) ? tpPts : null,
    });
    hooks.render();
    return true;
}

export function cancelOrder(sim: Sim, id: number): void {
    sim.state.orders = sim.state.orders.filter((o) => o.id !== id);
    sim.hooks.render();
}

/**
 * Camino sintético de "ticks" dentro de una barra (open → …ruido… → extremo1 → extremo2 → close),
 * eligiendo al azar si toca primero el low o el high.
 */
export function genIntrabarPath(bar: SimBar, rng: () => number, steps = 8): number[] {
    const { o, h, l, c } = bar;
    const lowFirst = rng() < 0.5;
    const ext1 = lowFirst ? l : h;
    const ext2 = lowFirst ? h : l;
    const path = [o];
    const leg = (a: number, b: number, n: number): void => {
        for (let i = 1; i < n; i++) {
            const t = i / n;
            let v = a + (b - a) * t;
            const noise = (rng() - 0.5) * (h - l) * 0.1;
            v = Math.max(l, Math.min(h, v + noise));
            path.push(v);
        }
        path.push(b); // endpoint exacto: el extremo realmente se toca
    };
    leg(o, ext1, steps);
    leg(ext1, ext2, steps);
    leg(ext2, c, steps);
    return path;
}

export interface ExitCandidate {
    price: number;
    kind: 'dd' | 'daily' | 'SL' | 'TP';
}

/** Recorre el camino en orden y devuelve el primer candidato cruzado (secuencia real, no distancia). */
export function findFirstTouchInPath(path: readonly number[], candidates: readonly ExitCandidate[]): ExitCandidate | null {
    for (let i = 1; i < path.length; i++) {
        const p0 = path[i - 1]!;
        const p1 = path[i]!;
        const segLo = Math.min(p0, p1);
        const segHi = Math.max(p0, p1);
        const touched = candidates.filter((c) => c.price >= segLo && c.price <= segHi);
        if (touched.length) {
            touched.sort((a, b) => Math.abs(a.price - p0) - Math.abs(b.price - p0));
            return touched[0]!;
        }
    }
    return null;
}

/**
 * Salida de una posición contra una barra: SL, TP, drawdown máximo y límite diario compiten TODOS
 * por lo que se toca primero. Sin intrabar: regla conservadora (gana el adverso más cercano a la
 * entrada; el TP solo si nada adverso fue tocado). Con intrabar: gana lo que el camino cruce primero.
 */
export function resolveExit(sim: Sim, acc: Account, bar: SimBar): boolean {
    const { state, hooks } = sim;
    const p = acc.position;
    if (!p) return false;
    const tpl = tplOf(state, acc);
    const rules = rulesFor(acc, tpl);
    const denom = p.side * p.qty * pv(state);
    const cands: ExitCandidate[] = [];
    if (rules) {
        const thr = thresholdOf(acc, rules);
        const ddPrice = p.entry + (thr - acc.balance) / denom;
        if (Number.isFinite(ddPrice)) cands.push({ price: ddPrice, kind: 'dd' });
        if (rules.dailyLoss > 0) {
            const allowed = -rules.dailyLoss - acc.dailyPnl;
            const dailyPrice = p.entry + allowed / denom;
            if (Number.isFinite(dailyPrice)) cands.push({ price: dailyPrice, kind: 'daily' });
        }
    }
    if (p.sl != null) cands.push({ price: p.sl, kind: 'SL' });
    if (p.tp != null) cands.push({ price: p.tp, kind: 'TP' });
    if (!cands.length) return false;

    let hit: ExitCandidate | null = null;
    if (state.randomIntrabar) {
        const path = genIntrabarPath(bar, hooks.rng);
        hit = findFirstTouchInPath(path, cands);
    } else {
        const touched = cands.filter((c) => {
            if (c.kind === 'TP') {
                if (p.side > 0) return c.price >= p.entry - 1e-9 && bar.h >= c.price && c.price >= bar.l;
                return c.price <= p.entry + 1e-9 && bar.l <= c.price && c.price <= bar.h;
            }
            if (p.side > 0) return c.price <= p.entry + 1e-9 && bar.l <= c.price && c.price <= bar.h;
            return c.price >= p.entry - 1e-9 && bar.h >= c.price && c.price >= bar.l;
        });
        if (touched.length) {
            const adverse = touched.filter((c) => c.kind !== 'TP');
            if (adverse.length) {
                adverse.sort((a, b) => Math.abs(a.price - p.entry) - Math.abs(b.price - p.entry));
                hit = adverse[0]!;
            } else {
                touched.sort((a, b) => Math.abs(a.price - p.entry) - Math.abs(b.price - p.entry));
                hit = touched[0]!;
            }
        }
    }
    if (!hit) return false;
    closePosition(sim, acc, hit.price, hit.kind);
    if (acc.status === 'blown') hooks.showAlert(`⛔ MÁXIMO DRAWDOWN VIOLADO — ${acc.name} quemada`, 'blown');
    else if (acc.status === 'paused') hooks.showAlert(`⏸ LÍMITE DIARIO TOCADO — pausa diaria en ${acc.name}`, 'paused');
    return true;
}

/** Fills de órdenes + brackets contra un bar recién revelado, para TODAS las cuentas vivas en paralelo. */
export function processBar(sim: Sim, bar: SimBar): void {
    const { state } = sim;
    // 0) salida de posición — solo la lista VIVA (esto corre en cada barra)
    for (const acc of state.agentLiveAccounts) if (acc.position) resolveExit(sim, acc, bar);

    // 1) órdenes de trabajo (cada orden pertenece a una cuenta puntual)
    const remaining: Order[] = [];
    for (const o of state.orders) {
        const acc = state.agentLiveAccounts.find((a) => a.id === o.accId);
        if (!acc) continue; // orden huérfana → se descarta
        let fill = false;
        if (o.type === 'limit') {
            if (o.side > 0 && bar.l <= o.px) fill = true;
            if (o.side < 0 && bar.h >= o.px) fill = true;
        } else {
            if (o.side > 0 && bar.h >= o.px) fill = true;
            if (o.side < 0 && bar.l <= o.px) fill = true;
        }
        let filled = false;
        if (fill && !acc.position && canTrade(acc) && canOpenPosition(state, acc, o.side).ok) {
            acc.position = {
                side: o.side,
                qty: o.qty,
                entry: o.px,
                entryIdx: state.idx,
                atmName: o.atmName || null,
                sl: o.sl != null ? o.px - o.side * o.sl : null,
                tp: o.tp != null ? o.px + o.side * o.tp : null,
            };
            filled = true;
        }
        if (!filled) remaining.push(o);
    }
    state.orders = remaining;
}
