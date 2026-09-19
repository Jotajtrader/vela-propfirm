// Foto del estado justo antes de la primera compra / corrida del agente, para "Reset".
import type { AgentSnapshot, SimState } from './types';

const deepClone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

export function takeAgentSnapshot(state: SimState): void {
    state.agentSnapshot = {
        accounts: deepClone(state.accounts),
        ledger: deepClone(state.ledger),
        orders: deepClone(state.orders),
        idx: state.idx,
        dayIndex: state.dayIndex,
        tradingPnl: state.tradingPnl,
        aid: state.aid,
        selAcct: state.selAcct,
    };
}

export function cloneSnapshot(snap: AgentSnapshot): AgentSnapshot {
    return { ...snap, accounts: deepClone(snap.accounts), ledger: deepClone(snap.ledger), orders: deepClone(snap.orders) };
}
