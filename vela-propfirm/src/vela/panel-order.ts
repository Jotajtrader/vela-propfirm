// El panel de orden: Market/Limit/Stop + cantidad + SL/TP, editables a mano (precio o puntos) O
// arrastrando en el chart — acoplado a la derecha, como Trading Panel/Centro de control, NUNCA un
// modal (un modal bloqueaba el chart e impedía arrastrar). Usa la herramienta nativa de Vela
// "Long/Short Position" (`position`) como manija visual: el cuadro persiste en el chart aunque el
// usuario cambie de panel sin confirmar — reabrir esta pestaña retoma exactamente donde quedó.
// Vela no emite un evento continuo durante el arrastre (solo al soltar), así que sondeamos
// `chart.drawings.all()` en cada frame mientras el panel está VISIBLE para reflejar los precios.
import { registerIcon, registerSidePanel, type WidgetContext } from '@luxalgo/vela/plugin';
import type { SerializedDrawing } from '@luxalgo/vela';
import { NumberInput, Switch, svg16 } from '@luxalgo/vela/ui';
import type { Simulator } from '../engine/Simulator';
import type { OrderType, Side } from '../engine/types';
import { canTrade } from '../engine/trading';
import { timeframeToMinutes } from './ReplayProvider';
import { currentPendingOrder } from './order-request';
import { getSimulator } from './context';
import { btn, ensureStyles, h, labeled } from './ui';

export const ORDER_PANEL_ID = 'propfirm.order';

registerIcon('propfirm.order', svg16('<path d="M2.5 4.5h11v7h-11z"/><path d="M5 4.5V3.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1"/><path d="M5.5 8h2M5.5 10h5"/>'));

const DEFAULT_SL_PTS = 10;
const DEFAULT_TP_PTS = 20;
/** Ancho visual del cuadro (en barras del timeframe activo) — puramente estético, no afecta la orden. */
const BOX_WIDTH_BARS = 10;
const LEVEL_EPS = 1e-6;

interface PanelApi {
    startOrder(side: Side, qty: number): void;
    resumePoll(): void;
    dispose(): void;
}

function buildOrderPanel(ctx: WidgetContext, sim: Simulator, body: HTMLElement): PanelApi {
    ensureStyles(body.ownerDocument);
    let type: OrderType = 'market';
    let dirSide: Side = 1;
    let drawingId: string | null = null;
    let raf = 0;

    const heading = h('div', 'row');
    const headingLabel = h('span');
    headingLabel.style.cssText = 'font-size:15px;font-weight:700';
    heading.appendChild(headingLabel);
    const seg = h('div', 'pf-seg');
    const segBtns: Record<OrderType, HTMLButtonElement> = {
        market: btn('Market', () => setType('market'), 'on'),
        limit: btn('Limit', () => setType('limit')),
        stop: btn('Stop', () => setType('stop')),
    };
    seg.append(segBtns.market, segBtns.limit, segBtns.stop);

    const price = new NumberInput({ value: 0, step: 0.25, size: 'md', fill: true, commit: 'blur', steppers: false, onChange: (v) => writeDrawing({ entry: v }) });
    const priceRow = labeled('Precio de entrada', price.el);
    priceRow.hidden = true;
    const qtyIn = new NumberInput({ value: 1, min: 1, step: 1, integer: true, size: 'md', fill: true, commit: 'blur' });
    const slOn = new Switch({ size: 'sm', checked: true });
    const slVal = new NumberInput({ value: DEFAULT_SL_PTS, min: 0, step: 1, size: 'sm', fill: false, commit: 'blur', steppers: false, onChange: (v) => writeDrawing({ slPts: v }) });
    const tpOn = new Switch({ size: 'sm', checked: true });
    const tpVal = new NumberInput({ value: DEFAULT_TP_PTS, min: 0, step: 1, size: 'sm', fill: false, commit: 'blur', steppers: false, onChange: (v) => writeDrawing({ tpPts: v }) });
    slOn.el.addEventListener('click', () => (slVal.input.disabled = !slOn.checked));
    tpOn.el.addEventListener('click', () => (tpVal.input.disabled = !tpOn.checked));
    const toggRow = (sw: Switch, label: string, num: NumberInput): HTMLElement => {
        const r = h('div', 'pf-toggrow');
        r.append(sw.el, h('span', 'grow', label), num.el);
        return r;
    };
    const dragHint = h('div', 'hint', 'Arrastrá el cuadro en el chart para mover la entrada, el SL o el TP — como en TradingView. También podés escribir los valores acá.');
    const acctLbl = h('div', 'mini');
    const foot = h('div', 'row');
    foot.style.marginTop = '4px';
    const cancelBtn = btn('Cancelar', () => cancel());
    const confirmBtn = btn('Confirmar', () => confirm(), 'on');
    cancelBtn.style.flex = '1';
    confirmBtn.style.flex = '1';
    foot.append(cancelBtn, confirmBtn);
    const emptyState = h('div', 'hint', 'Usá los botones Comprar / Vender del chart (arriba a la izquierda) para armar una orden acá.');

    const form = h('div', 'col');
    form.append(heading, seg, priceRow, labeled('Cantidad', qtyIn.el), toggRow(slOn, 'Stop Loss (pts)', slVal), toggRow(tpOn, 'Take Profit (pts)', tpVal), dragHint, acctLbl, foot);
    form.hidden = true;
    body.append(form, emptyState);

    function setType(t: OrderType): void {
        type = t;
        for (const k of Object.keys(segBtns) as OrderType[]) segBtns[k].classList.toggle('on', k === t);
        priceRow.hidden = t === 'market';
    }

    function currentAnchors(): SerializedDrawing['anchors'] | null {
        if (!drawingId) return null;
        return ctx.chart.drawings.all().find((d) => d.id === drawingId)?.anchors ?? null;
    }

    function writeDrawing(patch: { entry?: number; slPts?: number; tpPts?: number }): void {
        if (!drawingId) return;
        const anchors = currentAnchors();
        if (!anchors) return;
        const entry = patch.entry ?? price.value;
        const sl = patch.slPts ?? slVal.value;
        const tp = patch.tpPts ?? tpVal.value;
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
        paintSide();
    }

    function paintSide(): void {
        const buying = dirSide > 0;
        headingLabel.textContent = buying ? '▲ Comprar' : '▼ Vender';
        headingLabel.style.color = buying ? 'var(--vela-up,#26a65b)' : 'var(--vela-down,#e0524f)';
    }

    function removeDrawing(): void {
        if (drawingId) ctx.chart.drawings.remove(drawingId);
        drawingId = null;
        lastSeen = null;
    }

    function tick(): void {
        syncFromDrawing();
        raf = body.offsetParent !== null ? requestAnimationFrame(tick) : 0;
    }
    function resumePoll(): void {
        if (!raf && drawingId) raf = requestAnimationFrame(tick);
    }

    function startOrder(side: Side, qty: number): void {
        removeDrawing();
        form.hidden = false;
        emptyState.hidden = true;
        dirSide = side;
        type = 'market';
        setType('market');
        qtyIn.setValue(Math.max(1, Math.trunc(qty) || 1));
        slOn.setChecked(true);
        slVal.setValue(DEFAULT_SL_PTS);
        slVal.input.disabled = false;
        tpOn.setChecked(true);
        tpVal.setValue(DEFAULT_TP_PTS);
        tpVal.input.disabled = false;
        paintSide();
        const acc = sim.activeAccount();
        const accStatus = acc?.status;
        acctLbl.textContent = acc ? `Cuenta: ${acc.name}${canTrade(acc) ? '' : `  ⚠ no operable (${accStatus})`}` : 'Sin cuenta seleccionada — elegí una en Trading Panel';
        const entryPx = sim.currentPrice();
        price.setValue(entryPx);
        const t0 = sim.currentTime();
        const t1 = t0 + timeframeToMinutes(ctx.timeframe) * 60_000 * BOX_WIDTH_BARS;
        const drawing = ctx.chart.drawings.add('position', {
            paneId: 'price',
            anchors: [
                { time: t0, price: entryPx },
                { time: t1, price: entryPx - side * DEFAULT_SL_PTS },
                { time: t1, price: entryPx + side * DEFAULT_TP_PTS },
            ],
        });
        drawingId = drawing?.id ?? null;
        lastSeen = `${entryPx}|${entryPx - side * DEFAULT_SL_PTS}|${entryPx + side * DEFAULT_TP_PTS}`;
        resumePoll();
    }

    function cancel(): void {
        removeDrawing();
        ctx.togglePanel(ORDER_PANEL_ID, false);
    }

    function confirm(): void {
        const q = Math.max(1, Math.trunc(qtyIn.value) || 1);
        const slV = slOn.checked ? slVal.value : null;
        const tpV = tpOn.checked ? tpVal.value : null;
        if (slOn.checked && !(Number.isFinite(slV) && slV! > 0)) return void ctx.toast('Ingresá un valor de Stop Loss en puntos.', 'error');
        if (tpOn.checked && !(Number.isFinite(tpV) && tpV! > 0)) return void ctx.toast('Ingresá un valor de Take Profit en puntos.', 'error');
        let ok: boolean;
        if (type === 'market') ok = sim.openPosition(dirSide, q, slV, tpV);
        else {
            const p = price.value;
            if (!Number.isFinite(p)) return void ctx.toast('Ingresá el precio de la orden.', 'error');
            ok = sim.placeOrder(dirSide, type, p, q, slV, tpV);
        }
        if (ok) {
            removeDrawing();
            ctx.togglePanel(ORDER_PANEL_ID, false);
        }
    }

    return {
        startOrder,
        resumePoll,
        dispose: () => {
            cancelAnimationFrame(raf);
        },
    };
}

registerSidePanel({
    id: ORDER_PANEL_ID,
    title: 'Orden',
    icon: 'propfirm.order',
    order: 32,
    width: 320,
    resizable: true,
    minWidth: 280,
    maxWidth: 480,
    mount: (ctx, body) => {
        const sim = getSimulator();
        if (!sim) {
            body.appendChild(h('div', 'pf hint', 'No hay un simulador conectado (createPropFirm + attach).'));
            return {};
        }
        ensureStyles(body.ownerDocument);
        const wrap = h('div', 'pf');
        wrap.style.padding = '12px';
        body.appendChild(wrap);
        let api: PanelApi | null = null;
        let appliedNonce = -1;
        return {
            onOpen: () => {
                api ??= buildOrderPanel(ctx, sim, wrap);
                const p = currentPendingOrder();
                if (p && p.nonce !== appliedNonce) {
                    appliedNonce = p.nonce;
                    api.startOrder(p.side, p.qty);
                } else {
                    api.resumePoll();
                }
            },
            destroy: () => api?.dispose(),
        };
    },
});
