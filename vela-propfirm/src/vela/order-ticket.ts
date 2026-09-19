// El "ticket" de orden sobre el chart: Vender/Comprar (o Close si hay posición abierta) flotando
// arriba a la izquierda, debajo del nombre del símbolo — como en TradingView. Usa el ATM activo si
// hay uno; si no ("Sin ATM", el estado por defecto) abre el panel de orden con precio/SL/TP
// editables a mano o arrastrando en el chart.
import { registerWidgetAttachment, type WidgetContext } from '@luxalgo/vela/plugin';
import { injectStyles } from '@luxalgo/vela/ui';
import type { Simulator } from '../engine/Simulator';
import { money } from '../engine/format';
import { getSimulator } from './context';
import { ensureStyles, h } from './ui';
import { requestOrder } from './order-request';
import { ORDER_PANEL_ID } from './panel-order';

const STYLE_ID = 'propfirm-order-ticket';
const CSS = `
.pf-ticket{position:absolute;top:40px;left:8px;z-index:15;display:flex;gap:5px;align-items:center}
.pf-ticket[hidden]{display:none}
.pf-ticket .pf-btn{padding:6px 11px;font-weight:700;font-size:11px;border:none;box-shadow:0 2px 8px rgba(0,0,0,.3)}
.pf-ticket .pf-btn.buy{background:var(--vela-up,#26a65b);color:#04120a}
.pf-ticket .pf-btn.sell{background:var(--vela-down,#e0524f);color:#1a0505}
.pf-ticket .pf-btn.close{background:var(--vela-surface-overlay);border:1px solid var(--vela-border-soft);color:var(--vela-fg)}
.pf-ticket .px{font-weight:400;opacity:.85;margin-left:4px;font-variant-numeric:tabular-nums}
.pf-ticket .pos{display:flex;align-items:center;gap:6px;padding:5px 9px;border-radius:var(--vela-radius-sm);background:var(--vela-surface-overlay);
  border:1px solid var(--vela-border-soft);font:11px/1.3 var(--vela-font-family,system-ui);color:var(--vela-fg);box-shadow:0 2px 8px rgba(0,0,0,.3)}
`;

function mountTicket(ctx: WidgetContext, sim: Simulator): () => void {
    ensureStyles(ctx.host.ownerDocument);
    injectStyles(STYLE_ID, CSS, ctx.host.ownerDocument);
    const st = sim.state;

    const box = h('div', 'pf-ticket');
    const sell = h('button', 'pf-btn sell');
    sell.type = 'button';
    const buy = h('button', 'pf-btn buy');
    buy.type = 'button';
    const submit = (side: 1 | -1): void => {
        if (!sim.submitActiveAtm(side)) {
            requestOrder(side, 1);
            ctx.togglePanel(ORDER_PANEL_ID, true);
        }
    };
    sell.addEventListener('click', () => submit(-1));
    buy.addEventListener('click', () => submit(1));

    const posInfo = h('div', 'pos');
    const posLabel = h('span');
    const posPnl = h('span');
    const closeBtn = h('button', 'pf-btn close', 'Close');
    closeBtn.type = 'button';
    closeBtn.addEventListener('click', () => sim.flatten());
    posInfo.append(posLabel, posPnl, closeBtn);

    box.append(sell, buy, posInfo);
    const cell = ctx.host.querySelector<HTMLElement>('.vela-cell') ?? ctx.host;
    if (cell !== ctx.host && getComputedStyle(cell).position === 'static') cell.style.position = 'relative';
    cell.appendChild(box);

    let raf = 0;
    const paint = (): void => {
        raf = 0;
        const acc = sim.activeAccount();
        box.hidden = st.bars.length === 0;
        if (box.hidden) return;
        const px = sim.currentPrice();
        sell.textContent = '';
        sell.append('VENDER', h('span', 'px', px.toFixed(2)));
        buy.textContent = '';
        buy.append('COMPRAR', h('span', 'px', px.toFixed(2)));
        const p = acc?.position;
        if (p) {
            const upnl = (px - p.entry) * p.side * p.qty * sim.pointValue();
            sell.style.display = 'none';
            buy.style.display = 'none';
            posInfo.style.display = 'flex';
            posLabel.className = p.side > 0 ? 'pos' : 'neg';
            posLabel.textContent = `${p.side > 0 ? 'LONG' : 'SHORT'} ${p.qty} @ ${p.entry.toFixed(2)}`;
            posPnl.className = upnl >= 0 ? 'pos' : 'neg';
            posPnl.textContent = `${upnl >= 0 ? '+' : ''}${money(upnl)}`;
        } else {
            sell.style.display = '';
            buy.style.display = '';
            posInfo.style.display = 'none';
        }
    };
    const refresh = (): void => {
        if (!raf) raf = requestAnimationFrame(paint);
    };
    paint();
    const off = sim.on('change', refresh);
    return () => {
        off();
        if (raf) cancelAnimationFrame(raf);
        box.remove();
    };
}

registerWidgetAttachment({
    id: 'propfirm.order-ticket',
    mount: (ctx) => {
        const sim = getSimulator();
        if (!sim) return () => undefined;
        return mountTicket(ctx, sim);
    },
});
