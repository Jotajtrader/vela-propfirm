import type { DataProvider, OHLCV, BarRange, ProviderInfo, SymbolDescriptor } from '@luxalgo/vela';
import { aggregateBars, detectNativeMinutes, type SimBar } from '../engine/data';

type OnBar = (bar: OHLCV) => void;

/** Timeframe de Vela → minutos. Número pelado = minutos; `D` = 1440; alias `15m`/`4h`/`1d`. */
export function timeframeToMinutes(timeframe: string): number {
    const tf = timeframe.trim();
    if (tf === 'D') return 1440;
    if (tf === 'W') return 10080;
    const m = /^(\d+)\s*(m|h|d|w)?$/i.exec(tf);
    if (!m) return 60;
    const n = parseInt(m[1]!, 10);
    const unit = (m[2] ?? 'm').toLowerCase();
    return n * (unit === 'm' ? 1 : unit === 'h' ? 60 : unit === 'd' ? 1440 : 10080);
}

function toOHLCV(b: SimBar): OHLCV {
    return { time: b.t.getTime(), open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v };
}

/**
 * El reloj del replay visto como un `DataProvider` de Vela.
 *
 * - `getBars` sirve las barras nativas agregadas al timeframe pedido, reveladas hasta el cursor.
 * - `subscribe` es la vía por la que el replay EMPUJA cada avance al chart: la misma barra
 *   agregada con el mismo open-time refina la vela en formación; un open-time mayor la cierra.
 *   Por ese camino Vela recalcula solo indicadores nativos y Pine.
 * - Un salto grande (saltar día, ir a fecha, Reset) NO se empuja barra a barra: se mueve el
 *   cursor y el host fuerza una recarga del mercado (ver playground/main.ts).
 */
export class ReplayProvider implements DataProvider {
    private bars: SimBar[] = [];
    private idx = -1;
    private nativeMinutes = 1;
    private readonly subs = new Map<string, Set<OnBar>>();
    private readonly symbols: SymbolDescriptor[] = [
        { ticker: 'NQ', description: 'E-mini Nasdaq 100 ($20/pt)', type: 'futures' },
        { ticker: 'MNQ', description: 'Micro E-mini Nasdaq 100 ($2/pt)', type: 'futures' },
        { ticker: 'GC', description: 'Gold ($100/pt)', type: 'futures' },
        { ticker: 'MGC', description: 'Micro Gold ($10/pt)', type: 'futures' },
    ];

    /** Carga un dataset nuevo y deja el cursor en `startIdx` (el HTML arranca en min(80, n-1)). */
    load(bars: SimBar[], startIdx = Math.min(80, bars.length - 1)): void {
        this.bars = bars;
        this.nativeMinutes = detectNativeMinutes(bars);
        this.idx = Math.max(-1, Math.min(startIdx, bars.length - 1));
    }

    get cursor(): number {
        return this.idx;
    }

    get length(): number {
        return this.bars.length;
    }

    get native(): readonly SimBar[] {
        return this.bars;
    }

    get nativeTimeframeMinutes(): number {
        return this.nativeMinutes;
    }

    current(): SimBar | undefined {
        return this.bars[this.idx];
    }

    /** La vela agregada que contiene el cursor en el timeframe pedido (lo que el chart ve como última vela). */
    currentBucket(timeframe: string): SimBar | undefined {
        if (this.idx < 0) return undefined;
        const tf = this.effectiveMinutes(timeframe);
        return tf === this.nativeMinutes ? this.bars[this.idx] : lastBucket(this.bars, this.idx, tf);
    }

    /** Avanza UNA barra nativa y la empuja a todos los suscriptores. false al llegar al final. */
    step(): boolean {
        if (this.idx >= this.bars.length - 1) return false;
        this.idx++;
        this.pushCurrent();
        return true;
    }

    /** Mueve el cursor sin empujar nada (saltos / Reset): el host recarga el mercado después. */
    setCursor(idx: number): void {
        this.idx = Math.max(-1, Math.min(idx, this.bars.length - 1));
    }

    info(): ProviderInfo {
        return {
            name: 'replay',
            displayName: 'Replay',
            supportedTimeframes: ['1', '5', '15', '30', '60', '240', 'D'],
            capabilities: { enumerate: true, stream: true, symbolInfo: false },
        };
    }

    listSymbols(): Promise<SymbolDescriptor[]> {
        return Promise.resolve(this.symbols);
    }

    getBars(_ticker: string, timeframe: string, range: BarRange): Promise<OHLCV[]> {
        const tf = this.effectiveMinutes(timeframe);
        let out = this.aggregated(tf).map(toOHLCV);
        if (range.from != null) out = out.filter((b) => b.time >= range.from!);
        if (range.to != null) out = out.filter((b) => b.time <= range.to!);
        if (range.limit != null && out.length > range.limit) out = out.slice(-range.limit);
        return Promise.resolve(out);
    }

    subscribe(_ticker: string, timeframe: string, onBar: OnBar): () => void {
        const key = String(this.effectiveMinutes(timeframe));
        let set = this.subs.get(key);
        if (!set) {
            set = new Set();
            this.subs.set(key, set);
        }
        set.add(onBar);
        return () => {
            set!.delete(onBar);
            if (set!.size === 0) this.subs.delete(key);
        };
    }

    /** Timeframes menores al nativo se sirven como el nativo (no hay datos más finos). */
    private effectiveMinutes(timeframe: string): number {
        return Math.max(this.nativeMinutes, timeframeToMinutes(timeframe));
    }

    private aggregated(tfMinutes: number): SimBar[] {
        if (this.idx < 0) return [];
        if (tfMinutes === this.nativeMinutes) return this.bars.slice(0, this.idx + 1);
        return aggregateBars(this.bars, this.idx, tfMinutes);
    }

    /** La vela agregada (en formación o recién abierta) que contiene la barra nativa del cursor. */
    private pushCurrent(): void {
        for (const [key, set] of this.subs) {
            const tf = +key;
            const bar = tf === this.nativeMinutes ? this.bars[this.idx]! : lastBucket(this.bars, this.idx, tf);
            const ohlcv = toOHLCV(bar);
            for (const cb of set) cb(ohlcv);
        }
    }
}

/** Solo la ÚLTIMA cubeta agregada (la que contiene `idx`), sin recorrer todo el historial. */
function lastBucket(bars: readonly SimBar[], idx: number, tfMinutes: number): SimBar {
    const isDaily = tfMinutes >= 1440;
    const keyOf = (b: SimBar): string => {
        if (isDaily) return b.day;
        const mins = b.t.getHours() * 60 + b.t.getMinutes();
        return `${b.day}_${Math.floor(mins / tfMinutes) * tfMinutes}`;
    };
    const key = keyOf(bars[idx]!);
    let start = idx;
    while (start > 0 && keyOf(bars[start - 1]!) === key) start--;
    return aggregateBars(bars.slice(start, idx + 1), idx - start, tfMinutes)[0]!;
}
