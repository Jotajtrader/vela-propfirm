// El panel de orden: Market/Limit/Stop + cantidad + SL/TP (en puntos o en $), editables a mano O
// arrastrando en el chart — acoplado a la derecha, como Trading Panel/Centro de control, NUNCA un
// modal. También atiende los pedidos de AJUSTE: arrastrar el SL/TP de una posición YA ABIERTA
// (position-adjust.ts) abre este mismo panel en modo confirmación ("¿Seguro que querés mover…?").
// Usa la herramienta nativa de Vela "Long/Short Position" (`position`) como manija visual para la
// orden nueva: el cuadro persiste en el chart aunque el usuario cambie de panel sin confirmar —
// reabrir esta pestaña retoma exactamente donde quedó. Vela no emite un evento continuo durante el
// arrastre (solo al soltar), así que sondeamos `chart.drawings.all()` en cada frame mientras el
// panel está VISIBLE para reflejar los precios y, en Market, mantener la entrada clavada al precio
// actual (el usuario puede arrastrar SL/TP; la entrada se re-clava sola cada frame).
import { registerIcon, registerSidePanel, type WidgetContext } from '@luxalgo/vela/plugin';
import type { SerializedDrawing } from '@luxalgo/vela';
import { NumberInput, Switch, svg16 } from '@luxalgo/vela/ui';
import type { Simulator } from '../engine/Simulator';
import type { OrderType, Side } from '../engine/types';
import { canTrade } from '../engine/trading';
import { timeframeToMinutes } from './ReplayProvider';
import { currentPendingRequest, type PendingRequest } from './order-request';
import { pushDraftOverlay } from './overlay';
import { getSimulator } from './context';
import { btn, ensureStyles, h, labeled } from './ui';
import { pointsUsdField, type PointsUsdField } from './fields';

export const ORDER_PANEL_ID = 'propfirm.order';

registerIcon('propfirm.order', svg16('<path d="M2.5 4.5h11v7h-11z"/><path d="M5 4.5V3.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1"/><path d="M5.5 8h2M5.5 10h5"/>'));

const DEFAULT_SL_PTS = 10;
const DEFAULT_TP_PTS = 20;
// Ancho del cuadro (en barras del timeframe activo) — el hit-test real de Vela solo agarra unos
// pocos px alrededor de CADA anchor (no la línea entera), así que un cuadro grande no ayuda a
// arrastrar: solo aleja el handle del SL/TP de donde el usuario mira. Chico y predecible (el ícono
// de arrastre se pinta justo ahí — ver overlay.ts).
const BOX_WIDTH_BARS = 4;
const LEVEL_EPS = 1e-6;

interface PanelApi {
    apply(req: PendingRequest): void;
    resumePoll(): void;
    dispose(): void;
}

function buildOrderPanel(ctx: WidgetContext, sim: Simulator, body: HTMLElement): PanelApi {
    ensureStyles(body.ownerDocument);
    let type: OrderType = 'market';
    let dirSide: Side = 1;
    let drawingId: string | null = null;
    let raf = 0;

    // ── formulario de orden nueva ──────────────────────────────────────────────────────
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
    const marketHint = h('div', 'mini', '🔒 Entrada clavada al precio de mercado actual.');
    marketHint.style.color = 'var(--vela-fg-muted)';
    const qtyIn = new NumberInput({ value: 1, min: 1, step: 1, integer: true, size: 'md', fill: true, commit: 'blur', onChange: () => { slField.refreshConversion(); tpField.refreshConversion(); } });
    const slOn = new Switch({ size: 'sm', checked: true });
    const slField: PointsUsdField = pointsUsdField({ points: DEFAULT_SL_PTS, qty: () => qtyIn.value, pointValue: () => sim.pointValue(), onChange: (pts) => writeDrawing({ slPts: pts }) });
    const tpOn = new Switch({ size: 'sm', checked: true });
    const tpField: PointsUsdField = pointsUsdField({ points: DEFAULT_TP_PTS, qty: () => qtyIn.value, pointValue: () => sim.pointValue(), onChange: (pts) => writeDrawing({ tpPts: pts }) });
    slOn.el.addEventListener('click', () => slField.setDisabled(!slOn.checked));
    tpOn.el.addEventListener('click', () => tpField.setDisabled(!tpOn.checked));
    const toggRow = (sw: Switch, label: string, f: PointsUsdField): HTMLElement => {
        const r = h('div', 'pf-toggrow');
        r.append(sw.el, h('span', 'grow', label), f.el);
        return r;
    };
    const dragHint = h('div', 'hint', 'Arrastrá el cuadro en el chart para mover el SL/TP (y la entrada, si es Limit o Stop) — como en TradingView. También podés escribir los valores acá.');
    const acctLbl = h('div', 'mini');
    const foot = h('div', 'row');
    foot.style.marginTop = '4px';
    const cancelBtn = btn('Cancelar', () => cancelNew());
    const confirmBtn = btn('Confirmar', () => confirmNew(), 'on');
    cancelBtn.style.flex = '1';
    confirmBtn.style.flex = '1';
    foot.append(cancelBtn, confirmBtn);

    const form = h('div', 'col');
    form.append(heading, seg, priceRow, marketHint, labeled('Cantidad', qtyIn.el), toggRow(slOn, 'Stop Loss', slField), toggRow(tpOn, 'Take Profit', tpField), dragHint, acctLbl, foot);

    // ── confirmación de ajuste (posición ya abierta) ───────────────────────────────────
    const adjustMsg = h('div');
    adjustMsg.style.fontSize = '13px';
    const adjustFoot = h('div', 'row');
    const adjustNo = btn('No', () => cancelAdjust());
    const adjustYes = btn('Sí, mover', () => confirmAdjust(), 'on');
    adjustNo.style.flex = '1';
    adjustYes.style.flex = '1';
    adjustFoot.append(adjustNo, adjustYes);
    const adjustPane = h('div', 'col');
    adjustPane.append(adjustMsg, adjustFoot);

    const emptyState = h('div', 'hint', 'Usá los botones Comprar / Vender del chart (arriba a la izquierda) para armar una orden acá.');

    form.hidden = true;
    adjustPane.hidden = true;
    body.append(form, adjustPane, emptyState);

    let pendingAdjust: { field: 'sl' | 'tp'; price: number } | null = null;

    function setType(t: OrderType): void {
        type = t;
        for (const k of Object.keys(segBtns) as OrderType[]) segBtns[k].classList.toggle('on', k === t);
        priceRow.hidden = t === 'market';
        marketHint.hidden = t !== 'market';
        // El tipo no mueve ningún anchor (mismo precio), así que sin esto la etiqueta y el ícono de
        // arrastre de la entrada quedaban con el rótulo/estado del tipo anterior hasta el próximo
        // drag o cambio de precio.
        if (drawingId) publishDraft(price.value, slField.getPoints(), tpField.getPoints());
    }

    function currentAnchors(): SerializedDrawing['anchors'] | null {
        if (!drawingId) return null;
        return ctx.chart.drawings.all().find((d) => d.id === drawingId)?.anchors ?? null;
    }

    function publishDraft(entry: number, sl: number, tp: number): void {
        const anchors = currentAnchors();
        const entryTime = anchors?.[0]?.time ?? sim.currentTime();
        const levelTime = anchors?.[1]?.time ?? entryTime;
        pushDraftOverlay({ side: dirSide, entry, sl: slOn.checked ? entry - dirSide * sl : null, tp: tpOn.checked ? entry + dirSide * tp : null, type, entryTime, levelTime });
    }

    function writeDrawing(patch: { entry?: number; slPts?: number; tpPts?: number }): void {
        if (!drawingId) return;
        const anchors = currentAnchors();
        if (!anchors) return;
        const entry = patch.entry ?? price.value;
        const sl = patch.slPts ?? slField.getPoints();
        const tp = patch.tpPts ?? tpField.getPoints();
        const et = anchors[0]!.time;
        const lt = anchors[1]!.time;
        ctx.chart.drawings.update(drawingId, {
            anchors: [
                { time: et, price: entry },
                { time: lt, price: entry - dirSide * sl },
                { time: lt, price: entry + dirSide * tp },
            ],
        });
        publishDraft(entry, sl, tp);
    }

    let lastSeen: string | null = null;
    function syncFromDrawing(): void {
        const anchors = currentAnchors();
        if (!anchors || anchors.length < 3) return;
        const entry = anchors[0]!.price;
        const stop = anchors[1]!.price;
        const target = anchors[2]!.price;
        const key = `${entry}|${stop}|${target}`;
        if (key !== lastSeen) {
            lastSeen = key;
            dirSide = target >= entry ? 1 : -1;
            const sl = Math.abs(entry - stop);
            const tp = Math.abs(target - entry);
            if (Math.abs(price.value - entry) > LEVEL_EPS) price.setValue(entry);
            if (Math.abs(slField.getPoints() - sl) > LEVEL_EPS) slField.setPoints(sl);
            if (Math.abs(tpField.getPoints() - tp) > LEVEL_EPS) tpField.setPoints(tp);
            paintSide();
            publishDraft(entry, sl, tp);
        }
        // Market: la entrada queda clavada al precio actual — se corrige SOLO el anchor de
        // entrada (nunca el de stop/target) para no pisar un arrastre de SL/TP en curso.
        if (type === 'market') {
            const fresh = sim.currentPrice();
            if (Math.abs(anchors[0]!.price - fresh) > LEVEL_EPS && drawingId) {
                ctx.chart.drawings.update(drawingId, { anchors: [{ time: anchors[0]!.time, price: fresh }, anchors[1]!, anchors[2]!] });
                lastSeen = null; // fuerza releer en el próximo tick (la entrada acaba de moverse)
            }
        }
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
        pushDraftOverlay(null);
    }

    // Vela no avisa cuándo se cierra el panel (ni por la X nativa ni al abrir otro panel) — no hay
    // onClose en SidePanelHandle. Se detecta acá, sondeando junto con el resto: si se oculta con
    // una orden nueva sin confirmar o un ajuste sin responder, se trata como Cancelar/No en vez de
    // dejar el dibujo huérfano en el chart (antes solo pasaba al tocar nuestro botón Cancelar).
    function abandon(): void {
        if (drawingId) {
            removeDrawing();
            showEmpty();
        } else if (pendingAdjust) {
            pendingAdjust = null;
            showEmpty();
        }
    }
    function tick(): void {
        if (drawingId) syncFromDrawing();
        if (body.offsetParent !== null) {
            raf = requestAnimationFrame(tick);
        } else {
            raf = 0;
            abandon();
        }
    }
    function resumePoll(): void {
        if (!raf && (drawingId || pendingAdjust)) raf = requestAnimationFrame(tick);
    }

    function showForm(): void {
        form.hidden = false;
        adjustPane.hidden = true;
        emptyState.hidden = true;
    }
    function showAdjust(): void {
        form.hidden = true;
        adjustPane.hidden = false;
        emptyState.hidden = true;
    }
    function showEmpty(): void {
        form.hidden = true;
        adjustPane.hidden = true;
        emptyState.hidden = false;
    }

    function startNewOrder(side: Side, qty: number): void {
        removeDrawing();
        showForm();
        dirSide = side;
        type = 'market';
        setType('market');
        qtyIn.setValue(Math.max(1, Math.trunc(qty) || 1));
        slOn.setChecked(true);
        slField.setPoints(DEFAULT_SL_PTS);
        slField.setDisabled(false);
        tpOn.setChecked(true);
        tpField.setPoints(DEFAULT_TP_PTS);
        tpField.setDisabled(false);
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
            // Las etiquetas propias del cuadro (header/%/precio) se apagan: las nuestras (hline con
            // nombre + precio en el eje, en overlay.ts) son las que se ven — evita el doble rótulo.
            props: { showHeader: false, showTargetLabel: false, showStopLabel: false, showLossSize: false, showPrices: false },
        });
        drawingId = drawing?.id ?? null;
        lastSeen = `${entryPx}|${entryPx - side * DEFAULT_SL_PTS}|${entryPx + side * DEFAULT_TP_PTS}`;
        publishDraft(entryPx, DEFAULT_SL_PTS, DEFAULT_TP_PTS);
        resumePoll();
    }

    function cancelNew(): void {
        removeDrawing();
        ctx.togglePanel(ORDER_PANEL_ID, false);
    }

    function confirmNew(): void {
        const q = Math.max(1, Math.trunc(qtyIn.value) || 1);
        const slV = slOn.checked ? slField.getPoints() : null;
        const tpV = tpOn.checked ? tpField.getPoints() : null;
        if (slOn.checked && !(Number.isFinite(slV) && slV! > 0)) return void ctx.toast('Ingresá un valor de Stop Loss.', 'error');
        if (tpOn.checked && !(Number.isFinite(tpV) && tpV! > 0)) return void ctx.toast('Ingresá un valor de Take Profit.', 'error');
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

    function startAdjust(field: 'sl' | 'tp', newPrice: number): void {
        pendingAdjust = { field, price: newPrice };
        showAdjust();
        const label = field === 'sl' ? 'Stop Loss' : 'Take Profit';
        adjustMsg.textContent = `¿Estás seguro de que querés mover el ${label} a ${newPrice.toFixed(2)}?`;
        resumePoll();
    }
    function cancelAdjust(): void {
        pendingAdjust = null;
        ctx.togglePanel(ORDER_PANEL_ID, false);
    }
    function confirmAdjust(): void {
        if (!pendingAdjust) return;
        sim.updatePositionLevels(pendingAdjust.field === 'sl' ? { sl: pendingAdjust.price } : { tp: pendingAdjust.price });
        pendingAdjust = null;
        ctx.togglePanel(ORDER_PANEL_ID, false);
    }

    function apply(req: PendingRequest): void {
        if (req.kind === 'new') startNewOrder(req.side, req.qty);
        else startAdjust(req.field, req.price);
    }

    if (!currentPendingRequest()) showEmpty();

    return {
        apply,
        resumePoll,
        // Al cerrar por la X nativa, Vela desmonta el panel (destroy) YA — no llega a haber un
        // próximo frame donde tick() note body.offsetParent===null, así que abandon() se llama acá
        // también (además de en tick(), por si el cierre alguna vez no pasa por destroy).
        dispose: () => {
            cancelAnimationFrame(raf);
            raf = 0;
            abandon();
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
                const p = currentPendingRequest();
                if (p && p.nonce !== appliedNonce) {
                    appliedNonce = p.nonce;
                    api.apply(p);
                } else {
                    api.resumePoll();
                }
            },
            destroy: () => api?.dispose(),
        };
    },
});
