// El modal de orden del HTML: Market/Limit/Stop + cantidad + SL/TP opcionales (toggle).
import type { WidgetContext } from '@luxalgo/vela/plugin';
import { Dialog, NumberInput, Switch } from '@luxalgo/vela/ui';
import type { Simulator } from '../../engine/Simulator';
import type { OrderType, Side } from '../../engine/types';
import { canTrade } from '../../engine/trading';
import { btn, ensureStyles, h, labeled } from '../ui';

export function openOrderDialog(ctx: WidgetContext, sim: Simulator, side: Side, defaultQty: number): void {
    ensureStyles(ctx.host.ownerDocument);
    let type: OrderType = 'market';
    const px = sim.currentPrice();
    const acc = sim.activeAccount();

    const body = h('div', 'pf body');
    const seg = h('div', 'pf-seg');
    const segBtns: Record<OrderType, HTMLButtonElement> = {
        market: btn('Market', () => setType('market'), 'on'),
        limit: btn('Limit', () => setType('limit')),
        stop: btn('Stop', () => setType('stop')),
    };
    seg.append(segBtns.market, segBtns.limit, segBtns.stop);

    const price = new NumberInput({ value: px, step: 0.25, size: 'md', fill: true, commit: 'blur', steppers: false });
    const priceRow = labeled('Precio de la orden', price.el);
    priceRow.hidden = true;
    const qty = new NumberInput({ value: defaultQty, min: 1, step: 1, integer: true, size: 'md', fill: true, commit: 'blur' });
    const slOn = new Switch({ size: 'sm' });
    const slVal = new NumberInput({ value: 0, min: 0, step: 1, size: 'sm', fill: false, commit: 'blur', steppers: false, disabled: true });
    const tpOn = new Switch({ size: 'sm' });
    const tpVal = new NumberInput({ value: 0, min: 0, step: 1, size: 'sm', fill: false, commit: 'blur', steppers: false, disabled: true });
    slOn.el.addEventListener('click', () => (slVal.input.disabled = !slOn.checked));
    tpOn.el.addEventListener('click', () => (tpVal.input.disabled = !tpOn.checked));

    const toggRow = (sw: Switch, label: string, num: NumberInput): HTMLElement => {
        const r = h('div', 'pf-toggrow');
        r.append(sw.el, h('span', 'grow', label), num.el);
        return r;
    };
    const acctLbl = h('div', 'mini');
    const status = acc?.status;
    acctLbl.textContent = acc ? `Cuenta: ${acc.name}${canTrade(acc) ? '' : `  ⚠ no operable (${status})`}` : 'Sin cuenta seleccionada — elegí una en el panel';
    body.append(seg, priceRow, labeled('Cantidad', qty.el), toggRow(slOn, 'Stop Loss (pts)', slVal), toggRow(tpOn, 'Take Profit (pts)', tpVal), acctLbl);

    function setType(t: OrderType): void {
        type = t;
        for (const k of Object.keys(segBtns) as OrderType[]) segBtns[k].classList.toggle('on', k === t);
        priceRow.hidden = t === 'market';
    }

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
                        if (slOn.checked && !Number.isFinite(slV)) return ctx.toast('Ingresá un valor de Stop Loss en puntos.', 'error');
                        if (tpOn.checked && !Number.isFinite(tpV)) return ctx.toast('Ingresá un valor de Take Profit en puntos.', 'error');
                        let ok: boolean;
                        if (type === 'market') ok = sim.openPosition(side, q, slV, tpV);
                        else {
                            const p = price.value;
                            if (!Number.isFinite(p)) return ctx.toast('Ingresá el precio de la orden.', 'error');
                            ok = sim.placeOrder(side, type, p, q, slV, tpV);
                        }
                        if (ok) dialog.hide();
                    },
                    'on',
                ),
            );
        },
        onOpenChange: (open) => {
            if (!open) setTimeout(() => dialog.destroy(), 0);
        },
    });
    dialog.titleEl.style.color = side > 0 ? 'var(--vela-up,#26a65b)' : 'var(--vela-down,#e0524f)';
    dialog.show();
}
