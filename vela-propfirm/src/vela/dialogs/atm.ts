// "Configurar ATM": la lista de presets de UNA plantilla y el formulario nuevo/editar.
import type { WidgetContext } from '@luxalgo/vela/plugin';
import { Dialog, NumberInput, TextField } from '@luxalgo/vela/ui';
import type { Simulator } from '../../engine/Simulator';
import type { AtmPreset, OrderType } from '../../engine/types';
import { armedButton, btn, ensureStyles, h, labeled } from '../ui';
import { pointsUsdField } from '../fields';

export function openAtmDialog(ctx: WidgetContext, sim: Simulator, tplId: string): void {
    ensureStyles(ctx.host.ownerDocument);
    const tpl = sim.state.templates.find((t) => t.id === tplId);
    let editingId: string | null = null;
    let formType: OrderType = 'market';

    const body = h('div', 'pf body');
    const tplLbl = h('div', 'mini');
    tplLbl.style.color = 'var(--vela-accent)';
    tplLbl.textContent = tpl ? `${tpl.company ? tpl.company + ' — ' : ''}${tpl.name}` : '';
    const list = h('div', 'pf-list');
    list.style.maxHeight = '160px';

    const name = new TextField({ size: 'md', fill: true });
    name.input.placeholder = 'ej: Scalp rápido';
    const qty = new NumberInput({ value: 1, min: 1, step: 1, integer: true, size: 'md', fill: true, commit: 'blur' });
    const seg = h('div', 'pf-seg');
    const segBtns: Record<OrderType, HTMLButtonElement> = {
        market: btn('Market', () => setType('market'), 'on'),
        limit: btn('Limit', () => setType('limit')),
        stop: btn('Stop', () => setType('stop')),
    };
    seg.append(segBtns.market, segBtns.limit, segBtns.stop);
    const price = new NumberInput({ value: 0, step: 0.25, size: 'md', fill: true, commit: 'blur', steppers: false });
    const priceRow = labeled('Precio de entrada', price.el);
    priceRow.hidden = true;
    const sl = pointsUsdField({ points: 0, qty: () => qty.value, pointValue: () => sim.pointValue(), onChange: () => undefined, size: 'md' });
    const tp = pointsUsdField({ points: 0, qty: () => qty.value, pointValue: () => sim.pointValue(), onChange: () => undefined, size: 'md' });
    const grid = h('div', 'grid2');
    grid.append(labeled('Stop Loss (0 = off)', sl.el), labeled('Take Profit (0 = off)', tp.el));
    qty.input.addEventListener('input', () => {
        sl.refreshConversion();
        tp.refreshConversion();
    });

    function setType(t: OrderType): void {
        formType = t;
        for (const k of Object.keys(segBtns) as OrderType[]) segBtns[k].classList.toggle('on', k === t);
        priceRow.hidden = t === 'market';
    }

    function loadForm(p: AtmPreset | null): void {
        editingId = p ? p.id : null;
        setType(p ? p.type : 'market');
        name.setValue(p ? p.name : '');
        qty.setValue(p && p.qty != null ? p.qty : 1);
        price.setValue(p && p.price != null ? p.price : 0);
        sl.setPoints(p && p.sl != null ? p.sl : 0);
        tp.setPoints(p && p.tp != null ? p.tp : 0);
    }

    function renderList(): void {
        list.replaceChildren();
        const presets = sim.atmPresets(tplId);
        if (!presets.length) {
            list.appendChild(h('div', 'hint', 'Sin presets todavía para esta plantilla. Cargá uno abajo.'));
            return;
        }
        for (const a of presets) {
            const card = h('div', 'pf-card');
            const top = h('div', 'row');
            top.style.justifyContent = 'space-between';
            top.append(h('b', undefined, a.name), h('span', 'mini', `${a.type.toUpperCase()} x${a.qty || 1}`));
            const desc = h('div', 'mini', `${a.sl ? `SL ${a.sl}pts` : 'sin SL'} · ${a.tp ? `TP ${a.tp}pts` : 'sin TP'}${a.type !== 'market' ? ` · entrada ${a.price}` : ''}`);
            const actions = h('div', 'row');
            actions.style.marginTop = '5px';
            const edit = btn('✎ Editar', () => loadForm(a));
            edit.style.flex = '1';
            const del = armedButton('🗑', '¿Seguro?', () => {
                sim.deleteAtmPreset(tplId, a.id);
                renderList();
            });
            del.style.flex = '1';
            actions.append(edit, del);
            card.append(top, desc, actions);
            card.style.cursor = 'default';
            list.appendChild(card);
        }
    }

    const save = btn(
        '💾 Guardar preset',
        () => {
            const nm = name.value.trim();
            if (!nm) return ctx.toast('Ponele un nombre al preset.', 'error');
            const priceV = price.value;
            if (formType !== 'market' && !(priceV > 0)) return ctx.toast('Los presets Limit/Stop necesitan un precio de entrada válido.', 'error');
            sim.saveAtmPreset(tplId, {
                id: editingId,
                name: nm,
                type: formType,
                qty: Math.max(1, Math.trunc(qty.value) || 1),
                sl: sl.getPoints() > 0 ? sl.getPoints() : null,
                tp: tp.getPoints() > 0 ? tp.getPoints() : null,
                price: formType !== 'market' ? priceV : null,
            });
            renderList();
            loadForm(null);
        },
        'on wide',
    );
    save.style.marginTop = '8px';

    const form = h('div', 'pf-sep col');
    form.append(h('div', 'pf-title', 'Nuevo / editar preset'), labeled('Nombre', name.el), labeled('Contratos', qty.el), seg, priceRow, grid, save);
    body.append(tplLbl, list, form);
    renderList();
    loadForm(null);

    const dialog = new Dialog({
        title: 'Configurar ATM',
        host: ctx.host,
        closeOnInteractOutside: true,
        className: 'pf-dialog',
        content: (el) => el.appendChild(body),
        footer: (el) => {
            el.className += ' pf-foot';
            el.appendChild(btn('Listo', () => dialog.hide()));
        },
        onOpenChange: (open) => {
            if (!open) setTimeout(() => dialog.destroy(), 0);
        },
    });
    dialog.show();
}
