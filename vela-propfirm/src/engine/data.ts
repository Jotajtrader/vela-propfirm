// Port 1:1 de la sección "DATOS" + "MULTI-TIMEFRAME" del <script> de fondeo-sim (HTML v0.3).
// La semántica de hora es LOCAL del navegador, igual que el HTML (getHours/getMinutes).

export interface SimBar {
    t: Date;
    o: number;
    h: number;
    l: number;
    c: number;
    v: number;
    /** Día de trading 'YYYY-MM-DD' (ya corrido por el corte de jornada, no medianoche). */
    day: string;
}

export interface TradingDayCutoff {
    h: number;
    m: number;
}

export type Rng = () => number;

/** Valor de un punto por contrato, por instrumento. */
export const PV: Record<string, number> = { NQ: 20, MNQ: 2, GC: 100, MGC: 10 };

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** Día de trading de `d`: con corte configurado, todo lo que pasa a partir del corte cuenta como el día siguiente. */
export function fmtDay(d: Date, cut: TradingDayCutoff | null): string {
    const cutMin = cut ? cut.h * 60 + cut.m : 0;
    if (!cutMin) return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    const mins = d.getHours() * 60 + d.getMinutes();
    const shifted = new Date(d.getTime());
    if (mins >= cutMin) shifted.setDate(shifted.getDate() + 1);
    return `${shifted.getFullYear()}-${pad2(shifted.getMonth() + 1)}-${pad2(shifted.getDate())}`;
}

export function fmtTime(d: Date): string {
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** Resolución nativa (minutos) de un dataset: el delta más frecuente entre barras del mismo día. */
export function detectNativeMinutes(bars: readonly SimBar[]): number {
    const deltas: Record<number, number> = {};
    for (let i = 1; i < bars.length; i++) {
        if (bars[i]!.day !== bars[i - 1]!.day) continue;
        const d = Math.round((bars[i]!.t.getTime() - bars[i - 1]!.t.getTime()) / 60000);
        if (d > 0) deltas[d] = (deltas[d] ?? 0) + 1;
    }
    let best = 1;
    let bestCount = 0;
    for (const k in deltas) {
        if (deltas[k]! > bestCount) {
            bestCount = deltas[k]!;
            best = +k;
        }
    }
    return best || 1;
}

export function tfLabel(mins: number): string {
    if (mins >= 1440) return '1D';
    if (mins >= 60) return `${mins / 60}h`;
    return `${mins}m`;
}

/**
 * Reconstruye velas de un timeframe mayor a partir de las nativas, revelando solo hasta `uptoIdx`
 * (la última agregada queda "en formación" con lo revelado hasta ahora). Clave de cubeta igual al
 * HTML: día de trading + minuto-del-día local truncado al timeframe; diario = el día de trading.
 */
export function aggregateBars(nativeBars: readonly SimBar[], uptoIdx: number, tfMinutes: number): SimBar[] {
    if (tfMinutes <= 0 || uptoIdx < 0) return [];
    const isDaily = tfMinutes >= 1440;
    const out: SimBar[] = [];
    let cur: SimBar | null = null;
    let curKey: string | null = null;
    for (let idx = 0; idx <= uptoIdx; idx++) {
        const b = nativeBars[idx]!;
        let key: string;
        if (isDaily) key = b.day;
        else {
            const mins = b.t.getHours() * 60 + b.t.getMinutes();
            key = `${b.day}_${Math.floor(mins / tfMinutes) * tfMinutes}`;
        }
        if (key !== curKey) {
            if (cur) out.push(cur);
            cur = { t: new Date(b.t), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v || 0, day: b.day };
            curKey = key;
        } else {
            cur!.h = Math.max(cur!.h, b.h);
            cur!.l = Math.min(cur!.l, b.l);
            cur!.c = b.c;
            cur!.v = (cur!.v || 0) + (b.v || 0);
        }
    }
    if (cur) out.push(cur);
    return out;
}

export function r2(x: number): number {
    return Math.round(x * 4) / 4;
}

/**
 * Generador demo: 1 barra por minuto, el minuto se recorre en SUB sub-pasos para que el high/low
 * salga del recorrido real (no ruido sobre el cuerpo — eso daba un edge falso a TPs chicos).
 */
export function genSample(days = 6, barsPerDay = 180, cutoff: TradingDayCutoff | null = { h: 17, m: 0 }, rng: Rng = Math.random): SimBar[] {
    const bars: SimBar[] = [];
    let px = 20000;
    const start = new Date(2025, 0, 6, 9, 30, 0);
    const SUB = 60;
    for (let d = 0; d < days; d++) {
        const dayDate = new Date(start);
        dayDate.setDate(start.getDate() + d);
        let t = new Date(dayDate);
        t.setHours(9, 30, 0, 0);
        const drift = (rng() - 0.5) * 4;
        for (let b = 0; b < barsPerDay; b++) {
            const vol = 6 + rng() * 10;
            const step = vol / Math.sqrt(SUB);
            const o = px;
            let p = o;
            let h = o;
            let l = o;
            for (let s = 0; s < SUB; s++) {
                p += (rng() - 0.5) * step + (drift * 0.15) / SUB;
                if (p > h) h = p;
                if (p < l) l = p;
            }
            const c = p;
            bars.push({ t: new Date(t), o: r2(o), h: r2(h), l: r2(l), c: r2(c), v: Math.round(50 + rng() * 400), day: fmtDay(t, cutoff) });
            px = c;
            t = new Date(t.getTime() + 60000);
        }
    }
    return bars;
}

/** CSV `datetime,open,high,low,close[,volume]` — fecha+hora en 1 o 2 columnas, ISO, `YYYY-MM-DD HH:MM` o epoch. */
export function parseCSV(text: string, cutoff: TradingDayCutoff | null): SimBar[] {
    const lines = text.trim().split(/\r?\n/);
    let startLine = 0;
    const first = (lines[0] ?? '').toLowerCase();
    if (/date|time|open|close/.test(first)) startLine = 1;
    const out: SimBar[] = [];
    for (let i = startLine; i < lines.length; i++) {
        const parts = lines[i]!.split(/[,;\t]/).map((s) => s.trim());
        if (parts.length < 5) continue;
        let t: Date;
        let oi = 1;
        const p0 = parts[0]!;
        const p1 = parts[1]!;
        if (/[-/:]/.test(p0) && /[-/:]/.test(p1) && isNaN(Date.parse(p0))) {
            t = new Date(`${p0} ${p1}`.replace(/\./g, '-'));
            oi = 2;
        } else if (!isNaN(Date.parse(p0))) {
            t = new Date(p0);
        } else if (/^\d{10,13}$/.test(p0)) {
            t = new Date(parseInt(p0, 10) * (p0.length <= 10 ? 1000 : 1));
        } else continue;
        const o = +parts[oi]!;
        const h = +parts[oi + 1]!;
        const l = +parts[oi + 2]!;
        const c = +parts[oi + 3]!;
        const v = +(parts[oi + 4] ?? 0) || 0;
        if ([o, h, l, c].some(isNaN)) continue;
        out.push({ t, o, h, l, c, v, day: fmtDay(t, cutoff) });
    }
    out.sort((a, b) => a.t.getTime() - b.t.getTime());
    return out;
}

/** Re-etiqueta el `.day` de todas las barras con el corte vigente (cambiar el corte tras cargar datos). */
export function retagBarsWithCutoff(bars: SimBar[], cutoff: TradingDayCutoff | null): void {
    for (const b of bars) b.day = fmtDay(b.t, cutoff);
}
