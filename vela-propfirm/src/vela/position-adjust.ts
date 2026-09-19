// Mueve el SL/TP de una posición YA ABIERTA arrastrando en el chart — clickeando, sosteniendo y
// moviendo el nivel, como pidió el usuario. Vela solo avisa cuando el arrastre TERMINA
// (`drawing:edited`, al soltar el mouse), así que no hay feedback en vivo acá (a diferencia del
// panel de orden, donde SÍ hace falta sondear porque el usuario está mirando los campos mientras
// arrastra): al soltar, se abre el panel de orden en modo confirmación ("¿Seguro que querés mover
// el SL/TP?") y el dibujo se reconstruye desde los valores REALES de la posición — así, si dice
// "No", el chart vuelve a mostrar exactamente lo que había antes del arrastre.
import { registerWidgetAttachment, type WidgetContext } from '@luxalgo/vela/plugin';
import { timeframeToMinutes } from './ReplayProvider';
import { requestAdjust } from './order-request';
import { ORDER_PANEL_ID } from './panel-order';
import { getSimulator } from './context';
import { pushPositionLevelTime } from './overlay';
import type { Simulator } from '../engine/Simulator';

const LEVEL_EPS = 1e-6;
/** Ancho del cuadro — igual criterio que panel-order.ts (chico: el hit-test real de Vela solo
 *  agarra unos pocos px alrededor de cada anchor, no la línea entera). */
const BOX_WIDTH_BARS = 4;

function mountAdjust(ctx: WidgetContext, sim: Simulator): () => void {
    let drawingId: string | null = null;
    let baseline: { entry: number; sl: number | null; tp: number | null } | null = null;

    function removeTracking(): void {
        if (drawingId) ctx.chart.drawings.remove(drawingId);
        drawingId = null;
        baseline = null;
        pushPositionLevelTime(null);
    }

    function ensureTracking(): void {
        const acc = sim.activeAccount();
        const p = acc?.position;
        if (!p) {
            if (drawingId) removeTracking();
            return;
        }
        if (baseline && baseline.entry === p.entry && baseline.sl === p.sl && baseline.tp === p.tp) return; // sin cambios reales
        removeTracking();
        const side = p.side;
        const slPrice = p.sl ?? p.entry - side * 20;
        const tpPrice = p.tp ?? p.entry + side * 20;
        const t0 = sim.currentTime();
        const t1 = t0 + timeframeToMinutes(ctx.timeframe) * 60_000 * BOX_WIDTH_BARS;
        const drawing = ctx.chart.drawings.add('position', {
            paneId: 'price',
            anchors: [
                { time: t0, price: p.entry },
                { time: t1, price: slPrice },
                { time: t1, price: tpPrice },
            ],
            props: { showHeader: false, showTargetLabel: false, showStopLabel: false, showLossSize: false, showPrices: false },
        });
        drawingId = drawing?.id ?? null;
        baseline = { entry: p.entry, sl: p.sl, tp: p.tp };
        pushPositionLevelTime(t1);
    }

    const offChange = sim.on('change', ensureTracking);
    const offEdited = ctx.chart.on('drawing:edited', ({ id }) => {
        if (id !== drawingId || !drawingId) return;
        const acc = sim.activeAccount();
        const p = acc?.position;
        if (!p) return;
        const d = ctx.chart.drawings.all().find((x) => x.id === drawingId);
        const anchors = d?.anchors;
        if (!anchors || anchors.length < 3) return;
        const newEntry = anchors[0]!.price;
        const newSl = anchors[1]!.price;
        const newTp = anchors[2]!.price;
        const curSl = p.sl ?? p.entry - p.side * 20;
        const curTp = p.tp ?? p.entry + p.side * 20;
        // reconstruye desde los valores REALES ya — si el usuario confirma, el panel aplica el
        // cambio sobre el motor; si no, el chart queda mostrando lo de siempre (nunca lo arrastrado).
        removeTracking();
        ensureTracking();
        if (Math.abs(newSl - curSl) > LEVEL_EPS) {
            requestAdjust('sl', newSl);
            ctx.togglePanel(ORDER_PANEL_ID, true);
        } else if (Math.abs(newTp - curTp) > LEVEL_EPS) {
            requestAdjust('tp', newTp);
            ctx.togglePanel(ORDER_PANEL_ID, true);
        } else if (Math.abs(newEntry - p.entry) > LEVEL_EPS) {
            ctx.toast('La entrada de una posición abierta no se puede mover — solo el SL y el TP.', 'info');
        }
    });
    ensureTracking();
    return () => {
        offChange();
        offEdited();
        removeTracking();
    };
}

registerWidgetAttachment({
    id: 'propfirm.position-adjust',
    mount: (ctx) => {
        const sim = getSimulator();
        if (!sim) return () => undefined;
        return mountAdjust(ctx, sim);
    },
});
