// El panel de orden: Market/Limit/Stop + cantidad + SL/TP, editables a mano (precio o puntos) O
// arrastrando en el chart — usa la herramienta nativa de Vela "Long/Short Position" (`position`)
// como manija visual: creamos el cuadro con sus 3 niveles (entrada/stop/target), el usuario lo
// arrastra como en TradingView, y sondeamos `chart.drawings.all()` en cada frame mientras el
// diálogo está abierto para reflejar los precios en los campos (Vela no emite un evento continuo
// durante el arrastre — solo al soltar — así que el sondeo es la única vía para un feedback fluido).
import type { WidgetContext } from '@luxalgo/vela/plugin';
import type { SerializedDrawing } from '@luxalgo/vela';
import { Dialog, NumberInput, Switch } from '@luxalgo/vela/ui';
import type { Simulator } from '../../engine/Simulator';
import type { OrderType, Side } from '../../engine/types';
import { canTrade } from '../../engine/trading';
import { timeframeToMinutes } from '../ReplayProvider';
import { btn, ensureStyles, h, labeled } from '../ui';

const DEFAULT_SL_PTS = 10;
const DEFAULT_TP_PTS = 20;
/** Ancho visual del cuadro (en barras del timeframe activo) — puramente estético, no afecta la orden. */
const BOX_WIDTH_BARS = 10;

const LEVEL_EPS = 1e-6;

export function openOrderDialog(ctx: WidgetContext, sim: Simulator, side: Side, defaultQty: number): void {
    ensureStyles(ctx.host.ownerDocument);
    let type: OrderType = 'market';
    let dirSide: Side = side; // puede invertirse si el usuario arrastra el target al otro lado de la entrada
    const acc = sim.activeAccount();

    // ── el cuadro en el chart ────────────────────────────────────────────────────────────
    const entryPx = sim.currentPrice();
    const slPts0 = DEFAULT_SL_PTS;
    const tpPts0 = DEFAULT_TP_PTS;
    const t0 = sim.currentTime();
    const t1 = t0 + timeframeToMinutes(ctx.timeframe) * 60_000 * BOX_WIDTH_BARS;
    const drawing = ctx.chart.drawings.add('position', {
        paneId: 'price',
        anchors: [
            { time: t0, price: entryPx },
            { time: t1, price: entryPx - dirSide * slPts0 },
            { time: t1, price: entryPx + dirSide * tpPts0 },
        ],
    });
    const drawingId = drawing?.id ?? null;
    const removeDrawing = (): void => {
        if (drawingId) ctx.chart.drawings.remove(drawingId);
    };

    const body = h('div', 'pf body');
    const seg = h('div', 'pf-seg');
    const segBtns: Record<OrderType, HTMLButtonElement> = {
        market: btn('Market', () => setType('market'), 'on'),
        limit: btn('Limit', () => setType('limit')),
        stop: btn('Stop', () => setType('stop')),
    };
    seg.append(segBtns.market, segBtns.limit, segBtns.stop);

    const price = new NumberInput({ value: entryPx, step: 0.25, size: 'md', fill: true, commit: 'blur', steppers: false, onChange: (v) => writeDrawing({ entry: v }) });
    const priceRow = labeled('Precio de entrada', price.el);
    priceRow.hidden = true;
    const qty = new NumberInput({ value: defaultQty, min: 1, step: 1, integer: true, size: 'md', fill: true, commit: 'blur' });
    const slOn = new Switch({ size: 'sm', checked: true });
    const slVal = new NumberInput({ value: slPts0, min: 0, step: 1, size: 'sm', fill: false, commit: 'blur', steppers: false, onChange: (v) => writeDrawing({ slPts: v }) });
    const tpOn = new Switch({ size: 'sm', checked: true });
    const tpVal = new NumberInput({ value: tpPts0, min: 0, step: 1, size: 'sm', fill: false, commit: 'blur', steppers: false, onChange: (v) => writeDrawing({ tpPts: v }) });
    slOn.el.addEventListener('click', () => (slVal.input.disabled = !slOn.checked));
    tpOn.el.addEventListener('click', () => (tpVal.input.disabled = !tpOn.checked));

    const toggRow = (sw: Switch, label: string, num: NumberInput): HTMLElement => {
        const r = h('div', 'pf-toggrow');
        r.append(sw.el, h('span', 'grow', label), num.el);
        return r;
    };
    const dragHint = h('div', 'hint', drawingId ? 'También podés arrastrar el cuadro en el chart — entrada, SL y TP.' : '');
    const acctLbl = h('div', 'mini');
    const status = acc?.status;
    acctLbl.textContent = acc ? `Cuenta: ${acc.name}${canTrade(acc) ? '' : `  ⚠ no operable (${status})`}` : 'Sin cuenta seleccionada — elegí una en el panel';
    body.append(seg, priceRow, labeled('Cantidad', qty.el), toggRow(slOn, 'Stop Loss (pts)', slVal), toggRow(tpOn, 'Take Profit (pts)', tpVal), dragHint, acctLbl);

    function setType(t: OrderType): void {
        type = t;
        for (const k of Object.keys(segBtns) as OrderType[]) segBtns[k].classList.toggle('on', k === t);
        priceRow.hidden = t === 'market';
    }

    /** Campo → dibujo: recalcula los 3 anchors desde los valores actuales de los campos. */
    function writeDrawing(patch: { entry?: number; slPts?: number; tpPts?: number }): void {
        if (!drawingId) return;
        const entry = patch.entry ?? price.value;
        const sl = patch.slPts ?? slVal.value;
        const tp = patch.tpPts ?? tpVal.value;
        const anchors = currentAnchors();
        if (!anchors) return;
        const et = anchors[0]!.time;
        const lt = anchors[1]!.time;
        ctx.chart.drawings.update(drawingId, {
            anchors: [
                { time: et, price: entry },
                { time: lt, price: entry - dirSide * sl },
                { time: lt, price: entry + dirSide * tp },
            ],
        });
    }

    function currentAnchors(): SerializedDrawing['anchors'] | null {
        if (!drawingId) return null;
        return ctx.chart.drawings.all().find((d) => d.id === drawingId)?.anchors ?? null;
    }

    /** Dibujo → campos: sondeado en cada frame mientras el diálogo está abierto. */
    let lastSeen: string | null = null;
    function syncFromDrawing(): void {
        const anchors = currentAnchors();
        if (!anchors || anchors.length < 3) return;
        const entry = anchors[0]!.price;
        const stop = anchors[1]!.price;
        const target = anchors[2]!.price;
        const key = `${entry}|${stop}|${target}`;
        if (key === lastSeen) return;
        lastSeen = key;
        dirSide = target >= entry ? 1 : -1;
        const sl = Math.abs(entry - stop);
        const tp = Math.abs(target - entry);
        if (Math.abs(price.value - entry) > LEVEL_EPS) price.setValue(entry);
        if (Math.abs(slVal.value - sl) > LEVEL_EPS) slVal.setValue(sl);
        if (Math.abs(tpVal.value - tp) > LEVEL_EPS) tpVal.setValue(tp);
        const buying = dirSide > 0;
        dialog.titleEl.textContent = buying ? 'Comprar' : 'Vender';
        dialog.titleEl.style.color = buying ? 'var(--vela-up,#26a65b)' : 'var(--vela-down,#e0524f)';
    }
    let raf = 0;
    const poll = (): void => {
        syncFromDrawing();
        raf = requestAnimationFrame(poll);
    };

    const dialog = new Dialog({
        title: side > 0 ? 'Comprar' : 'Vender',
        host: ctx.host,
        closeOnInteractOutside: true,
        className: 'pf-dialog',
        content: (el) => el.appendChild(body),
        footer: (el) => {
            el.className += ' pf-foot';
            el.append(
                btn('Cancelar', () => dialog.hide()),
                btn(
                    'Confirmar',
                    () => {
                        const q = Math.max(1, Math.trunc(qty.value) || 1);
                        const slV = slOn.checked ? slVal.value : null;
                        const tpV = tpOn.checked ? tpVal.value : null;
                        if (slOn.checked && !(Number.isFinite(slV) && slV! > 0)) return ctx.toast('Ingresá un valor de Stop Loss en puntos.', 'error');
                        if (tpOn.checked && !(Number.isFinite(tpV) && tpV! > 0)) return ctx.toast('Ingresá un valor de Take Profit en puntos.', 'error');
                        let ok: boolean;
                        if (type === 'market') ok = sim.openPosition(dirSide, q, slV, tpV);
                        else {
                            const p = price.value;
                            if (!Number.isFinite(p)) return ctx.toast('Ingresá el precio de la orden.', 'error');
                            ok = sim.placeOrder(dirSide, type, p, q, slV, tpV);
                        }
                        if (ok) dialog.hide();
                    },
                    'on',
                ),
            );
        },
        onOpenChange: (open) => {
            if (!open) {
                cancelAnimationFrame(raf);
                removeDrawing();
                setTimeout(() => dialog.destroy(), 0);
            }
        },
    });
    dialog.titleEl.style.color = side > 0 ? 'var(--vela-up,#26a65b)' : 'var(--vela-down,#e0524f)';
    dialog.show();
    if (drawingId) raf = requestAnimationFrame(poll);
}
