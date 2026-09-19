import { describe, expect, it } from 'vitest';
import { aggregateBars, fmtDay, genSample, parseCSV } from '../src/engine/data';
import { ReplayProvider, timeframeToMinutes } from '../src/vela/ReplayProvider';

/** mulberry32 — RNG determinista para que el generador demo sea reproducible en tests. */
function seeded(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

describe('data: corte de jornada', () => {
    it('todo lo que pasa desde el corte cuenta como el día siguiente', () => {
        const cut = { h: 17, m: 0 };
        expect(fmtDay(new Date(2025, 0, 6, 16, 59), cut)).toBe('2025-01-06');
        expect(fmtDay(new Date(2025, 0, 6, 17, 0), cut)).toBe('2025-01-07');
        expect(fmtDay(new Date(2025, 0, 6, 23, 30), cut)).toBe('2025-01-07');
    });
    it('sin corte, medianoche pura', () => {
        expect(fmtDay(new Date(2025, 0, 6, 23, 59), null)).toBe('2025-01-06');
    });
});

describe('data: generador demo y CSV', () => {
    it('genera days × barsPerDay barras de 1 minuto, OHLC coherente', () => {
        const bars = genSample(2, 30, { h: 17, m: 0 }, seeded(1));
        expect(bars).toHaveLength(60);
        for (const b of bars) {
            expect(b.h).toBeGreaterThanOrEqual(Math.max(b.o, b.c));
            expect(b.l).toBeLessThanOrEqual(Math.min(b.o, b.c));
        }
        expect(bars[1]!.t.getTime() - bars[0]!.t.getTime()).toBe(60_000);
        expect(bars[0]!.day).toBe('2025-01-06');
        expect(bars[30]!.day).toBe('2025-01-07');
    });
    it('parsea datetime en 1 columna con cabecera', () => {
        const csv = 'datetime,open,high,low,close,volume\n2025-01-06 09:30,1,2,0.5,1.5,10\n2025-01-06 09:31,1.5,2.5,1,2,20';
        const bars = parseCSV(csv, { h: 17, m: 0 });
        expect(bars).toHaveLength(2);
        expect(bars[0]).toMatchObject({ o: 1, h: 2, l: 0.5, c: 1.5, v: 10, day: '2025-01-06' });
    });
});

describe('data: agregación multi-timeframe', () => {
    const bars = genSample(1, 12, { h: 17, m: 0 }, seeded(7)); // 09:30 … 09:41

    it('cubetas de 5 minutos alineadas al minuto-del-día (09:30, 09:35, 09:40)', () => {
        const agg = aggregateBars(bars, bars.length - 1, 5);
        expect(agg.map((b) => b.t.getMinutes())).toEqual([30, 35, 40]);
        expect(agg[0]!.o).toBe(bars[0]!.o);
        expect(agg[0]!.c).toBe(bars[4]!.c);
        expect(agg[0]!.h).toBe(Math.max(...bars.slice(0, 5).map((b) => b.h)));
        expect(agg[0]!.l).toBe(Math.min(...bars.slice(0, 5).map((b) => b.l)));
        expect(agg[0]!.v).toBe(bars.slice(0, 5).reduce((s, b) => s + b.v, 0));
    });
    it('la última cubeta queda en formación con lo revelado hasta uptoIdx', () => {
        const agg = aggregateBars(bars, 6, 5); // 09:30..09:36 → 2 cubetas, la 2ª con 2 barras
        expect(agg).toHaveLength(2);
        expect(agg[1]!.c).toBe(bars[6]!.c);
    });
});

describe('ReplayProvider', () => {
    it('mapea timeframes de Vela a minutos', () => {
        expect(timeframeToMinutes('1')).toBe(1);
        expect(timeframeToMinutes('60')).toBe(60);
        expect(timeframeToMinutes('4h')).toBe(240);
        expect(timeframeToMinutes('D')).toBe(1440);
    });

    it('getBars sirve solo hasta el cursor y honra from/to/limit', async () => {
        const p = new ReplayProvider();
        const bars = genSample(1, 40, { h: 17, m: 0 }, seeded(3));
        p.load(bars, 19); // 20 barras reveladas
        const all = await p.getBars('NQ', '1', {});
        expect(all).toHaveLength(20);
        expect(all[19]!.time).toBe(bars[19]!.t.getTime());
        const limited = await p.getBars('NQ', '1', { limit: 5 });
        expect(limited.map((b) => b.time)).toEqual(bars.slice(15, 20).map((b) => b.t.getTime()));
        const ranged = await p.getBars('NQ', '1', { from: bars[10]!.t.getTime(), to: bars[12]!.t.getTime() });
        expect(ranged).toHaveLength(3);
        const agg5 = await p.getBars('NQ', '5', {});
        expect(agg5).toHaveLength(4);
    });

    it('un timeframe menor al nativo se sirve como el nativo', async () => {
        const p = new ReplayProvider();
        const oneMin = genSample(1, 10, { h: 17, m: 0 }, seeded(5));
        const fiveMin = aggregateBars(oneMin, oneMin.length - 1, 5); // dataset nativo de 5m
        p.load(fiveMin, fiveMin.length - 1);
        expect(p.nativeTimeframeMinutes).toBe(5);
        expect(await p.getBars('NQ', '1', {})).toHaveLength(fiveMin.length);
    });

    it('step empuja la vela agregada: mismo open-time dentro de la cubeta, nuevo al cruzarla', () => {
        const p = new ReplayProvider();
        const bars = genSample(1, 12, { h: 17, m: 0 }, seeded(9));
        p.load(bars, 2); // cursor en 09:32
        const seen: { time: number; close: number }[] = [];
        const off = p.subscribe('NQ', '5', (b) => seen.push({ time: b.time, close: b.close }));
        expect(p.step()).toBe(true); // 09:33 → sigue en la cubeta 09:30
        expect(p.step()).toBe(true); // 09:34
        expect(p.step()).toBe(true); // 09:35 → cubeta nueva
        expect(seen).toHaveLength(3);
        expect(seen[0]!.time).toBe(bars[0]!.t.getTime());
        expect(seen[1]!.time).toBe(bars[0]!.t.getTime());
        expect(seen[1]!.close).toBe(bars[4]!.c);
        expect(seen[2]!.time).toBe(bars[5]!.t.getTime());
        expect(seen[2]!.close).toBe(bars[5]!.c);
        off();
        expect(p.step()).toBe(true);
        expect(seen).toHaveLength(3); // desuscripto: no llega nada más
    });

    it('step devuelve false al final; setCursor no empuja', () => {
        const p = new ReplayProvider();
        const bars = genSample(1, 3, { h: 17, m: 0 }, seeded(2));
        p.load(bars, 1);
        let pushes = 0;
        p.subscribe('NQ', '1', () => pushes++);
        p.setCursor(0);
        expect(pushes).toBe(0);
        expect(p.step()).toBe(true);
        expect(p.step()).toBe(true);
        expect(p.step()).toBe(false);
        expect(pushes).toBe(2);
    });
});
