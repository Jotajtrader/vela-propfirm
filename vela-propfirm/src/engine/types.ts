// Estado del simulador — espejo 1:1 del objeto `state` del <script> de fondeo-sim (HTML v0.3),
// sin los campos que eran puramente del chart/DOM (view, drawings, mouse, proj, pestañas…).
import type { SimBar, TradingDayCutoff, Rng } from './data';

export type { SimBar, TradingDayCutoff, Rng };

export type AccountStatus = 'challenge' | 'funded' | 'blown' | 'paid' | 'paused' | 'passed';
export type DdType = 'trailing' | 'eod-trailing' | 'static';
export type SimMode = 'challenge' | 'cushion' | 'full';
export type OrderType = 'market' | 'limit' | 'stop';
export type Side = 1 | -1;
export type AccountCategory = 'challenge' | 'funded' | 'paid' | 'blown';

/** Lo que comparten una fase de challenge y las reglas de fondeada (riesgo + consistencia). */
export interface RiskRules {
    ddAmount: number;
    ddType: DdType;
    lockAtStart: boolean;
    /** 0 = sin límite diario. */
    dailyLoss: number;
    consistencyOn: boolean;
    consistencyPct: number;
}

export interface Phase extends RiskRules {
    target: number;
}

export interface FundedRules extends RiskRules {
    payoutPct: number;
    /** 0 = sin tope. */
    payoutCap: number;
    closeOnPayout: boolean;
    bufferOn: boolean;
    buffer: number;
    capScheduleOn: boolean;
    capSchedule: number[];
    splitPct: number;
    /** 0 = ilimitados. */
    maxPayouts: number;
    minDays: number;
    minDayProfit: number;
    minCycleSum: number;
}

export type Rules = Phase | FundedRules;

export interface Template {
    id: string;
    name: string;
    company: string;
    cost: number;
    size: number;
    activationCost: number;
    allowSameDirectionMultiAccount: boolean;
    phases: Phase[];
    funded: FundedRules;
}

export interface AtmPreset {
    id: string;
    name: string;
    type: OrderType;
    qty: number;
    sl: number | null;
    tp: number | null;
    price: number | null;
}

export interface Position {
    side: Side;
    qty: number;
    entry: number;
    entryIdx: number;
    atmName: string | null;
    sl: number | null;
    tp: number | null;
}

export interface Order {
    id: number;
    accId: string;
    side: Side;
    type: 'limit' | 'stop';
    px: number;
    qty: number;
    atmName: string | null;
    sl: number | null;
    tp: number | null;
}

export interface LedgerEntry {
    type: 'cost' | 'payout';
    amount: number;
    day: number;
    acc: string;
}

export interface TradeLogEntry {
    entryTime: string | null;
    exitTime: string | null;
    side: Side;
    qty: number;
    atmName: string | null;
    entry: number;
    exit: number;
    pnl: number;
    reason: string;
    balance: number;
}

export interface Milestone {
    type: 'approved' | 'cushion' | 'payout';
    time: string | null;
    balance: number;
    balanceBefore?: number;
    withdrawal?: number;
    cashToTrader?: number;
    closed?: boolean;
}

export interface Account {
    id: string;
    tplId: string;
    name: string;
    status: AccountStatus;
    phaseIdx: number;
    startBalance: number;
    balance: number;
    peakBalance: number;
    stageStartBalance: number;
    dayStartBalance: number;
    dailyPnl: number;
    payouts: number;
    createdDay: number;
    payoutCount: number;
    dayProfits: number[];
    cycleValidDays: number;
    cycleProfitSum: number;
    activated: boolean;
    position: Position | null;
    everFunded: boolean;
    everReachedCushion: boolean;
    tradeLog: TradeLogEntry[];
    milestones: Milestone[];
    fundedCushionDeficit: number;
    /** Solo mientras status === 'paused'. */
    prevStatus?: AccountStatus;
    prevPhaseIdx?: number;
}

export interface HourMinute {
    h: number;
    m: number;
}

export interface AgentState {
    active: boolean;
    dateFrom: Date | null;
    dateTo: Date | null;
    startTimeOfDay: HourMinute | null;
    endTimeOfDay: HourMinute | null;
    tplId: string | null;
    challengeTarget: number;
    maxFundedActive: number;
    maxWaiting: number;
    qty: number;
    profitPauseChallenge: number;
    profitPauseFundedDay1: number;
    profitPauseFundedRest: number;
    waitMinMin: number;
    waitMaxMin: number;
    // estado de ejecución (no configuración):
    lastDay: string | null;
    queue: string[];
    queueIdx: number;
    nextTradeAt: Date | null;
    finishedToday: Set<string>;
    fundedDayCounts: Record<string, number>;
    fundedGoalReached: Record<string, boolean>;
}

export interface AgentSnapshot {
    accounts: Account[];
    ledger: LedgerEntry[];
    orders: Order[];
    idx: number;
    dayIndex: number;
    tradingPnl: number;
    aid: number;
    selAcct: string | null;
}

export interface SimState {
    bars: SimBar[];
    /** Índice del último bar revelado. */
    idx: number;
    playing: boolean;
    /** ms entre barras en Play. */
    speed: number;
    nativeMinutes: number;
    tradingDayCutoff: TradingDayCutoff;
    atmPresetsByTpl: Record<string, AtmPreset[]>;
    activeAtm: string | null;
    atmIdCounter: number;
    randomIntrabar: boolean;
    fastForward: { running: boolean; cancelled: boolean };
    /** Mientras es true, `render()` no repinta (modo rápido y saltos internos). */
    suppressRender: boolean;
    agent: AgentState;
    agentSnapshot: AgentSnapshot | null;
    simMode: SimMode;
    instr: string;
    comm: number;
    /** TODAS las cuentas, historial completo (para el Tracker). */
    accounts: Account[];
    /** Subconjunto: solo las NO terminales — lo único que escanea el agente por barra. */
    agentLiveAccounts: Account[];
    templates: Template[];
    selTpl: string | null;
    selAcct: string | null;
    selCompany: string | null;
    orders: Order[];
    ledger: LedgerEntry[];
    tradingPnl: number;
    dayIndex: number;
    oid: number;
    aid: number;
    tid: number;
}

/** Efectos que el HTML hacía contra el DOM/ventana; el host los provee. */
export interface SimHooks {
    rng: Rng;
    /** `alert()` del HTML: aviso bloqueante de validación. */
    alert(msg: string): void;
    /** `showAlert()` del HTML: aviso flotante sobre el chart. */
    showAlert(msg: string, kind: 'blown' | 'paused' | ''): void;
    /** `renderAll()` del HTML: el estado cambió y hay que repintar. */
    render(): void;
}

export interface Sim {
    state: SimState;
    hooks: SimHooks;
}
