// El "Tracker" del HTML: cuentas de la corrida a la izquierda; a la derecha el registro cronológico
// de la cuenta elegida (operaciones + hitos) o el equity del negocio con su drawdown y las tasas.
// En los modos challenge/colchón muestra un solo porcentaje. Es un side panel overlay ancho: el
// chart sigue vivo detrás y el dock exclusivo hace de "pestaña" frente al panel Backtest.
import { registerIcon, registerSidePanel, registerWidgetAction, type WidgetContext } from '@luxalgo/vela/plugin';
import { injectStyles, svg16 } from '@luxalgo/vela/ui';
import type { Simulator } from '../engine/Simulator';
import type { Account, AccountCategory, Milestone, TradeLogEntry } from '../engine/types';
import { money } from '../engine/format';
import { acctCategory, tplOf } from '../engine/rules';
import { computeTrackerStats, ledgerDrawdownSeries, ledgerEquitySeries, statusBadge, trackerSimpleStats } from '../engine/tracker';
import { getSimulator } from './context';
import { btn, cssVar, ensureStyles, h, hint } from './ui';

export const TRACKER_ID = 'propfirm.tracker';

const CSS = `
.pf-trk{display:flex;align-items:stretch;min-height:100%}
.pf-trk .left{flex:0 0 270px;max-width:270px;border-right:1px solid var(--vela-border-soft);padding:10px;position:sticky;top:0;align-self:flex-start;max-height:calc(100vh - 140px);overflow-y:auto}
.pf-trk .left .pf-tabs{flex-wrap:wrap} .pf-trk .left .pf-tabs .pf-btn{flex:1 1 45%}
.pf-trk .right{flex:1;min-width:0;display:flex;flex-direction:column}
.pf-trk .subtabs{display:flex;gap:4px;padding:8px 12px;border-bottom:1px solid var(--vela-border-soft)}
.pf-trk .pane{padding:14px;position:relative}
.pf-table{width:100%;border-collapse:collapse;font-size:11px}
.pf-table th{text-align:left;color:var(--vela-fg-muted);font-weight:normal;padding:6px 8px;border-bottom:1px solid var(--vela-border-soft);position:sticky;top:0;background:var(--vela-surface,var(--vela-bg))}
.pf-table td{padding:5px 8px;border-bottom:1px solid var(--vela-border-soft);font-variant-numeric:tabular-nums}
.pf-table tr:hover td{background:color-mix(in srgb,var(--vela-fg) 5%,transparent)}
.pf-table tr.ms td{background:color-mix(in srgb,var(--vela-accent) 10%,transparent);border-left:3px solid var(--vela-accent);padding:7px 8px}
.pf-stats{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:14px}
.pf-stat{background:var(--vela-surface-raised,transparent);border:1px solid var(--vela-border-soft);border-radius:var(--vela-radius-md);padding:14px}
.pf-stat .num{font-size:26px;font-weight:700;margin:4px 0;font-variant-numeric:tabular-nums}
.pf-stat.span{grid-column:1/3}
.pf-eq{width:100%;height:340px;display:block;background:var(--vela-surface,transparent);border:1px solid var(--vela-border-soft);border-radius:var(--vela-radius-md)}
.pf-dd{width:100%;height:160px;display:block;background:var(--vela-surface,transparent);border:1px solid var(--vela-border-soft);border-radius:var(--vela-radius-md)}
.pf-tip{position:absolute;z-index:4;pointer-events:none;background:var(--vela-surface-overlay);border:1px solid var(--vela-border-soft);border-radius:var(--vela-radius-md);padding:6px 10px;font-size:11px;line-height:1.55;white-space:nowrap;box-shadow:0 3px 10px rgba(0,0,0,.4)}
.pf-tip .r{display:flex;justify-content:space-between;gap:14px} .pf-tip .k{color:var(--vela-fg-muted)}
.pf-simple{text-align:center;padding:40px 20px}
.pf-simple .big{font-size:56px;font-weight:700;margin:14px 0}
`;

registerIcon('propfirm.tracker', svg16('<path d="M3 3.5h10M3 8h10M3 12.5h6"/><circle cx="12.5" cy="12.5" r="1.2"/>'));

registerWidgetAction({
    id: 'propfirm.open-tracker',
    target: 'topbar',
    label: 'Tracker',
    icon: 'propfirm.tracker',
    align: 'left',
    order: 11,
    run: (ctx) => ctx.togglePanel(TRACKER_ID),
});

const CATS: { cat: AccountCategory; label: string }[] = [
    { cat: 'challenge', label: 'Challenge' },
    { cat: 'funded', label: 'Fondeadas' },
    { cat: 'paid', label: 'Cobradas' },
    { cat: 'blown', label: 'Quemadas' },
];

const fmtT = (iso: string | null): string => (iso ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : '—');

function milestoneLabel(m: Milestone): string {
    if (m.type === 'approved') return `✅ CHALLENGE APROBADO — balance ${money(m.balance)}`;
    if (m.type === 'cushion') return `🛏️ COLCHÓN LOGRADO — balance ${money(m.balance)}`;
    if (m.type === 'payout') {
        const cierre = m.closed ? ' — cuenta cerrada' : '';
        return `💰 PAYOUT COBRADO — retiro ${money(m.withdrawal ?? 0)} (cobrás ${money(m.cashToTrader ?? 0)} tras split) — balance ${money(m.balanceBefore ?? 0)} → ${money(m.balance)}${cierre}`;
    }
    return '';
}

function fitCanvas(cv: HTMLCanvasElement): { g: CanvasRenderingContext2D; w: number; h: number } {
    const dpr = window.devicePixelRatio || 1;
    const r = cv.getBoundingClientRect();
    cv.width = Math.max(1, r.width * dpr);
    cv.height = Math.max(1, r.height * dpr);
    const g = cv.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { g, w: r.width, h: r.height };
}

function mountTracker(ctx: WidgetContext, sim: Simulator, body: HTMLElement): () => void {
    const doc = body.ownerDocument;
    ensureStyles(doc);
    injectStyles('propfirm-tracker', CSS, doc);
    const st = sim.state;
    let catFilter: AccountCategory = 'challenge';
    let subTab: 'log' | 'equity' = 'log';
    let selAcct: string | null = null;

    const root = h('div', 'pf pf-trk');
    // ── izquierda: cuentas de la corrida ──
    const left = h('div', 'left');
    left.appendChild(h('h3', undefined, 'Cuentas de la corrida'));
    (left.firstChild as HTMLElement).style.cssText = 'margin:0 0 8px;font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--vela-fg-muted)';
    const catTabs = h('div', 'pf-tabs');
    const catBtns = CATS.map((c) => {
        const b = btn('', () => {
            catFilter = c.cat;
            paint();
        }, 'tab');
        b.append(doc.createTextNode(c.label + ' '), h('span', 'cnt', '0'));
        return b;
    });
    catTabs.append(...catBtns);
    const list = h('div', 'pf-list');
    list.style.maxHeight = 'none';
    list.style.marginTop = '8px';
    left.append(catTabs, list);

    // ── derecha ──
    const right = h('div', 'right');
    const subtabs = h('div', 'subtabs');
    const tabLog = btn('📋 Registro', () => {
        subTab = 'log';
        paint();
    });
    const tabEq = btn('📉 Equity', () => {
        subTab = 'equity';
        paint();
    });
    subtabs.append(tabLog, tabEq);
    const paneLog = h('div', 'pane');
    const paneEq = h('div', 'pane');
    const eqCv = h('canvas', 'pf-eq');
    const tip = h('div', 'pf-tip');
    tip.hidden = true;
    const ddTitle = h('div', 'mini', 'DRAWDOWN (profundidad bajo el pico previo)');
    ddTitle.style.margin = '10px 0 4px';
    const ddCv = h('canvas', 'pf-dd');
    const statsBox = h('div');
    paneEq.append(eqCv, tip, ddTitle, ddCv, statsBox);
    const paneSimple = h('div', 'pane');
    right.append(subtabs, paneLog, paneEq, paneSimple);
    root.append(left, right);
    body.appendChild(root);

    let eqProj: { X: (i: number) => number; pts: number[]; padL: number; plotW: number; w: number } | null = null;
    eqCv.addEventListener('mousemove', (e) => {
        if (!eqProj) return void (tip.hidden = true);
        const r = eqCv.getBoundingClientRect();
        const mx = e.clientX - r.left;
        const my = e.clientY - r.top;
        const i = Math.round(((mx - eqProj.padL) / eqProj.plotW) * (eqProj.pts.length - 1));
        if (i < 1 || i >= eqProj.pts.length || mx < eqProj.padL) return void (tip.hidden = true);
        const entry = st.ledger[i - 1]!;
        tip.replaceChildren();
        for (const [k, v] of [
            ['Cuenta', entry.acc || '—'],
            ['Tipo', entry.type],
            ['Monto', `${entry.amount >= 0 ? '+' : ''}${money(entry.amount)}`],
            ['Acumulado', money(eqProj.pts[i]!)],
        ]) {
            const row = h('div', 'r');
            row.append(h('span', 'k', k), h('span', undefined, v));
            tip.appendChild(row);
        }
        let leftPx = mx + 14;
        if (leftPx + 160 > eqProj.w) leftPx = mx - 170;
        tip.style.left = `${leftPx + eqCv.offsetLeft}px`;
        tip.style.top = `${my + 14 + eqCv.offsetTop}px`;
        tip.hidden = false;
    });
    eqCv.addEventListener('mouseleave', () => (tip.hidden = true));

    function paintList(): void {
        const counts = { challenge: 0, funded: 0, paid: 0, blown: 0 };
        for (const a of st.accounts) counts[acctCategory(a)]++;
        CATS.forEach((c, i) => {
            catBtns[i]!.classList.toggle('on', c.cat === catFilter);
            (catBtns[i]!.querySelector('.cnt') as HTMLElement).textContent = String(counts[c.cat]);
        });
        const visible = st.accounts.filter((a) => acctCategory(a) === catFilter);
        if (!visible.length) return void list.replaceChildren(hint('Sin cuentas en esta categoría todavía.'));
        if (list.firstElementChild && !(list.firstElementChild as HTMLElement).dataset.accid) list.replaceChildren();
        const seen = new Set<string>();
        for (const acc of visible) {
            seen.add(acc.id);
            let div = list.querySelector<HTMLElement>(`[data-accid="${acc.id}"]`);
            if (!div) {
                div = h('div');
                div.dataset.accid = acc.id;
                div.addEventListener('click', () => {
                    selAcct = acc.id;
                    paint();
                });
            }
            div.className = `pf-card${acc.id === selAcct ? ' sel' : ''}`;
            const badge = statusBadge(acc);
            const top = h('div', 'top');
            top.append(h('span', 'nm', acc.name), h('span', `pf-badge ${badge.cls}`, badge.text));
            const tpl = tplOf(st, acc);
            const bal = h('div', 'kv');
            bal.append(h('span', 'mini', 'Balance'), h('span', 'mini', money(acc.balance)));
            div.replaceChildren(top, h('div', 'mini', tpl ? tpl.name : '(plantilla eliminada)'), bal, h('div', 'mini', `${acc.tradeLog.length} operacion${acc.tradeLog.length === 1 ? '' : 'es'}`));
            list.appendChild(div);
        }
        for (const el of [...list.children]) if ((el as HTMLElement).dataset.accid && !seen.has((el as HTMLElement).dataset.accid!)) el.remove();
    }

    function paintLog(): void {
        const acc = st.accounts.find((a) => a.id === selAcct);
        if (!acc) return void paneLog.replaceChildren(hint('Seleccioná una cuenta de la izquierda para ver qué ATM se ejecutó, a qué hora y con qué resultado.'));
        const title = h('h3', undefined, `${acc.name} — ${acc.tradeLog.length} operacion${acc.tradeLog.length === 1 ? '' : 'es'}`);
        title.style.cssText = 'margin:0 0 10px;font-size:13px';
        const milestones = acc.milestones || [];
        if (!acc.tradeLog.length && !milestones.length) return void paneLog.replaceChildren(title, hint('Todavía no tiene operaciones ni hitos registrados.'));
        type Row = { kind: 'trade'; time: string | null; data: TradeLogEntry } | { kind: 'milestone'; time: string | null; data: Milestone };
        const rows: Row[] = [
            ...acc.tradeLog.map((t): Row => ({ kind: 'trade', time: t.exitTime, data: t })),
            ...milestones.map((m): Row => ({ kind: 'milestone', time: m.time, data: m })),
        ].sort((a, b) => new Date(a.time || 0).getTime() - new Date(b.time || 0).getTime());
        const table = h('table', 'pf-table');
        const thead = h('thead');
        const hr = h('tr');
        for (const c of ['Hora', 'ATM', 'Lado', 'Entrada', 'Salida', 'Resultado', 'Balance', 'Motivo']) hr.appendChild(h('th', undefined, c));
        thead.appendChild(hr);
        const tbody = h('tbody');
        for (let i = rows.length - 1; i >= 0; i--) {
            const r = rows[i]!;
            const tr = h('tr');
            if (r.kind === 'milestone') {
                tr.className = 'ms';
                const td = h('td');
                td.colSpan = 8;
                td.textContent = `${fmtT(r.time)} · ${milestoneLabel(r.data)}`;
                tr.appendChild(td);
            } else {
                const t = r.data;
                tr.append(
                    h('td', undefined, fmtT(t.exitTime)),
                    h('td', undefined, t.atmName || 'Manual'),
                    h('td', t.side > 0 ? 'pos' : 'neg', `${t.side > 0 ? 'LONG' : 'SHORT'} ${t.qty}`),
                    h('td', undefined, t.entry.toFixed(2)),
                    h('td', undefined, t.exit.toFixed(2)),
                    h('td', t.pnl >= 0 ? 'pos' : 'neg', `${t.pnl >= 0 ? '+' : ''}${money(t.pnl)}`),
                    h('td', undefined, t.balance != null ? money(t.balance) : '—'),
                    h('td', undefined, t.reason),
                );
            }
            tbody.appendChild(tr);
        }
        table.append(thead, tbody);
        paneLog.replaceChildren(title, table);
    }

    function paintEquity(): void {
        const { g, w, h: hgt } = fitCanvas(eqCv);
        g.clearRect(0, 0, w, hgt);
        const font = cssVar(eqCv, '--vela-font-family', 'system-ui');
        const muted = cssVar(eqCv, '--vela-fg-muted', '#8892a0');
        const grid = cssVar(eqCv, '--vela-border-soft', '#2a3340');
        const up = cssVar(eqCv, '--vela-up', '#26a65b');
        const down = cssVar(eqCv, '--vela-down', '#e0524f');
        const padL = 56;
        const padR = 16;
        const padT = 16;
        const padB = 8;
        const plotW = w - padL - padR;
        const plotH = hgt - padT - padB;
        const pts = ledgerEquitySeries(st.ledger);
        eqProj = null;
        if (pts.length < 2) {
            g.fillStyle = muted;
            g.font = `12px ${font}`;
            g.fillText('Sin movimientos todavía en el negocio', padL, padT + 20);
            return;
        }
        let mn = Math.min(0, ...pts);
        let mx = Math.max(0, ...pts);
        if (mx === mn) mx = mn + 1;
        const X = (i: number): number => padL + (i / (pts.length - 1)) * plotW;
        const Y = (v: number): number => padT + plotH - ((v - mn) / (mx - mn)) * plotH;
        g.strokeStyle = grid;
        g.fillStyle = muted;
        g.font = `10px ${font}`;
        g.lineWidth = 1;
        for (let k = 0; k <= 6; k++) {
            const v = mn + ((mx - mn) * k) / 6;
            const y = Y(v);
            g.beginPath();
            g.moveTo(padL, y);
            g.lineTo(padL + plotW, y);
            g.stroke();
            g.fillText(`$${Math.round(v).toLocaleString('en-US')}`, 4, y + 3);
        }
        g.strokeStyle = muted;
        g.beginPath();
        g.moveTo(padL, Y(0));
        g.lineTo(padL + plotW, Y(0));
        g.stroke();
        const last = pts[pts.length - 1]!;
        g.strokeStyle = last >= 0 ? up : down;
        g.lineWidth = 1.8;
        g.beginPath();
        pts.forEach((v, i) => (i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v))));
        g.stroke();
        g.fillStyle = g.strokeStyle;
        g.font = `13px ${font}`;
        g.fillText(`${last >= 0 ? '+' : ''}$${Math.round(last).toLocaleString('en-US')}`, padL + 8, padT + 16);
        eqProj = { X, pts, padL, plotW, w };
    }

    function paintDrawdown(): void {
        const { g, w, h: hgt } = fitCanvas(ddCv);
        g.clearRect(0, 0, w, hgt);
        const font = cssVar(ddCv, '--vela-font-family', 'system-ui');
        const muted = cssVar(ddCv, '--vela-fg-muted', '#8892a0');
        const grid = cssVar(ddCv, '--vela-border-soft', '#2a3340');
        const down = cssVar(ddCv, '--vela-down', '#e0524f');
        const padL = 56;
        const padR = 16;
        const padT = 8;
        const padB = 8;
        const plotW = w - padL - padR;
        const plotH = hgt - padT - padB;
        const dd = ledgerDrawdownSeries(st.ledger);
        if (dd.length < 2) {
            g.fillStyle = muted;
            g.font = `12px ${font}`;
            g.fillText('Sin movimientos todavía', padL, padT + 20);
            return;
        }
        const mx = Math.max(1, ...dd);
        const X = (i: number): number => padL + (i / (dd.length - 1)) * plotW;
        const Y = (v: number): number => padT + (v / mx) * plotH; // eje invertido: 0 arriba
        g.strokeStyle = grid;
        g.fillStyle = muted;
        g.font = `10px ${font}`;
        g.lineWidth = 1;
        for (let k = 0; k <= 4; k++) {
            const v = (mx * k) / 4;
            const y = Y(v);
            g.beginPath();
            g.moveTo(padL, y);
            g.lineTo(padL + plotW, y);
            g.stroke();
            g.fillText(`-$${Math.round(v).toLocaleString('en-US')}`, 4, y + 3);
        }
        g.fillStyle = 'rgba(224,82,79,0.18)';
        g.beginPath();
        g.moveTo(X(0), Y(0));
        dd.forEach((v, i) => g.lineTo(X(i), Y(v)));
        g.lineTo(X(dd.length - 1), Y(0));
        g.closePath();
        g.fill();
        g.strokeStyle = down;
        g.lineWidth = 1.8;
        g.beginPath();
        dd.forEach((v, i) => (i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v))));
        g.stroke();
        const maxDD = Math.max(...dd);
        const maxIdx = dd.indexOf(maxDD);
        g.fillStyle = down;
        g.font = `13px ${font}`;
        g.fillText(`máx: -$${Math.round(maxDD).toLocaleString('en-US')}`, padL + 8, padT + plotH - 6);
        g.beginPath();
        g.arc(X(maxIdx), Y(maxDD), 3, 0, Math.PI * 2);
        g.fill();
    }

    function paintStats(): void {
        const s = computeTrackerStats(st);
        const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;
        const card = (title: string, num: string, foot: string, cls = ''): HTMLElement => {
            const c = h('div', `pf-stat${cls ? ' ' + cls : ''}`);
            c.append(h('div', 'mini', title), h('div', 'num', num), h('div', 'mini', foot));
            return c;
        };
        const grid = h('div', 'pf-stats');
        grid.append(
            card('Tasa de aprobación (challenge → fondeada)', pct(s.approvalRate), `${s.everFundedCount} / ${s.total} cuentas compradas`),
            card('Tasa de payout (compradas → cobran algo)', pct(s.payoutRate), `${s.payoutCount} / ${s.total} cuentas compradas`),
            card('Tasa de colchón (fondeadas → logran el objetivo de día 1)', pct(s.cushionRate), `${s.cushionCount} / ${s.everFundedCount} cuentas fondeadas`),
            card('Tasa de extracción (con colchón → cobran algo)', pct(s.extractionRate), `${s.extractionCount} / ${s.cushionCount} cuentas con colchón`),
        );
        const ev = card('Esperanza matemática por cuenta comprada', `${s.evPerAccount >= 0 ? '+' : ''}${money(s.evPerAccount)}`, `neto total del negocio ${money(s.netTotal)} sobre ${s.total} cuentas compradas`, 'span');
        (ev.querySelector('.num') as HTMLElement).classList.add(s.evPerAccount >= 0 ? 'pos' : 'neg');
        grid.appendChild(ev);
        statsBox.replaceChildren(grid);
    }

    function paintSimple(): void {
        const s = trackerSimpleStats(st);
        const box = h('div', 'pf-simple');
        const t = h('div', 'mini', s.title);
        t.style.cssText = 'text-transform:uppercase;letter-spacing:1px';
        const big = h('div', 'big', s.den > 0 ? `${(s.pct * 100).toFixed(1)}%` : '—%');
        big.style.color = s.pct >= 0.5 ? 'var(--vela-up,#26a65b)' : 'var(--vela-down,#e0524f)';
        const d = hint(s.desc);
        d.style.cssText = 'max-width:420px;margin:18px auto 0';
        box.append(t, big, h('div', 'mini', `${s.num} de ${s.den}${s.den === 0 ? ' (todavía sin datos)' : ''}`), d);
        paneSimple.replaceChildren(box);
    }

    let raf = 0;
    function paint(): void {
        raf = 0;
        paintList();
        const simple = st.simMode !== 'full';
        subtabs.hidden = simple;
        paneSimple.hidden = !simple;
        paneLog.hidden = simple || subTab !== 'log';
        paneEq.hidden = simple || subTab !== 'equity';
        tabLog.classList.toggle('on', subTab === 'log');
        tabEq.classList.toggle('on', subTab === 'equity');
        if (simple) return paintSimple();
        if (subTab === 'log') paintLog();
        else {
            paintEquity();
            paintDrawdown();
            paintStats();
        }
    }
    const refresh = (): void => {
        if (!raf) raf = requestAnimationFrame(paint);
    };
    paint();
    const off = sim.on('change', refresh);
    const ro = new ResizeObserver(refresh);
    ro.observe(body);
    return () => {
        off();
        ro.disconnect();
        if (raf) cancelAnimationFrame(raf);
        root.remove();
    };
}

registerSidePanel({
    id: TRACKER_ID,
    title: 'Tracker',
    icon: 'propfirm.tracker',
    order: 31,
    width: 960,
    resizable: true,
    minWidth: 640,
    maxWidth: 1400,
    overlay: true,
    mount: (ctx, body) => {
        const sim = getSimulator();
        if (!sim) {
            body.appendChild(h('div', 'pf hint', 'No hay un simulador conectado (createPropFirm + attach).'));
            return {};
        }
        let dispose: (() => void) | null = null;
        return {
            onOpen: () => {
                if (!dispose) dispose = mountTracker(ctx, sim, body); // render perezoso: al abrir
            },
            destroy: () => dispose?.(),
        };
    },
});
