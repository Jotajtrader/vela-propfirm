// Port 1:1 de "PLANTILLAS DE CUENTA" del <script> de fondeo-sim.
import type { AtmPreset, FundedRules, Phase, SimState, Template } from './types';

/** La lista de ATM de UNA plantilla puntual (cada challenge tiene la suya, no una global). */
export function atmPresetsFor(state: SimState, tplId: string | null): AtmPreset[] {
    if (!tplId) return [];
    if (!state.atmPresetsByTpl[tplId]) state.atmPresetsByTpl[tplId] = [];
    return state.atmPresetsByTpl[tplId]!;
}

export function defaultAtmPresets(): Record<string, AtmPreset[]> {
    return {
        t1: [
            { id: 'atm1', name: 'Challenge 25k', type: 'market', qty: 2, sl: 12.5, tp: 16, price: null },
            { id: 'atm2', name: 'Colchón 25k', type: 'market', qty: 2, sl: 12.5, tp: 75, price: null },
            { id: 'atm3', name: 'Extracción 25k', type: 'market', qty: 2, sl: 12.5, tp: 3, price: null },
        ],
        t2: [
            // SL=50pts en las 3 = exactamente el DD (50*2*20=$2000): cualquier trade perdedor quema la
            // cuenta directo, no hay margen para un "día 2" de reintento.
            { id: 'atm4', name: 'Challenge 50k sin DLL', type: 'market', qty: 2, sl: 50, tp: 38, price: null },
            { id: 'atm5', name: 'Colchón 50k sin DLL', type: 'market', qty: 2, sl: 50, tp: 101, price: null },
            { id: 'atm6', name: 'Extracción 50k sin DLL', type: 'market', qty: 2, sl: 50, tp: 4, price: null },
        ],
    };
}

export function defaultTemplates(): Template[] {
    return [
        {
            id: 't1',
            name: 'Lucid 25k DLL flex',
            company: 'Lucid',
            cost: 50,
            size: 25000,
            activationCost: 0,
            allowSameDirectionMultiAccount: true,
            phases: [{ target: 1250, ddAmount: 1000, ddType: 'eod-trailing', lockAtStart: false, dailyLoss: 600, consistencyOn: true, consistencyPct: 50 }],
            funded: {
                ddAmount: 1000,
                ddType: 'eod-trailing',
                lockAtStart: true,
                dailyLoss: 600,
                payoutPct: 50,
                payoutCap: 1000,
                closeOnPayout: false,
                consistencyOn: false,
                consistencyPct: 50,
                bufferOn: false,
                buffer: 1100,
                capScheduleOn: false,
                capSchedule: [1500, 2000, 2500, 3000],
                splitPct: 90,
                maxPayouts: 4,
                minDays: 5,
                minDayProfit: 100,
                minCycleSum: 0,
            },
        },
        {
            id: 't2',
            name: 'Lucid 50k sin DLL',
            company: 'Lucid',
            cost: 100,
            size: 50000,
            activationCost: 0,
            allowSameDirectionMultiAccount: true,
            phases: [{ target: 3000, ddAmount: 2000, ddType: 'eod-trailing', lockAtStart: true, dailyLoss: 0, consistencyOn: true, consistencyPct: 50 }],
            funded: {
                ddAmount: 2000,
                ddType: 'eod-trailing',
                lockAtStart: true,
                dailyLoss: 0,
                payoutPct: 50,
                payoutCap: 2000,
                closeOnPayout: false,
                consistencyOn: false,
                consistencyPct: 50,
                bufferOn: true,
                buffer: 100,
                capScheduleOn: false,
                capSchedule: [1500, 2000, 2500, 3000],
                splitPct: 90,
                maxPayouts: 4,
                minDays: 5,
                minDayProfit: 150,
                minCycleSum: 0,
            },
        },
    ];
}

export function blankPhase(): Phase {
    return { target: 3000, ddAmount: 2000, ddType: 'trailing', lockAtStart: true, dailyLoss: 0, consistencyOn: false, consistencyPct: 50 };
}

export function blankFunded(): FundedRules {
    return {
        ddAmount: 2000,
        ddType: 'trailing',
        lockAtStart: true,
        dailyLoss: 0,
        payoutPct: 100,
        payoutCap: 2000,
        closeOnPayout: false,
        consistencyOn: false,
        consistencyPct: 50,
        bufferOn: false,
        buffer: 0,
        capScheduleOn: false,
        capSchedule: [1500, 2000, 2500, 3000],
        splitPct: 100,
        maxPayouts: 0,
        minDays: 0,
        minDayProfit: 0,
        minCycleSum: 0,
    };
}

export function newTemplateDraft(state: SimState): Template {
    return {
        id: `t${state.tid++}`,
        name: 'Nueva plantilla',
        company: state.selCompany || '',
        cost: 150,
        size: 50000,
        activationCost: 0,
        allowSameDirectionMultiAccount: true,
        phases: [blankPhase()],
        funded: blankFunded(),
    };
}
