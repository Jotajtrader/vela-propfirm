import { describe, expect, it } from 'vitest';
import { genSample, parseCSV } from '../src/engine/data';
import { parseCSVAsync } from '../src/vela/csv-async';

/** mulberry32 — RNG determinista, igual criterio que replay-provider.test.ts. */
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

function toCSV(bars: ReturnType<typeof genSample>): string {
    const rows = bars.map((b) => `${b.t.toISOString()},${b.o},${b.h},${b.l},${b.c},${b.v}`);
    return ['datetime,open,high,low,close,volume', ...rows].join('\n');
}

describe('csv-async: parseCSVAsync == parseCSV', () => {
    it('un archivo chico (una sola tanda) da el mismo resultado que parseCSV', async () => {
        const bars = genSample(2, 30, { h: 17, m: 0 }, seeded(3));
        const csv = toCSV(bars);
        const sync = parseCSV(csv, { h: 17, m: 0 });
        const async_ = await parseCSVAsync(csv, { h: 17, m: 0 });
        expect(async_).toEqual(sync);
    });

    it('un archivo que cruza el límite de tanda (20_000 líneas) da el mismo resultado que parseCSV', async () => {
        // 45_000 barras de 1 minuto → 2-3 tandas con la constante actual (20_000 líneas/tanda),
        // ejercitando el caso donde una tanda intermedia arranca con una fila de datos (no la
        // cabecera real) en su propia posición lines[0].
        const bars = genSample(1, 45_000, { h: 17, m: 0 }, seeded(9));
        const csv = toCSV(bars);
        const sync = parseCSV(csv, { h: 17, m: 0 });
        const async_ = await parseCSVAsync(csv, { h: 17, m: 0 });
        expect(async_).toHaveLength(sync.length);
        expect(async_).toEqual(sync);
    });

    it('progreso: onProgress se llama con el total correcto de líneas de datos procesadas', async () => {
        const bars = genSample(1, 25_000, { h: 17, m: 0 }, seeded(5));
        const csv = toCSV(bars);
        const calls: Array<[number, number]> = [];
        await parseCSVAsync(csv, { h: 17, m: 0 }, (done, total) => calls.push([done, total]));
        expect(calls.length).toBeGreaterThan(1); // más de una tanda
        const [lastDone, lastTotal] = calls[calls.length - 1]!;
        expect(lastDone).toBe(lastTotal);
    });
});
