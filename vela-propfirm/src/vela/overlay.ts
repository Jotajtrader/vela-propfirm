// La capa "chrome del host" sobre el precio: posición de la cuenta seleccionada (entrada/SL/TP),
// órdenes de trabajo, los precios a los que la cuenta se quema (DD) o se pausa (DLL) con la
// posición abierta, y las marcas de los trades cerrados. Es lo que el `drawChart()` del HTML pintaba
// sobre sus velas, ahora como renderer layer de Vela poseída por un indicador nativo SIN leyenda.
import {
    registerNativeIndicator,
    registerRendererLayer,
    type NativeIndicator,
    type NativeIndicatorContext,
    type RendererLayerArgs,
    type RendererLayerInstance,
} from '@luxalgo/vela/plugin';
import type { Side, SimState } from '../engine/types';
import { rulesFor, thresholdOf, tplOf } from '../engine/rules';
import { activeAcct, pv } from '../engine/trading';
import { money } from '../engine/format';

export const OVERLAY_ID = 'propfirm.overlay';

export interface OverlayPayload {
    accountName: string | null;
    position: { side: Side; qty: number; entry: number; entryTime: number; sl: number | null; tp: number | null; upnl: number } | null;
    orders: { side: Side; type: 'limit' | 'stop'; px: number; qty: number }[];
    /** Precio al que la posición abierta viola el drawdown máximo (null sin posición). */
    ddPrice: number | null;
    /** Precio al que la posición abierta toca el límite diario (null sin DLL o sin posición). */
    dailyPrice: number | null;
    trades: { side: Side; entryTime: number; exitTime: number; entry: number; exit: number; pnl: number }[];
}

/** Proyecta el estado del simulador a lo que la capa pinta — solo la cuenta seleccionada. */
export function buildOverlay(state: SimState): OverlayPayload {
    const acc = activeAcct(state);
    if (!acc) return { accountName: null, position: null, orders: [], ddPrice: null, dailyPrice: null, trades: [] };
    const cur = state.bars[state.idx];
    const px = cur ? cur.c : 0;
    const p = acc.position;
    let position: OverlayPayload['position'] = null;
    let ddPrice: number | null = null;
    let dailyPrice: number | null = null;
    if (p) {
        const entryBar = state.bars[p.entryIdx];
        position = {
            side: p.side,
            qty: p.qty,
            entry: p.entry,
            entryTime: entryBar ? entryBar.t.getTime() : cur ? cur.t.getTime() : 0,
            sl: p.sl,
            tp: p.tp,
            upnl: (px - p.entry) * p.side * p.qty * pv(state),
        };
        const rules = rulesFor(acc, tplOf(state, acc));
        if (rules) {
            const denom = p.side * p.qty * pv(state);
            const dd = p.entry + (thresholdOf(acc, rules) - acc.balance) / denom;
            if (Number.isFinite(dd)) ddPrice = dd;
            if (rules.dailyLoss > 0) {
                const daily = p.entry + (-rules.dailyLoss - acc.dailyPnl) / denom;
                if (Number.isFinite(daily)) dailyPrice = daily;
            }
        }
    }
    return {
        accountName: acc.name,
        position,
        orders: state.orders.filter((o) => o.accId === acc.id).map((o) => ({ side: o.side, type: o.type, px: o.px, qty: o.qty })),
        ddPrice,
        dailyPrice,
        trades: acc.tradeLog
            .filter((t) => t.entryTime && t.exitTime)
            .map((t) => ({ side: t.side, entryTime: Date.parse(t.entryTime!), exitTime: Date.parse(t.exitTime!), entry: t.entry, exit: t.exit, pnl: t.pnl })),
    };
}

// ── indicador nativo (dueño de la capa; sin leyenda: el on/off vive en el panel del host) ──
let current: OverlayPayload | null = null;
const live = new Set<OverlayIndicator>();

class OverlayIndicator implements NativeIndicator {
    private ctx: NativeIndicatorContext | null = null;
    start(ctx: NativeIndicatorContext): void {
        this.ctx = ctx;
        live.add(this);
        ctx.emit({}); // monta el modelo vacío: la capa pinta por fuera del modelo
        ctx.pushData(current);
    }
    push(): void {
        this.ctx?.pushData(current);
    }
    onBars(): void {
        this.push();
    }
    onViewport(): void {}
    setInputs(): void {}
    suspend(): void {}
    resume(): void {
        this.push();
    }
    stop(): void {
        live.delete(this);
        this.ctx = null;
    }
}

/** Publica un payload nuevo a todos los charts que tengan el overlay montado. */
export function pushOverlay(payload: OverlayPayload | null): void {
    current = payload;
    for (const i of live) i.push();
}

export function currentOverlay(): OverlayPayload | null {
    return current;
}

registerNativeIndicator({
    type: OVERLAY_ID,
    title: 'Prop firm — posición y niveles',
    shortTitle: 'Prop firm',
    paneHint: 'price',
    overlay: true,
    legend: false,
    inputsSchema: () => [],
    defaultInputs: () => ({}),
    create: () => new OverlayIndicator(),
});

// ── la capa ─────────────────────────────────────────────────────────────────────────────
const AMBER = '#e0a53f';
const DANGER = '#e0524f';
const MUTED_ALPHA = 0.85;

class OverlayLayer implements RendererLayerInstance {
    private canvas: HTMLCanvasElement | null = null;
    private ctx: CanvasRenderingContext2D | null = null;

    mount(canvas: HTMLCanvasElement): void {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
    }

    destroy(): void {
        this.canvas = null;
        this.ctx = null;
    }

    render(args: RendererLayerArgs): void {
        const ctx = this.ctx;
        const canvas = this.canvas;
        if (!ctx || !canvas) return;
        const { coords, scale, bounds, theme } = args;
        const data = args.data as OverlayPayload | null | undefined;
        const dpr = coords.dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
        if (!data || bounds.height <= 0 || args.bars.length === 0) return;

        const W = coords.width;
        const y = (p: number): number => coords.priceToY(p, scale, bounds);
        const x = (t: number): number => coords.timeToX(t);
        const font = `11px ${theme.fontFamily}`;
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, bounds.top, W, bounds.height);
        ctx.clip();
        ctx.font = font;
        ctx.lineWidth = 1;

        const hline = (price: number, color: string, dash: number[], label: string, side: 'left' | 'right'): void => {
            const yy = Math.round(y(price)) + 0.5;
            if (yy < bounds.top - 8 || yy > bounds.top + bounds.height + 8) return;
            ctx.strokeStyle = color;
            ctx.setLineDash(dash);
            ctx.beginPath();
            ctx.moveTo(0, yy);
            ctx.lineTo(W, yy);
            ctx.stroke();
            ctx.setLineDash([]);
            const tw = ctx.measureText(label).width;
            const lx = side === 'left' ? 8 : W - tw - 8;
            ctx.globalAlpha = MUTED_ALPHA;
            ctx.fillStyle = theme.background;
            ctx.fillRect(lx - 4, yy - 14, tw + 8, 14);
            ctx.globalAlpha = 1;
            ctx.fillStyle = color;
            ctx.fillText(label, lx, yy - 3);
        };

        // trades cerrados: entrada ▲/▼, salida ■, unidos por una línea fina coloreada por el resultado
        for (const t of data.trades) {
            const x0 = x(t.entryTime);
            const x1 = x(t.exitTime);
            if (x1 < 0 || x0 > W) continue;
            const y0 = y(t.entry);
            const y1 = y(t.exit);
            ctx.strokeStyle = t.pnl >= 0 ? theme.upColor : theme.downColor;
            ctx.globalAlpha = 0.6;
            ctx.beginPath();
            ctx.moveTo(x0, y0);
            ctx.lineTo(x1, y1);
            ctx.stroke();
            ctx.globalAlpha = 1;
            ctx.fillStyle = t.side > 0 ? theme.upColor : theme.downColor;
            ctx.beginPath();
            if (t.side > 0) {
                ctx.moveTo(x0, y0 + 9);
                ctx.lineTo(x0 - 5, y0 + 17);
                ctx.lineTo(x0 + 5, y0 + 17);
            } else {
                ctx.moveTo(x0, y0 - 9);
                ctx.lineTo(x0 - 5, y0 - 17);
                ctx.lineTo(x0 + 5, y0 - 17);
            }
            ctx.closePath();
            ctx.fill();
            ctx.fillStyle = t.pnl >= 0 ? theme.upColor : theme.downColor;
            ctx.fillRect(x1 - 3.5, y1 - 3.5, 7, 7);
        }

        // órdenes de trabajo
        for (const o of data.orders) {
            hline(o.px, AMBER, [1, 3], `${o.side > 0 ? 'B' : 'S'} ${o.type.toUpperCase()} ${o.qty} @ ${o.px.toFixed(2)}`, 'left');
        }

        // posición abierta: entrada / SL / TP / niveles de cuenta
        const p = data.position;
        if (p) {
            const color = p.side > 0 ? theme.upColor : theme.downColor;
            const upnl = `${p.upnl >= 0 ? '+' : ''}${money(p.upnl)}`;
            hline(p.entry, color, [6, 3], `${p.side > 0 ? 'LONG' : 'SHORT'} ${p.qty} @ ${p.entry.toFixed(2)} · ${upnl}`, 'left');
            if (p.sl != null) hline(p.sl, theme.downColor, [2, 2], 'SL', 'right');
            if (p.tp != null) hline(p.tp, theme.upColor, [2, 2], 'TP', 'right');
            if (data.ddPrice != null) hline(data.ddPrice, DANGER, [1, 4], 'DD máx (quema)', 'right');
            if (data.dailyPrice != null) hline(data.dailyPrice, AMBER, [1, 4], 'Límite diario (pausa)', 'right');
            // marcador de la entrada en curso
            const ex = x(p.entryTime);
            const ey = y(p.entry);
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(ex, ey, 4, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }
}

registerRendererLayer({ id: OVERLAY_ID, placement: 'above-data', create: () => new OverlayLayer() });
