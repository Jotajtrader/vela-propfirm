import { describe, expect, it } from 'vitest';
import { Simulator } from '../src/engine/Simulator';
import { applyPrefs, prefsFingerprint, prefsFromState } from '../src/engine/prefs';
import { genSample } from '../src/engine/data';

describe('prefs: ida y vuelta por el documento de estado', () => {
    it('serializa y restaura plantillas, ATM, modo, instrumento, corte y config del agente', () => {
        const a = new Simulator();
        a.setSimMode('cushion');
        a.setInstrument('MNQ');
        a.setCommission(1.25);
        a.setTradingDayCutoff({ h: 16, m: 30 });
        a.setRandomIntrabar(true);
        a.saveAtmPreset('t1', { name: 'Nuevo', type: 'limit', qty: 3, sl: 7, tp: 14, price: 20000 });
        a.applyAgentConfig({
            tplId: 't2',
            dateFrom: new Date('2025-01-07T00:00:00'),
            dateTo: null,
            startTimeOfDay: { h: 9, m: 35 },
            endTimeOfDay: { h: 12, m: 0 },
            challengeTarget: 4,
            maxFundedActive: 3,
            maxWaiting: 1,
            profitPauseChallenge: 300,
            profitPauseFundedDay1: 200,
            profitPauseFundedRest: 100,
            waitMinMin: 2,
            waitMaxMin: 6,
            qty: 1,
        });
        const payload = JSON.parse(JSON.stringify(prefsFromState(a.state)));

        const b = new Simulator();
        expect(applyPrefs(b.state, payload)).toBe(true);
        expect(b.state.simMode).toBe('cushion');
        expect(b.state.instr).toBe('MNQ');
        expect(b.state.comm).toBe(1.25);
        expect(b.state.tradingDayCutoff).toEqual({ h: 16, m: 30 });
        expect(b.state.randomIntrabar).toBe(true);
        expect(b.state.atmPresetsByTpl.t1!.map((p) => p.name)).toContain('Nuevo');
        expect(b.state.atmIdCounter).toBe(a.state.atmIdCounter);
        expect(b.state.agent.tplId).toBe('t2');
        expect(b.state.agent.dateFrom?.getTime()).toBe(new Date('2025-01-07T00:00:00').getTime());
        expect(b.state.agent.startTimeOfDay).toEqual({ h: 9, m: 35 });
        expect(b.state.agent.challengeTarget).toBe(4);
        expect(b.state.agent.waitMaxMin).toBe(6);
        expect(b.state.agent.active).toBe(false); // solo configuración: nunca arranca sola
        expect(prefsFingerprint(b.state)).toBe(prefsFingerprint(a.state));
    });

    it('rechaza payloads sin forma y no rompe cuentas existentes al reemplazar plantillas', () => {
        const s = new Simulator();
        expect(applyPrefs(s.state, null)).toBe(false);
        expect(applyPrefs(s.state, { v: 2 })).toBe(false);
        expect(applyPrefs(s.state, 'x')).toBe(false);
        s.loadBars(genSample(1, 30));
        s.buyAccounts(s.state.templates[0]!, 1); // usa t1
        const foreign = { v: 1, templates: [{ id: 'zz', name: 'Otra', phases: [{ target: 1, ddAmount: 1 }], funded: { ddAmount: 1 } }] };
        expect(applyPrefs(s.state, foreign)).toBe(true);
        expect(s.state.templates.map((t) => t.id)).toContain('t1'); // la cuenta comprada sigue teniendo plantilla
    });

    it('la huella cambia solo cuando cambia algo persistible', () => {
        const s = new Simulator();
        s.loadBars(genSample(1, 40));
        const f0 = prefsFingerprint(s.state);
        s.step();
        s.step();
        expect(prefsFingerprint(s.state)).toBe(f0);
        s.setSimMode('challenge');
        expect(prefsFingerprint(s.state)).not.toBe(f0);
    });
});
