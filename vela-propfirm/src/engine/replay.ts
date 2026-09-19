// Port 1:1 de "REPLAY" del <script> de fondeo-sim: el reloj de barras que comparten Play/Step,
// los saltos y el Modo Agente.
import type { HourMinute, Sim, SimState } from './types';
import { detectNativeMinutes, type SimBar } from './data';
import { curBar, rollDay } from './rules';
import { closePosition, curPx, processBar } from './trading';
import { agentFlattenStuckPositionsOnDayChange, agentStep } from './agent';

/** ms entre barras, de más lento a máx (posiciones del slider de velocidad). */
export const SPEED_MS = [2000, 1200, 700, 400, 220, 110, 50] as const;

const timers = new WeakMap<SimState, ReturnType<typeof setInterval>>();

export function loadBars(sim: Sim, bars: SimBar[]): boolean {
    const { state, hooks } = sim;
    if (!bars.length) {
        hooks.alert('No se pudieron leer barras.');
        return false;
    }
    state.bars = bars;
    state.idx = Math.min(80, bars.length - 1);
    state.dayIndex = 0;
    state.orders = [];
    state.nativeMinutes = detectNativeMinutes(bars);
    state.agentSnapshot = null; // una foto tomada con los datos VIEJOS ya no sirve
    hooks.render();
    return true;
}

/** Un tick del reloj SIN repintar: rota el día si corresponde, procesa la barra, corre el agente. */
export function stepForwardSilent(sim: Sim): boolean {
    const { state } = sim;
    if (state.idx >= state.bars.length - 1) return false;
    const nextIdx = state.idx + 1;
    if (state.bars[nextIdx]!.day !== state.bars[state.idx]!.day) {
        rollDay(sim);
        agentFlattenStuckPositionsOnDayChange(sim);
    }
    state.idx = nextIdx;
    processBar(sim, state.bars[state.idx]!);
    agentStep(sim);
    return true;
}

export function stepForward(sim: Sim): void {
    if (!stepForwardSilent(sim)) {
        stopPlay(sim);
        return;
    }
    sim.hooks.render();
}

export function togglePlay(sim: Sim): void {
    if (sim.state.playing) stopPlay(sim);
    else startPlay(sim);
}

export function startPlay(sim: Sim): void {
    const { state } = sim;
    if (state.idx >= state.bars.length - 1) return;
    state.playing = true;
    const prev = timers.get(state);
    if (prev) clearInterval(prev);
    timers.set(
        state,
        setInterval(() => stepForward(sim), state.speed),
    );
    sim.hooks.render();
}

export function stopPlay(sim: Sim): void {
    const { state } = sim;
    state.playing = false;
    const prev = timers.get(state);
    if (prev) clearInterval(prev);
    timers.delete(state);
    sim.hooks.render();
}

/** Cambia la velocidad; si está en Play, re-arma el intervalo (el `oninput` del slider). */
export function setSpeed(sim: Sim, ms: number): void {
    sim.state.speed = ms;
    if (sim.state.playing) startPlay(sim);
}

/** Va al final del día actual FLATEANDO posiciones, procesando fills de las barras saltadas. */
export function skipDay(sim: Sim): void {
    const { state } = sim;
    stopPlay(sim);
    const b = curBar(state);
    if (!b) return;
    const px = curPx(state);
    for (const acc of [...state.agentLiveAccounts]) if (acc.position) closePosition(sim, acc, px, 'skip');
    const today = b.day;
    let i = state.idx;
    while (i < state.bars.length - 1 && state.bars[i]!.day === today) i++;
    for (let j = state.idx + 1; j <= i; j++) {
        state.idx = j;
        processBar(sim, state.bars[j]!);
    }
    if (state.bars[state.idx]!.day !== today) rollDay(sim);
    sim.hooks.render();
}

/**
 * Avanza hasta targetIdx procesando cada barra (fills, brackets, riesgo, rollDay), SIN alert() y
 * sin repintar por el camino. El llamador valida el índice antes. NO flatea: es un fast-forward.
 */
export function advanceToIndexSilent(sim: Sim, targetIdx: number): void {
    const { state } = sim;
    const prevSuppress = state.suppressRender;
    state.suppressRender = true;
    try {
        for (let j = state.idx + 1; j <= targetIdx; j++) {
            if (state.bars[j]!.day !== state.bars[j - 1]!.day) {
                rollDay(sim);
                agentFlattenStuckPositionsOnDayChange(sim); // state.idx todavía apunta a j-1
            }
            state.idx = j;
            processBar(sim, state.bars[j]!);
        }
    } finally {
        state.suppressRender = prevSuppress;
    }
}

/** Ir a fecha/hora: solo hacia adelante. true si se movió. */
export function gotoDateTime(sim: Sim, target: Date): boolean {
    const { state, hooks } = sim;
    if (!state.bars.length) {
        hooks.alert('Cargá datos primero.');
        return false;
    }
    const targetIdx = state.bars.findIndex((b) => b.t.getTime() >= target.getTime());
    if (targetIdx === -1) {
        hooks.alert('No hay datos a partir de esa fecha/hora.');
        return false;
    }
    if (targetIdx <= state.idx) {
        hooks.alert('Esa fecha/hora ya quedó atrás en el replay (no se puede retroceder).');
        return false;
    }
    stopPlay(sim);
    advanceToIndexSilent(sim, targetIdx);
    hooks.render();
    return true;
}

/** Día calendario siguiente a la MISMA hora (o a la hora indicada). */
export function gotoNextDaySameTime(sim: Sim, timeOfDay?: HourMinute | null): boolean {
    const b = curBar(sim.state);
    if (!b) return false;
    const hh = timeOfDay ? timeOfDay.h : b.t.getHours();
    const mm = timeOfDay ? timeOfDay.m : b.t.getMinutes();
    const target = new Date(b.t.getTime());
    target.setDate(target.getDate() + 1);
    target.setHours(hh, mm, 0, 0);
    return gotoDateTime(sim, target);
}

/**
 * Modo rápido: corre toda la simulación en trozos SIN repintar por barra, cediendo el hilo cada
 * ~50 ms. Resuelve al terminar (fin de datos, agente terminado, cancelación o error).
 */
export function startFastForward(sim: Sim, opts: { chunkMs?: number; onProgress?: () => void } = {}): Promise<void> {
    const { state, hooks } = sim;
    if (!state.bars.length || state.fastForward.running) return Promise.resolve();
    stopPlay(sim);
    state.fastForward.running = true;
    state.fastForward.cancelled = false;
    const agentWasActive = state.agent.active;
    const chunkMs = opts.chunkMs ?? 50;
    hooks.render();
    return new Promise<void>((resolve) => {
        const finish = (): void => {
            state.fastForward.running = false;
            hooks.render();
            resolve();
        };
        const chunk = (): void => {
            if (state.fastForward.cancelled) return finish();
            const chunkStart = performance.now();
            let keepGoing = true;
            state.suppressRender = true;
            try {
                while (keepGoing) {
                    keepGoing = stepForwardSilent(sim);
                    if (!keepGoing) break;
                    if (agentWasActive && !state.agent.active) break; // el agente terminó solo
                    if (performance.now() - chunkStart > chunkMs) break;
                }
            } catch (err) {
                state.suppressRender = false;
                console.error('Modo rápido: corrida interrumpida por un error', err);
                finish();
                hooks.showAlert(`El modo rápido se detuvo por un error inesperado: ${(err as Error)?.message || err}`, '');
                return;
            } finally {
                state.suppressRender = false;
            }
            opts.onProgress?.();
            const doneByData = state.idx >= state.bars.length - 1;
            const doneByAgent = agentWasActive && !state.agent.active;
            if (doneByData || doneByAgent) return finish();
            setTimeout(chunk, 0);
        };
        chunk();
    });
}

export function cancelFastForward(sim: Sim): void {
    if (sim.state.fastForward.running) sim.state.fastForward.cancelled = true;
}
