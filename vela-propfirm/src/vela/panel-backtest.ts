// El panel "Prop firm backtest": modo de simulación, la cuenta operativa (un dropdown — comprar y
// monitorear viven en Tracker → Panel de control), ATM ("Sin ATM" por defecto), posición abierta,
// órdenes de trabajo y Modo Agente. Comprar/Vender/Close ahora son el ticket flotante sobre el
// chart (order-ticket.ts); los datos/instrumento/comisión/corte viven en Tracker → Configuración.
import { registerIcon, registerSidePanel, registerWidgetAction, type WidgetContext } from '@luxalgo/vela/plugin';
import { Switch, svg16 } from '@luxalgo/vela/ui';
import type { Simulator } from '../engine/Simulator';
import type { SimMode } from '../engine/types';
import { PV } from '../engine/data';
import { money } from '../engine/format';
import { acctCategory } from '../engine/rules';
import { SIM_MODE_HINTS } from '../engine/tracker';
import { getSimulator } from './context';
import { btn, ensureStyles, h, hint, kv, section } from './ui';
import { openAgentDialog } from './dialogs/agent';
import { openAtmDialog } from './dialogs/atm';

export const PANEL_ID = 'propfirm.backtest';

registerIcon(
    'propfirm.backtest',
    svg16('<path d="M2.5 13.5h11M3.5 11V7.5M6.5 11V4.5M9.5 11V6M12.5 11V3"/><path d="M2.5 5.5 6 3l3.5 2.5L13.5 2"/>'),
);

registerWidgetAction({
    id: 'propfirm.open-backtest',
    target: 'topbar',
    label: 'Trading Panel',
    icon: 'propfirm.backtest',
    align: 'left',
    order: 10,
    run: (ctx) => ctx.togglePanel(PANEL_ID),
});

const MODES: { mode: SimMode; label: string }[] = [
    { mode: 'challenge', label: 'Modo Challenge' },
    { mode: 'cushion', label: 'Modo Colchón' },
    { mode: 'full', label: 'Modo Completo' },
];
const CAT_LABEL: Record<string, string> = { challenge: 'Challenge', funded: 'Fondeadas', paid: 'Cobradas', blown: 'Quemadas' };

function mountPanel(ctx: WidgetContext, sim: Simulator, body: HTMLElement): () => void {
    const doc = body.ownerDocument;
    ensureStyles(doc);
    const st = sim.state;
    const root = h('div', 'pf');

    // ── Cuentas: modo + cuenta operativa ──────────────────────────────────────────────
    const sAcc = section('Cuentas');
    const modeTabs = h('div', 'pf-tabs');
    modeTabs.title = 'Qué parte del ciclo nos interesa medir';
    const modeBtns = MODES.map((m) => btn(m.label, () => sim.setSimMode(m.mode), 'tab'));
    modeTabs.append(...modeBtns);
    const modeHint = hint('');
    const acctSelect = h('select', 'pf-native');
    acctSelect.addEventListener('change', () => sim.selectAccount(acctSelect.value || null));
    const acctWrap = h('div');
    acctWrap.style.marginTop = '8px';
    acctWrap.append(h('span', 'lbl', 'Cuenta operativa'), acctSelect);
    const noAcct = hint('Sin cuentas todavía — comprá una desde Tracker → Panel de control.');
    noAcct.style.marginTop = '8px';
    sAcc.append(modeTabs, modeHint, acctWrap, noAcct);

    // ── ATM ────────────────────────────────────────────────────────────────────────────
    const sAtm = section('ATM');
    const atmChips = h('div', 'pf-chips');
    const atmRow = h('div', 'row');
    atmRow.append(
        atmChips,
        btn('⚙', () => {
            const acc = sim.activeAccount();
            if (!acc) return ctx.toast('Seleccioná primero una cuenta (así sé para qué plantilla configurar los ATM).', 'error');
            openAtmDialog(ctx, sim, acc.tplId);
        }),
    );
    sAtm.append(atmRow, hint('"Sin ATM" es el estado por defecto: Comprar/Vender en el chart abren el panel de orden (precio/SL/TP a mano o arrastrando en el chart). Con un ATM activo, ejecutan ese preset directo.'));

    // ── Posición / Órdenes ────────────────────────────────────────────────────────────
    const sPos = section('Posición abierta');
    const posBox = h('div');
    sPos.appendChild(posBox);
    const sOrd = section('Órdenes de trabajo');
    const ordBox = h('div');
    sOrd.appendChild(ordBox);

    // ── Agente ────────────────────────────────────────────────────────────────────────
    const sAg = section('Modo Agente');
    const agRow = h('div', 'row');
    const agSwitch = new Switch({
        size: 'sm',
        checked: st.agent.active,
        onChange: (on) => {
            if (on) {
                agSwitch.setChecked(false); // se activa recién al "Aplicar y activar"
                openAgentDialog(ctx, sim);
            } else sim.deactivateAgent();
        },
    });
    const agReset = btn('🔄 Reset', () => sim.resetAgentRun());
    agReset.title = 'Vuelve todo (cuentas, ledger, replay) al punto justo antes de la primera compra desde que cargaste datos o desde el último Reset';
    agRow.append(agSwitch.el, h('span', 'grow', '🤖 Modo Agente'), btn('⚙ Configurar', () => openAgentDialog(ctx, sim)), agReset);
    agRow.querySelector('.grow')!.setAttribute('style', 'flex:1');
    const agStatus = h('div', 'mini');
    agStatus.style.marginTop = '4px';
    sAg.append(agRow, agStatus, hint('Teclas: Espacio play/pause · → step · Alt+D saltar día. Comprar/Vender/Close viven arriba a la izquierda del chart.'));

    root.append(sAcc, sAtm, sPos, sOrd, sAg);
    body.appendChild(root);

    // ── pintado ───────────────────────────────────────────────────────────────────────
    function paintAcctSelect(): void {
        const groups: Record<string, HTMLOptGroupElement> = {};
        const order = ['challenge', 'funded', 'paid', 'blown'];
        acctSelect.replaceChildren();
        for (const cat of order) {
            const g = doc.createElement('optgroup');
            g.label = CAT_LABEL[cat]!;
            groups[cat] = g;
        }
        for (const acc of st.accounts) {
            const opt = doc.createElement('option');
            opt.value = acc.id;
            opt.textContent = `${acc.name} — ${money(acc.balance)}`;
            groups[acctCategory(acc)]!.appendChild(opt);
        }
        for (const cat of order) if (groups[cat]!.childElementCount) acctSelect.appendChild(groups[cat]!);
        acctSelect.value = st.selAcct ?? '';
        const has = st.accounts.length > 0;
        acctWrap.hidden = !has;
        noAcct.hidden = has;
    }

    function paintAtm(): void {
        atmChips.replaceChildren();
        const noAtm = btn('Sin ATM', () => sim.setActiveAtm(null), st.activeAtm === null ? 'on' : '');
        atmChips.appendChild(noAtm);
        const acc = sim.activeAccount();
        if (!acc) return;
        for (const a of sim.atmPresets(acc.tplId)) {
            const b = btn(a.name, () => sim.setActiveAtm(a.id), a.id === st.activeAtm ? 'on' : '');
            b.title = `${a.type.toUpperCase()} x${a.qty || 1}${a.sl ? ` · SL ${a.sl}pts` : ''}${a.tp ? ` · TP ${a.tp}pts` : ''}${a.type !== 'market' ? ` · entrada ${a.price}` : ''}`;
            atmChips.appendChild(b);
        }
    }

    function paintPosition(): void {
        const acc = sim.activeAccount();
        const p = acc?.position;
        if (!acc || !p) return void posBox.replaceChildren(hint(acc ? 'Sin posición en esta cuenta.' : 'Sin posición. Seleccioná una cuenta y operá.'));
        const px = sim.currentPrice();
        const u = (px - p.entry) * p.side * p.qty * (PV[st.instr] || 1);
        posBox.replaceChildren(
            kv('Cuenta', acc.name),
            kv('Lado / Qty', `${p.side > 0 ? 'LONG' : 'SHORT'} ${p.qty}`, p.side > 0 ? 'pos' : 'neg'),
            kv('Entrada', p.entry.toFixed(2)),
            kv('Precio', px.toFixed(2)),
            ...(p.sl != null ? [kv('SL', p.sl.toFixed(2), 'neg')] : []),
            ...(p.tp != null ? [kv('TP', p.tp.toFixed(2), 'pos')] : []),
            kv('P&L abierto', `${u >= 0 ? '+' : ''}${money(u)}`, u >= 0 ? 'pos' : 'neg'),
        );
    }

    function paintOrders(): void {
        ordBox.replaceChildren();
        if (!st.orders.length) return void ordBox.appendChild(hint('Ninguna.'));
        for (const o of st.orders) {
            const acc = st.accounts.find((a) => a.id === o.accId);
            const r = h('div', 'pf-ordrow');
            const left = h('span', o.side > 0 ? 'pos' : 'neg', `${o.side > 0 ? 'BUY' : 'SELL'} ${o.type.toUpperCase()} ${o.qty} @${o.px.toFixed(2)}`);
            const right = h('span', 'mini', `${acc ? acc.name.split(' ')[0] : ''} `);
            const x = btn('✕', () => sim.cancelOrder(o.id));
            x.style.padding = '1px 5px';
            right.appendChild(x);
            r.append(left, right);
            ordBox.appendChild(r);
        }
    }

    let raf = 0;
    function paint(): void {
        raf = 0;
        MODES.forEach((m, i) => modeBtns[i]!.classList.toggle('on', m.mode === st.simMode));
        modeHint.textContent = SIM_MODE_HINTS[st.simMode];
        paintAcctSelect();
        paintAtm();
        paintPosition();
        paintOrders();
        agSwitch.setChecked(st.agent.active);
        agReset.disabled = !sim.canResetAgent();
        agStatus.textContent = sim.agentStatusText();
    }
    const refresh = (): void => {
        if (!raf) raf = requestAnimationFrame(paint);
    };
    paint();
    const offChange = sim.on('change', refresh);
    const ro = new ResizeObserver(refresh);
    ro.observe(body);
    return () => {
        offChange();
        ro.disconnect();
        if (raf) cancelAnimationFrame(raf);
        root.remove();
    };
}

registerSidePanel({
    id: PANEL_ID,
    title: 'Trading Panel',
    icon: 'propfirm.backtest',
    order: 30,
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
        const dispose = mountPanel(ctx, sim, body);
        return { destroy: dispose };
    },
});
