// La fachada del motor: un estado + los hooks que el HTML resolvía contra el DOM, expuestos como
// eventos. Toda la lógica vive en los módulos portados 1:1; acá solo se compone.
import type { AtmPreset, HourMinute, Sim, SimHooks, SimMode, SimState, Side, Template, TradingDayCutoff, Account } from './types';
import { retagBarsWithCutoff, type Rng, type SimBar } from './data';
import { atmPresetsFor, defaultAtmPresets, defaultTemplates } from './templates';
import { activateFundedAccount, buyAccount, collectPayout, tplOf } from './rules';
import { activeAcct, cancelOrder, closePosition, curPx, openPosition, placeOrder, pv, updatePositionLevels } from './trading';
import * as replay from './replay';
import * as agent from './agent';
import { exportSession, importSession, type SessionDocument } from './session';

export interface SimulatorEvents {
    /** El estado cambió (el `renderAll()` del HTML). */
    change: undefined;
    /** Aviso de validación (el `alert()` del HTML). */
    alert: string;
    /** Aviso flotante sobre el chart (el `showAlert()` del HTML). */
    notice: { msg: string; kind: 'blown' | 'paused' | '' };
}

type Listener<K extends keyof SimulatorEvents> = (payload: SimulatorEvents[K]) => void;

export function initialState(): SimState {
    return {
        bars: [],
        idx: -1,
        playing: false,
        speed: replay.SPEED_MS[2],
        nativeMinutes: 1,
        tradingDayCutoff: { h: 17, m: 0 },
        atmPresetsByTpl: defaultAtmPresets(),
        activeAtm: null,
        atmIdCounter: 7,
        randomIntrabar: false,
        fastForward: { running: false, cancelled: false },
        suppressRender: false,
        agent: {
            active: false,
            dateFrom: null,
            dateTo: null,
            startTimeOfDay: null,
            endTimeOfDay: null,
            tplId: null,
            challengeTarget: 5,
            maxFundedActive: 5,
            maxWaiting: 3,
            qty: 2,
            profitPauseChallenge: 0,
            profitPauseFundedDay1: 0,
            profitPauseFundedRest: 0,
            waitMinMin: 5,
            waitMaxMin: 30,
            lastDay: null,
            queue: [],
            queueIdx: 0,
            nextTradeAt: null,
            finishedToday: new Set(),
            fundedDayCounts: {},
            fundedGoalReached: {},
        },
        agentSnapshot: null,
        simMode: 'full',
        instr: 'NQ',
        comm: 2.5,
        accounts: [],
        agentLiveAccounts: [],
        templates: defaultTemplates(),
        selTpl: 't1',
        selAcct: null,
        selCompany: null,
        orders: [],
        ledger: [],
        tradingPnl: 0,
        dayIndex: 0,
        oid: 1,
        aid: 1,
        tid: 100,
    };
}

export class Simulator implements Sim {
    readonly state: SimState;
    readonly hooks: SimHooks;
    private readonly listeners = new Map<keyof SimulatorEvents, Set<Listener<keyof SimulatorEvents>>>();

    constructor(opts: { rng?: Rng; state?: SimState } = {}) {
        this.state = opts.state ?? initialState();
        this.hooks = {
            rng: opts.rng ?? Math.random,
            alert: (msg) => this.emit('alert', msg),
            showAlert: (msg, kind) => this.emit('notice', { msg, kind }),
            render: () => {
                if (!this.state.suppressRender) this.emit('change', undefined);
            },
        };
    }

    on<K extends keyof SimulatorEvents>(event: K, cb: Listener<K>): () => void {
        let set = this.listeners.get(event);
        if (!set) {
            set = new Set();
            this.listeners.set(event, set);
        }
        set.add(cb as Listener<keyof SimulatorEvents>);
        return () => set!.delete(cb as Listener<keyof SimulatorEvents>);
    }

    private emit<K extends keyof SimulatorEvents>(event: K, payload: SimulatorEvents[K]): void {
        const set = this.listeners.get(event);
        if (!set) return;
        for (const cb of set) (cb as Listener<K>)(payload);
    }

    // ── datos / replay ──────────────────────────────────────────────────────────────────
    loadBars(bars: SimBar[]): boolean {
        return replay.loadBars(this, bars);
    }
    step(): void {
        replay.stepForward(this);
    }
    togglePlay(): void {
        replay.togglePlay(this);
    }
    play(): void {
        replay.startPlay(this);
    }
    stop(): void {
        replay.stopPlay(this);
    }
    setSpeed(ms: number): void {
        replay.setSpeed(this, ms);
    }
    skipDay(): void {
        replay.skipDay(this);
    }
    gotoDateTime(target: Date): boolean {
        return replay.gotoDateTime(this, target);
    }
    gotoNextDaySameTime(timeOfDay?: HourMinute | null): boolean {
        return replay.gotoNextDaySameTime(this, timeOfDay);
    }
    fastForward(opts?: { chunkMs?: number; onProgress?: () => void }): Promise<void> {
        return replay.startFastForward(this, opts);
    }
    cancelFastForward(): void {
        replay.cancelFastForward(this);
    }
    setRandomIntrabar(on: boolean): void {
        this.state.randomIntrabar = on;
        this.hooks.render();
    }

    // ── configuración ───────────────────────────────────────────────────────────────────
    setInstrument(instr: string): void {
        this.state.instr = instr;
        this.hooks.render();
    }
    setCommission(comm: number): void {
        this.state.comm = comm || 0;
    }
    setTradingDayCutoff(cut: TradingDayCutoff): void {
        this.state.tradingDayCutoff = cut;
        retagBarsWithCutoff(this.state.bars, cut);
        this.hooks.render();
    }
    setSimMode(mode: SimMode): void {
        this.state.simMode = mode;
        this.hooks.render();
    }

    // ── cuentas ─────────────────────────────────────────────────────────────────────────
    selectAccount(id: string | null): void {
        this.state.selAcct = id;
        this.hooks.render();
    }
    activeAccount(): Account | undefined {
        return activeAcct(this.state);
    }
    /** El botón "Comprar" del modal: n cuentas de la plantilla, compra MANUAL. */
    buyAccounts(tpl: Template, n: number): void {
        for (let i = 0; i < Math.max(1, n); i++) buyAccount(this, tpl, true);
    }
    rebuy(acc: Account): void {
        const tpl = tplOf(this.state, acc);
        if (tpl) buyAccount(this, tpl, true);
    }
    activate(acc: Account): boolean {
        return activateFundedAccount(this, acc);
    }
    collectPayout(acc: Account): void {
        collectPayout(this, acc);
    }

    // ── plantillas ──────────────────────────────────────────────────────────────────────
    /** "Guardar plantilla": valida y upsertea. false = validación fallida (ya avisó). */
    saveTemplate(draft: Template): boolean {
        const d = draft;
        d.name = d.name.trim() || 'Sin nombre';
        d.company = d.company.trim() || 'Sin empresa';
        for (const p of d.phases) {
            if (!(p.target > 0) || !(p.ddAmount > 0)) {
                this.hooks.alert('Cada fase necesita Objetivo y Drawdown mayores a 0.');
                return false;
            }
        }
        if (!(d.funded.ddAmount > 0)) {
            this.hooks.alert('Las reglas de fondeada necesitan Drawdown mayor a 0.');
            return false;
        }
        const idx = this.state.templates.findIndex((t) => t.id === d.id);
        if (idx >= 0) this.state.templates[idx] = d;
        else this.state.templates.push(d);
        this.state.selCompany = d.company;
        this.state.selTpl = d.id;
        this.hooks.render();
        return true;
    }
    /** Elimina si ninguna cuenta (activa o histórica) la usa. */
    deleteTemplate(id: string): { ok: boolean; msg: string } {
        const t = this.state.templates.find((x) => x.id === id);
        if (!t) return { ok: false, msg: 'Elegí una plantilla primero.' };
        if (this.state.accounts.some((a) => a.tplId === t.id)) return { ok: false, msg: 'No se puede eliminar: hay cuentas (activas o históricas) que usan esta plantilla.' };
        this.state.templates = this.state.templates.filter((x) => x.id !== t.id);
        delete this.state.atmPresetsByTpl[t.id];
        this.state.selTpl = null;
        this.hooks.render();
        return { ok: true, msg: 'Plantilla eliminada.' };
    }
    companies(): string[] {
        return [...new Set(this.state.templates.map((t) => t.company || 'Sin empresa'))];
    }

    // ── ATM ─────────────────────────────────────────────────────────────────────────────
    atmPresets(tplId: string | null): AtmPreset[] {
        return atmPresetsFor(this.state, tplId);
    }
    saveAtmPreset(tplId: string, preset: Omit<AtmPreset, 'id'> & { id?: string | null }): AtmPreset {
        const full: AtmPreset = { ...preset, id: preset.id || `atm${this.state.atmIdCounter++}` };
        const presets = atmPresetsFor(this.state, tplId);
        const idx = presets.findIndex((x) => x.id === full.id);
        if (idx >= 0) presets[idx] = full;
        else presets.push(full);
        this.hooks.render();
        return full;
    }
    deleteAtmPreset(tplId: string, id: string): void {
        this.state.atmPresetsByTpl[tplId] = atmPresetsFor(this.state, tplId).filter((x) => x.id !== id);
        if (this.state.activeAtm === id) this.state.activeAtm = null;
        this.hooks.render();
    }
    setActiveAtm(id: string | null): void {
        this.state.activeAtm = this.state.activeAtm === id ? null : id;
        this.hooks.render();
    }

    // ── trading ─────────────────────────────────────────────────────────────────────────
    /**
     * El click en COMPRAR/VENDER: con un ATM activo ejecuta el preset y devuelve true; si no,
     * devuelve false para que la UI abra el modal de orden.
     */
    submitActiveAtm(side: Side): boolean {
        if (!this.state.activeAtm) return false;
        const acc = activeAcct(this.state);
        const atm = acc ? atmPresetsFor(this.state, acc.tplId).find((a) => a.id === this.state.activeAtm) : undefined;
        if (!atm) return false;
        this.submitAtmOrder(side, atm);
        return true;
    }
    submitAtmOrder(side: Side, atm: AtmPreset): void {
        const q = Math.max(1, atm.qty || 1);
        if (atm.type === 'market') openPosition(this, side, q, atm.sl, atm.tp, atm.name);
        else {
            if (!(atm.price != null && atm.price > 0)) {
                this.hooks.alert(`El preset "${atm.name}" no tiene un precio de entrada válido.`);
                return;
            }
            placeOrder(this, side, atm.type, atm.price, q, atm.sl, atm.tp, atm.name);
        }
    }
    openPosition(side: Side, qty: number, slPts: number | null, tpPts: number | null): boolean {
        return openPosition(this, side, qty, slPts, tpPts);
    }
    placeOrder(side: Side, type: 'limit' | 'stop', px: number, qty: number, slPts: number | null, tpPts: number | null): boolean {
        return placeOrder(this, side, type, px, qty, slPts, tpPts);
    }
    cancelOrder(id: number): void {
        cancelOrder(this, id);
    }
    /** FLATTEN: cierra la posición de la cuenta seleccionada al precio actual. */
    flatten(): boolean {
        const acc = activeAcct(this.state);
        if (acc && acc.position) {
            closePosition(this, acc, curPx(this.state), 'manual');
            return true;
        }
        this.hooks.alert('No hay posición abierta en esta cuenta.');
        return false;
    }
    currentPrice(): number {
        return curPx(this.state);
    }
    /** Epoch ms del bar en curso (para anclar dibujos/anotaciones al cursor del replay). */
    currentTime(): number {
        const b = this.state.bars[this.state.idx];
        return b ? b.t.getTime() : Date.now();
    }
    /** Valor en $ de un punto para el instrumento activo (para el P&L abierto fuera del motor). */
    pointValue(): number {
        return pv(this.state);
    }
    /** Ajusta el SL/TP (precios absolutos) de la posición abierta de la cuenta activa. */
    updatePositionLevels(patch: { sl?: number | null; tp?: number | null }): boolean {
        const acc = activeAcct(this.state);
        return acc ? updatePositionLevels(this, acc, patch) : false;
    }

    // ── agente ──────────────────────────────────────────────────────────────────────────
    applyAgentConfig(cfg: agent.AgentConfigInput): boolean {
        return agent.applyAgentConfig(this, cfg);
    }
    deactivateAgent(): void {
        agent.deactivateAgent(this);
    }
    resetAgentRun(): void {
        agent.resetAgentRun(this);
    }
    canResetAgent(): boolean {
        return agent.canResetAgent(this.state);
    }
    agentStatusText(): string {
        return agent.agentStatusText(this.state);
    }

    // ── sesión ──────────────────────────────────────────────────────────────────────────
    exportSession(theme?: 'light' | 'dark'): SessionDocument {
        return exportSession(this, theme);
    }
    importSession(doc: Partial<SessionDocument>): void {
        importSession(this, doc);
    }
}
