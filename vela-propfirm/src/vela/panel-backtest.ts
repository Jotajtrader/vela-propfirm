// El panel "Prop firm backtest": la columna derecha del HTML (negocio, cuentas, operar, posición,
// órdenes, agente) más la cabecera (datos, instrumento, comisión, corte de jornada, sesión) — como
// side panel de Vela, con su botón junto a Indicators y su toggle en el grupo de paneles.
import { registerIcon, registerSidePanel, registerWidgetAction, type WidgetContext } from '@luxalgo/vela/plugin';
import { NumberInput, Select, Switch, svg16 } from '@luxalgo/vela/ui';
import type { Simulator } from '../engine/Simulator';
import type { Account, SimMode } from '../engine/types';
import { PV, parseCSV } from '../engine/data';
import { money } from '../engine/format';
import { acctCategory, consistencyOk, isPayoutEligible, rulesFor, targetBalOf, thresholdOf, tplOf, isPhase } from '../engine/rules';
import { canTrade } from '../engine/trading';
import { SIM_MODE_HINTS, businessStats, ledgerEquitySeries, statusBadge } from '../engine/tracker';
import { getSimulator } from './context';
import { btn, cssVar, ensureStyles, fmtHM, h, hint, kv, nativeInput, parseHM, section } from './ui';
import { openAgentDialog } from './dialogs/agent';
import { openAtmDialog } from './dialogs/atm';
import { openBuyDialog } from './dialogs/buy';
import { openOrderDialog } from './dialogs/order';

export const PANEL_ID = 'propfirm.backtest';

registerIcon(
    'propfirm.backtest',
    svg16('<path d="M2.5 13.5h11M3.5 11V7.5M6.5 11V4.5M9.5 11V6M12.5 11V3"/><path d="M2.5 5.5 6 3l3.5 2.5L13.5 2"/>'),
);

registerWidgetAction({
    id: 'propfirm.open-backtest',
    target: 'topbar',
    label: 'Prop firm backtest',
    icon: 'propfirm.backtest',
    align: 'left',
    order: 10,
    run: (ctx) => ctx.togglePanel(PANEL_ID),
});

const INSTRUMENTS = Object.keys(PV).map((k) => ({ value: k, label: `${k} ($${PV[k]}/pt)` }));
const MODES: { mode: SimMode; label: string }[] = [
    { mode: 'challenge', label: 'Modo Challenge' },
    { mode: 'cushion', label: 'Modo Colchón' },
    { mode: 'full', label: 'Modo Completo' },
];
const CATS: { cat: Account['status'] extends never ? never : 'challenge' | 'funded' | 'paid' | 'blown'; label: string }[] = [
    { cat: 'challenge', label: 'Challenge' },
    { cat: 'funded', label: 'Fondeadas' },
    { cat: 'paid', label: 'Cobradas' },
    { cat: 'blown', label: 'Quemadas' },
];

function mountPanel(ctx: WidgetContext, sim: Simulator, body: HTMLElement): () => void {
    const doc = body.ownerDocument;
    ensureStyles(doc);
    const st = sim.state;
    const root = h('div', 'pf');
    let acctFilter: (typeof CATS)[number]['cat'] = 'challenge';

    // ── Datos ──────────────────────────────────────────────────────────────────────────
    const sData = section('Datos');
    const csvFile = nativeInput('file');
    csvFile.accept = '.csv,.txt';
    csvFile.hidden = true;
    csvFile.addEventListener('change', () => {
        const f = csvFile.files?.[0];
        if (!f) return;
        const r = new FileReader();
        r.onload = () => sim.loadBars(parseCSV(String(r.result), st.tradingDayCutoff));
        r.readAsText(f);
        csvFile.value = '';
    });
    const sessFile = nativeInput('file');
    sessFile.accept = '.json';
    sessFile.hidden = true;
    sessFile.addEventListener('change', () => {
        const f = sessFile.files?.[0];
        if (!f) return;
        const r = new FileReader();
        r.onload = () => {
            try {
                sim.importSession(JSON.parse(String(r.result)));
            } catch {
                ctx.toast('JSON inválido', 'error');
            }
        };
        r.readAsText(f);
        sessFile.value = '';
    });
    const dataRow = h('div', 'row');
    dataRow.style.flexWrap = 'wrap';
    dataRow.append(
        btn('Datos demo', () => import('../engine/data').then((m) => sim.loadBars(m.genSample()))),
        btn('Cargar CSV', () => csvFile.click()),
        btn('Exportar sesión', () => {
            const blob = new Blob([JSON.stringify(sim.exportSession())], { type: 'application/json' });
            const a = h('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'sesion-fondeo.json';
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        }),
        btn('Importar', () => sessFile.click()),
    );
    const instr = new Select({ options: INSTRUMENTS, value: st.instr, size: 'sm', fill: true, onChange: (v) => sim.setInstrument(v) });
    const comm = new NumberInput({ value: st.comm, step: 0.1, min: 0, size: 'sm', fill: true, commit: 'blur', steppers: false, onChange: (v) => sim.setCommission(v) });
    const cutoff = nativeInput('time', fmtHM(st.tradingDayCutoff));
    cutoff.title = 'Hora real de cierre del mercado — el "día" de trading corta acá, no a medianoche';
    cutoff.addEventListener('change', () => sim.setTradingDayCutoff(parseHM(cutoff.value) ?? { h: 0, m: 0 }));
    const cfg = h('div', 'grid3');
    const lab = (l: string, c: HTMLElement): HTMLElement => {
        const w = h('div');
        w.append(h('span', 'lbl', l), c);
        return w;
    };
    cfg.append(lab('Instrumento', instr.el), lab('Comis/lado', comm.el), lab('Cierre jornada', cutoff));
    cfg.style.marginTop = '8px';
    sData.append(dataRow, csvFile, sessFile, cfg, hint('Formato CSV: datetime,open,high,low,close[,volume] — 1 fila por barra, datetime ISO o YYYY-MM-DD HH:MM. Con el corte de jornada, la sesión nocturna queda del lado del día de trading siguiente.'));

    // ── Negocio de cuentas ─────────────────────────────────────────────────────────────
    const sBiz = section('Negocio de cuentas');
    const netRow = kv('P&L NETO', '$0');
    const netV = netRow.querySelector('.v') as HTMLElement;
    netV.classList.add('stat-net');
    const g3 = h('div', 'grid3');
    const stBought = h('span', 'v');
    const stFunded = h('span', 'v');
    const stBlown = h('span', 'v');
    for (const [k, v] of [
        ['Compradas', stBought],
        ['Fondeadas', stFunded],
        ['Quemadas', stBlown],
    ] as const) {
        const c = h('div', 'kv col');
        c.append(h('span', 'k', k), v);
        g3.appendChild(c);
    }
    const g2 = h('div', 'grid2');
    const costRow = kv('Gastado', '$0', 'neg');
    const payRow = kv('Cobrado', '$0', 'pos');
    g2.append(costRow, payRow);
    const eq = h('canvas', 'pf-canvas');
    eq.style.marginTop = '8px';
    const tradeRow = kv('Equity trading (paralelo)', '$0');
    sBiz.append(netRow, g3, g2, eq, tradeRow);

    // ── Cuentas ───────────────────────────────────────────────────────────────────────
    const sAcc = section('Cuentas');
    const modeTabs = h('div', 'pf-tabs');
    modeTabs.title = 'Qué parte del ciclo nos interesa medir';
    const modeBtns = MODES.map((m) => btn(m.label, () => sim.setSimMode(m.mode), 'tab'));
    modeTabs.append(...modeBtns);
    const modeHint = hint('');
    const buyBtn = btn('+ Comprar cuentas', () => openBuyDialog(ctx, sim), 'wide');
    const catTabs = h('div', 'pf-tabs');
    const catBtns = CATS.map((c) => {
        const b = btn('', () => {
            acctFilter = c.cat;
            paint();
        }, 'tab');
        b.append(doc.createTextNode(c.label + ' '), h('span', 'cnt', '0'));
        return b;
    });
    catTabs.append(...catBtns);
    const acctList = h('div', 'pf-list');
    sAcc.append(modeTabs, modeHint, buyBtn, catTabs, acctList);

    // ── Operar ────────────────────────────────────────────────────────────────────────
    const sOp = section('Operar');
    const atmRow = h('div', 'row');
    const atmChips = h('div', 'pf-chips');
    atmChips.style.flex = '1';
    atmRow.append(
        h('span', 'mini', 'ATM'),
        atmChips,
        btn('⚙', () => {
            const acc = sim.activeAccount();
            if (!acc) return ctx.toast('Seleccioná primero una cuenta (así sé para qué plantilla configurar los ATM).', 'error');
            openAtmDialog(ctx, sim, acc.tplId);
        }),
    );
    const qtyIn = new NumberInput({ value: 1, min: 1, step: 1, integer: true, size: 'sm', fill: false, commit: 'blur' });
    qtyIn.el.style.width = '64px';
    const tradeRowEl = h('div', 'row');
    tradeRowEl.style.marginTop = '8px';
    const submit = (side: 1 | -1): void => {
        if (!sim.submitActiveAtm(side)) openOrderDialog(ctx, sim, side, Math.max(1, Math.trunc(qtyIn.value) || 1));
    };
    tradeRowEl.append(
        h('span', 'mini', 'Qty'),
        qtyIn.el,
        btn('▲ COMPRAR', () => submit(1), 'big buy'),
        btn('▼ VENDER', () => submit(-1), 'big sell'),
        btn('FLATTEN', () => sim.flatten(), 'big flat'),
    );
    sOp.append(atmRow, tradeRowEl);

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
    sAg.append(agRow, agStatus, hint('Teclas: Espacio play/pause · → step · Alt+D saltar día. Comprar/Vender abren el panel de orden (o ejecutan el ATM activo). El trade se imputa a la cuenta seleccionada.'));

    root.append(sData, sBiz, sAcc, sOp, sPos, sOrd, sAg);
    body.appendChild(root);

    // ── pintado ───────────────────────────────────────────────────────────────────────
    function drawEquity(): void {
        const dpr = window.devicePixelRatio || 1;
        const r = eq.getBoundingClientRect();
        if (!r.width) return;
        eq.width = r.width * dpr;
        eq.height = r.height * dpr;
        const g = eq.getContext('2d')!;
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        const w = r.width;
        const hgt = r.height;
        g.clearRect(0, 0, w, hgt);
        const vals = ledgerEquitySeries(st.ledger);
        const muted = cssVar(eq, '--vela-fg-muted', '#8892a0');
        g.font = `10px ${cssVar(eq, '--vela-font-family', 'system-ui')}`;
        if (vals.length < 2) {
            g.fillStyle = muted;
            g.fillText('curva de negocio', 8, hgt / 2);
            return;
        }
        let mn = Math.min(0, ...vals);
        let mx = Math.max(0, ...vals);
        if (mx === mn) mx = mn + 1;
        const X = (i: number): number => 4 + (i / (vals.length - 1)) * (w - 8);
        const Y = (v: number): number => hgt - 4 - ((v - mn) / (mx - mn)) * (hgt - 8);
        g.strokeStyle = cssVar(eq, '--vela-border-soft', '#2a3340');
        g.beginPath();
        g.moveTo(4, Y(0));
        g.lineTo(w - 4, Y(0));
        g.stroke();
        const last = vals[vals.length - 1]!;
        g.strokeStyle = last >= 0 ? cssVar(eq, '--vela-up', '#26a65b') : cssVar(eq, '--vela-down', '#e0524f');
        g.lineWidth = 1.5;
        g.beginPath();
        vals.forEach((v, i) => (i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v))));
        g.stroke();
        g.fillStyle = g.strokeStyle;
        g.fillText(`${last >= 0 ? '+' : ''}$${Math.round(last)}`, 6, 12);
    }

    function acctCard(acc: Account): HTMLElement {
        const tpl = tplOf(st, acc);
        const rules = rulesFor(acc, tpl);
        const notActivated = acc.status === 'funded' && !acc.activated;
        const thr = rules && !notActivated ? thresholdOf(acc, rules) : null;
        const ddRoom = thr != null ? acc.balance - thr : null;
        const ddAmt = rules ? rules.ddAmount : null;
        const toTgt = acc.status === 'challenge' && rules && isPhase(rules) ? targetBalOf(acc, rules) - acc.balance : null;
        const pnl = acc.balance - acc.startBalance;
        const dailyRoom = rules && rules.dailyLoss > 0 && !notActivated ? rules.dailyLoss + acc.dailyPnl : null;
        const progTgt = acc.status === 'challenge' && rules && isPhase(rules) ? Math.max(0, Math.min(1, (acc.balance - acc.stageStartBalance) / rules.target)) : 1;
        const progDD = ddRoom != null && ddAmt ? Math.max(0, Math.min(1, ddRoom / ddAmt)) : 0;
        const eligible = acc.status === 'funded' && acc.activated && tpl ? isPayoutEligible(acc, tpl) : false;
        const badge = statusBadge(acc);

        let div = acctList.querySelector<HTMLElement>(`[data-accid="${acc.id}"]`);
        if (!div) {
            div = h('div');
            div.dataset.accid = acc.id;
            div.addEventListener('click', (e) => {
                if ((e.target as HTMLElement).closest('button')) return;
                sim.selectAccount(acc.id);
            });
        }
        div.className = `pf-card${acc.id === st.selAcct ? ' sel' : ''}`;
        div.replaceChildren();
        const top = h('div', 'top');
        top.append(h('span', 'nm', acc.name), h('span', `pf-badge ${badge.cls}`, badge.text));
        div.append(top, h('div', 'mini', tpl ? tpl.name : '(plantilla eliminada)'));
        const bal = h('div', 'kv');
        bal.append(h('span', 'mini', 'Balance'), h('span', 'mini', ''));
        (bal.lastChild as HTMLElement).innerHTML = `<b>${money(acc.balance)}</b> (${pnl >= 0 ? '+' : ''}${money(pnl)})`;
        div.appendChild(bal);
        const mini = (k: string, v: string, cls = ''): void => {
            const r = h('div', 'kv');
            r.append(h('span', 'mini', k), h('span', `mini${cls ? ' ' + cls : ''}`, v));
            div!.appendChild(r);
        };
        if (!notActivated) mini('PnL de hoy', `${acc.dailyPnl >= 0 ? '+' : ''}${money(acc.dailyPnl)}`, acc.dailyPnl >= 0 ? 'pos' : 'neg');
        if (notActivated) {
            const n = h('div', 'mini', '✅ Challenge aprobado — tocá "Fondear" para activar la cuenta y empezar a operar en fondeada');
            n.style.color = 'var(--vela-up,#26a65b)';
            div.appendChild(n);
        }
        if (ddRoom != null && ddAmt != null) mini('DD room', `${money(ddRoom)} / ${money(ddAmt)}`, ddRoom < ddAmt * 0.25 ? 'neg' : '');
        if (acc.status === 'challenge' && toTgt != null) mini('A objetivo', money(Math.max(0, toTgt)));
        if (dailyRoom != null) mini('Daily room', money(dailyRoom), dailyRoom < 0 ? 'neg' : '');
        if (rules && rules.consistencyOn && !notActivated) {
            const days = acc.dayProfits.concat([acc.dailyPnl]);
            const total = days.reduce((s, v) => s + v, 0);
            const best = days.length ? Math.max(...days) : 0;
            const pct = total > 0 ? (best / total) * 100 : 0;
            const bad = total > 0 && pct > rules.consistencyPct;
            mini('Consistencia', `mejor día ${pct.toFixed(0)}% / tope ${rules.consistencyPct}%`, bad ? 'neg' : '');
        }
        if (acc.status === 'funded' && acc.activated && tpl && (tpl.funded.minDays > 0 || tpl.funded.minCycleSum > 0)) {
            mini('Elegibilidad retiro', `${acc.cycleValidDays}/${tpl.funded.minDays || 0} días de $${tpl.funded.minDayProfit || 0}+ · ${money(acc.cycleProfitSum)}/${money(tpl.funded.minCycleSum || 0)}`, eligible ? 'pos' : 'neg');
        }
        if (acc.position) mini('Posición', `${acc.position.side > 0 ? 'LONG' : 'SHORT'} ${acc.position.qty} @ ${acc.position.entry.toFixed(2)}`, acc.position.side > 0 ? 'pos' : 'neg');
        if (acc.status === 'paused') {
            const n = h('div', 'mini', 'Pausada por límite diario — se reactiva al saltar de día');
            n.style.color = '#e0a53f';
            div.appendChild(n);
        }
        const bars = h('div', 'pf-bars');
        const b1 = h('div', 'pf-bar');
        b1.title = 'progreso a objetivo';
        const f1 = h('div', 'fill');
        f1.style.cssText = `width:${progTgt * 100}%;background:var(--vela-up,#26a65b)`;
        b1.appendChild(f1);
        const b2 = h('div', 'pf-bar');
        b2.title = 'colchón de drawdown';
        const f2 = h('div', 'fill');
        f2.style.cssText = `width:${progDD * 100}%;background:#e0a53f`;
        b2.appendChild(f2);
        bars.append(b1, b2);
        div.appendChild(bars);
        const actions = h('div', 'row');
        actions.style.marginTop = '6px';
        if (notActivated) {
            const b = btn('🚀 Fondear', () => sim.activate(acc), 'on');
            b.style.flex = '1';
            actions.appendChild(b);
        }
        if (acc.status === 'funded' && acc.activated) {
            const b = btn('💵 Cobrar', () => sim.collectPayout(acc));
            b.style.flex = '1';
            b.disabled = !eligible;
            actions.appendChild(b);
        }
        if ((acc.status === 'blown' || acc.status === 'paid') && tpl) {
            const b = btn('↻ Recomprar', () => sim.rebuy(acc));
            b.style.flex = '1';
            actions.appendChild(b);
        }
        if (acc.payouts > 0) actions.appendChild(h('span', 'mini', `cobrado ${money(acc.payouts)}`));
        if (actions.childElementCount) div.appendChild(actions);
        return div;
    }

    function paintAccounts(): void {
        const counts = { challenge: 0, funded: 0, paid: 0, blown: 0 };
        for (const a of st.accounts) counts[acctCategory(a)]++;
        CATS.forEach((c, i) => {
            catBtns[i]!.classList.toggle('on', c.cat === acctFilter);
            (catBtns[i]!.querySelector('.cnt') as HTMLElement).textContent = String(counts[c.cat]);
        });
        const visible = st.accounts.filter((a) => acctCategory(a) === acctFilter);
        if (!visible.length) {
            acctList.replaceChildren(hint('Sin cuentas en esta categoría.'));
            return;
        }
        if (acctList.firstElementChild && !(acctList.firstElementChild as HTMLElement).dataset.accid) acctList.replaceChildren();
        const seen = new Set<string>();
        for (const acc of visible) {
            seen.add(acc.id);
            acctList.appendChild(acctCard(acc)); // conserva el orden; un nodo existente solo se reubica
        }
        for (const el of [...acctList.children]) if ((el as HTMLElement).dataset.accid && !seen.has((el as HTMLElement).dataset.accid!)) el.remove();
    }

    function paintAtm(): void {
        atmChips.replaceChildren();
        const acc = sim.activeAccount();
        if (!acc) return void atmChips.appendChild(h('span', 'mini', 'Seleccioná una cuenta'));
        const presets = sim.atmPresets(acc.tplId);
        if (!presets.length) return void atmChips.appendChild(h('span', 'mini', 'Sin ATM cargados para esta plantilla'));
        for (const a of presets) {
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
        const b = businessStats(st);
        netV.textContent = `${b.net >= 0 ? '+' : ''}${money(b.net)}`;
        netV.className = `v stat-net ${b.net >= 0 ? 'pos' : 'neg'}`;
        stBought.textContent = String(b.bought);
        stFunded.textContent = String(b.funded);
        stBlown.textContent = String(b.blown);
        (costRow.querySelector('.v') as HTMLElement).textContent = money(b.cost);
        (payRow.querySelector('.v') as HTMLElement).textContent = money(b.payout);
        (tradeRow.querySelector('.v') as HTMLElement).textContent = `${b.tradingPnl >= 0 ? '+' : ''}${money(b.tradingPnl)}`;
        drawEquity();
        MODES.forEach((m, i) => modeBtns[i]!.classList.toggle('on', m.mode === st.simMode));
        modeHint.textContent = SIM_MODE_HINTS[st.simMode];
        paintAccounts();
        paintAtm();
        paintPosition();
        paintOrders();
        agSwitch.setChecked(st.agent.active);
        agReset.disabled = !sim.canResetAgent();
        agStatus.textContent = sim.agentStatusText();
        instr.setValue(st.instr);
        cutoff.value = fmtHM(st.tradingDayCutoff);
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
    title: 'Prop firm backtest',
    icon: 'propfirm.backtest',
    order: 30,
    width: 360,
    resizable: true,
    minWidth: 300,
    maxWidth: 560,
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
