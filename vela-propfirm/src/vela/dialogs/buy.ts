// "Comprar cuentas": picker de empresa + plantilla, cantidad, y acceso al editor/ATM/borrado.
import type { WidgetContext } from '@luxalgo/vela/plugin';
import { Dialog, NumberInput } from '@luxalgo/vela/ui';
import type { Simulator } from '../../engine/Simulator';
import { armedButton, btn, ensureStyles, h, labeled } from '../ui';
import { openAtmDialog } from './atm';
import { openTemplateDialog } from './template';

export function openBuyDialog(ctx: WidgetContext, sim: Simulator): void {
    ensureStyles(ctx.host.ownerDocument);
    const st = sim.state;
    const body = h('div', 'pf body');
    const companyBar = h('div', 'pf-tabs');
    const picker = h('div', 'pf-list');
    picker.style.maxHeight = '280px';
    const qty = new NumberInput({ value: 1, min: 1, step: 1, integer: true, size: 'md', fill: true, commit: 'blur' });
    const msg = h('div', 'mini');
    msg.style.minHeight = '14px';

    function renderCompanies(): void {
        const companies = sim.companies();
        if (!st.selCompany || !companies.includes(st.selCompany)) st.selCompany = companies[0] ?? null;
        companyBar.replaceChildren(
            ...companies.map((c) =>
                btn(
                    c,
                    () => {
                        st.selCompany = c;
                        st.selTpl = null;
                        renderCompanies();
                        renderTemplates();
                    },
                    `tab${c === st.selCompany ? ' on' : ''}`,
                ),
            ),
        );
    }
    function renderTemplates(): void {
        picker.replaceChildren();
        const inCompany = st.templates.filter((t) => (t.company || 'Sin empresa') === st.selCompany);
        if (!inCompany.length) {
            picker.appendChild(h('div', 'hint', 'No hay plantillas de esta empresa todavía. Creá una con "+ Nueva plantilla".'));
            return;
        }
        if (!st.selTpl || !inCompany.some((t) => t.id === st.selTpl)) st.selTpl = inCompany[0]!.id;
        for (const t of inCompany) {
            const card = h('div', `pf-card${t.id === st.selTpl ? ' sel' : ''}`);
            const top = h('div', 'row');
            top.style.justifyContent = 'space-between';
            top.append(h('b', undefined, t.name), h('span', 'mini', `$${t.cost}`));
            const p0 = t.phases[0]!;
            const f = t.funded;
            card.append(
                top,
                h('div', 'mini', `${t.phases.length} fase${t.phases.length > 1 ? 's' : ''} · cuenta $${t.size.toLocaleString()} · obj. fase 1: $${p0.target} · DD $${p0.ddAmount} (${p0.ddType})`),
                h('div', 'mini', `Fondeada: DD $${f.ddAmount} (${f.ddType}) · payout ${f.payoutPct}% · split ${f.splitPct}%${f.payoutCap ? ` (tope $${f.payoutCap})` : ''}`),
            );
            card.addEventListener('click', () => {
                st.selTpl = t.id;
                msg.textContent = '';
                renderTemplates();
            });
            picker.appendChild(card);
        }
    }

    const selected = () => st.templates.find((t) => t.id === st.selTpl);
    const r1 = h('div', 'row');
    const qtyWrap = labeled('Cantidad a comprar', qty.el);
    qtyWrap.style.flex = '1';
    r1.append(
        qtyWrap,
        btn('+ Nueva plantilla', () => openTemplateDialog(ctx, sim, null, () => {
            renderCompanies();
            renderTemplates();
        })),
    );
    r1.style.alignItems = 'flex-end';
    const r2 = h('div', 'row');
    const edit = btn('✎ Editar seleccionada', () => {
        const t = selected();
        if (!t) return ctx.toast('Elegí una plantilla para editar.', 'error');
        openTemplateDialog(ctx, sim, t, () => {
            renderCompanies();
            renderTemplates();
        });
    });
    const atm = btn('⚙ ATM de esta plantilla', () => {
        const t = selected();
        if (!t) return ctx.toast('Elegí una plantilla primero.', 'error');
        openAtmDialog(ctx, sim, t.id);
    });
    const del = armedButton('🗑 Eliminar', '🗑 ¿Seguro? Tocá de nuevo', () => {
        const t = selected();
        if (!t) return void (msg.textContent = 'Elegí una plantilla primero.');
        const r = sim.deleteTemplate(t.id);
        msg.textContent = r.msg;
        msg.className = `mini ${r.ok ? 'pos' : 'neg'}`;
        renderCompanies();
        renderTemplates();
    });
    for (const b of [edit, atm, del]) b.style.flex = '1 1 auto';
    r2.style.flexWrap = 'wrap';
    r2.append(edit, atm, del);
    body.append(companyBar, picker, r1, r2, msg);
    renderCompanies();
    renderTemplates();

    const dialog = new Dialog({
        title: 'Comprar cuentas',
        host: ctx.host,
        closeOnInteractOutside: true,
        className: 'pf-dialog',
        content: (el) => el.appendChild(body),
        footer: (el) => {
            el.className += ' pf-foot';
            el.append(
                btn('Cancelar', () => dialog.hide()),
                btn(
                    'Comprar',
                    () => {
                        const t = selected();
                        if (!t) return ctx.toast('Elegí (o creá) una plantilla primero.', 'error');
                        sim.buyAccounts(t, Math.max(1, Math.trunc(qty.value) || 1));
                        dialog.hide();
                    },
                    'on',
                ),
            );
        },
        onOpenChange: (open) => {
            if (!open) setTimeout(() => dialog.destroy(), 0);
        },
    });
    dialog.show();
}
