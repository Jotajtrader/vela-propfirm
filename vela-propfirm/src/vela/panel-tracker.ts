// El "Tracker": Panel de control (comprar + monitorear cada cuenta — primera pestaña, funciona en
// cualquier modo), Registro (log cronológico de una cuenta elegida), Equity (curva del negocio con
// fechas reales + drawdown + tasas) y Configuración (datos/instrumento/comisión/corte de jornada).
// En los modos challenge/colchón, Registro y Equity se reemplazan por un solo porcentaje. Side
// panel overlay ancho: el chart sigue vivo detrás y el dock exclusivo hace de "pestaña" frente al
// panel Backtest.
import { registerIcon, registerSidePanel, registerWidgetAction, type WidgetContext } from '@luxalgo/vela/plugin';
import { NumberInput, Select, injectStyles, svg16 } from '@luxalgo/vela/ui';
import type { Simulator } from '../engine/Simulator';
import type { Account, AccountCategory, Milestone, TradeLogEntry } from '../engine/types';
import { PV } from '../engine/data';
import { money } from '../engine/format';
import { acctCategory, isPayoutEligible, rulesFor, targetBalOf, thresholdOf, tplOf, isPhase } from '../engine/rules';
import { computeTrackerStats, ledgerDrawdownPoints, ledgerEquityPoints, statusBadge, trackerSimpleStats, type LedgerPoint } from '../engine/tracker';
import { getSimulator } from './context';
import { btn, cssVar, ensureStyles, fmtHM, h, hint, labeled, nativeInput, parseHM } from './ui';
import { openBuyDialog } from './dialogs/buy';
import { parseCSVAsync } from './csv-async';

export const TRACKER_ID = 'propfirm.tracker';

const CSS = `
.pf-trk{display:flex;flex-direction:column;min-height:100%;background:var(--lux-bg)}
.pf-trk .subtabs{display:flex;gap:6px;padding:14px;border-bottom:1px solid var(--lux-border)}
.pf-trk .pane{padding:18px}
.pf-trk .pane.narrow{max-width:640px}
.pf-table{width:100%;border-collapse:collapse;font-size:12px}
.pf-table th{text-align:left;color:var(--lux-fg-subtle);font-weight:600;font-size:10px;letter-spacing:.14em;text-transform:uppercase;
  padding:10px;border-bottom:1px solid var(--lux-border);position:sticky;top:0;background:var(--lux-bg)}
.pf-table td{padding:10px;border-bottom:1px solid var(--lux-border);font-family:var(--lux-mono);font-variant-numeric:tabular-nums;color:var(--lux-fg)}
.pf-table tr:hover td{background:var(--lux-bg-2)}
.pf-table tr.ms td{background:var(--lux-accent-soft);border-left:2px solid var(--lux-accent);font-family:var(--vela-font-family,system-ui)}
.pf-stats{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:14px}
.pf-stat{background:var(--lux-bg-2);border:1px solid var(--lux-border);border-radius:var(--lux-radius-lg);padding:16px;display:flex;flex-direction:column;gap:6px}
.pf-stat .num{font:700 26px/1 var(--lux-mono);margin:0;font-variant-numeric:tabular-nums;color:var(--lux-fg)}
.pf-stat.span{grid-column:1/3}
.pf-eq{width:100%;height:340px;display:block;background:var(--lux-bg-2);border:1px solid var(--lux-border);border-radius:var(--lux-radius-lg)}
.pf-dd{width:100%;height:160px;display:block;background:var(--lux-bg-2);border:1px solid var(--lux-border);border-radius:var(--lux-radius-lg)}
.pf-tip{position:absolute;z-index:4;pointer-events:none;background:var(--lux-bg-3);border:1px solid var(--lux-border-strong);border-radius:var(--lux-radius-md);
  padding:8px 11px;font-size:11.5px;line-height:1.6;white-space:nowrap;box-shadow:0 12px 32px rgba(0,0,0,.55);color:var(--lux-fg)}
.pf-tip .r{display:flex;justify-content:space-between;gap:16px} .pf-tip .k{color:var(--lux-fg-muted)}
.pf-simple{text-align:center;padding:48px 20px}
.pf-simple .big{font:700 56px/1 var(--lux-mono);margin:16px 0}
.pf-trk .canvaswrap{position:relative}
.pf-control-head{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:14px}
.pf-log-head{display:flex;align-items:center;gap:10px;margin-bottom:14px}
`;

registerIcon('propfirm.tracker', svg16('<path d="M3 3.5h10M3 8h10M3 12.5h6"/><circle cx="12.5" cy="12.5" r="1.2"/>'));

registerWidgetAction({
    id: 'propfirm.open-tracker',
    target: 'topbar',
    label: 'Centro de control',
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
const INSTRUMENTS = Object.keys(PV).map((k) => ({ value: k, label: `${k} ($${PV[k]}/pt)` }));

type SubTab = 'control' | 'log' | 'equity' | 'config';

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

/** `HH:mm` si el rango cabe en un día, si no `DD/MM`. */
function fmtAxisDate(ms: number, spanMs: number): string {
    const d = new Date(ms);
    if (spanMs <= 86_400_000) return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function nearestPointIndex(pts: readonly LedgerPoint[], t: number): number {
    let best = 0;
    let bestDiff = Infinity;
    for (let i = 0; i < pts.length; i++) {
        const diff = Math.abs(pts[i]!.time - t);
        if (diff < bestDiff) {
            bestDiff = diff;
            best = i;
        }
    }
    return best;
}

function mountTracker(ctx: WidgetContext, sim: Simulator, body: HTMLElement): () => void {
    const doc = body.ownerDocument;
    ensureStyles(doc);
    injectStyles('propfirm-tracker', CSS, doc);
    const st = sim.state;
    let subTab: SubTab = 'control';
    let catFilter: AccountCategory = 'challenge';
    let logSelAcct: string | null = null;

    const root = h('div', 'pf pf-trk pf-panel');
    const subtabs = h('div', 'subtabs');
    const tabControl = btn('🎛 Panel de control', () => {
        subTab = 'control';
        paint();
    });
    const tabLog = btn('📋 Registro', () => {
        subTab = 'log';
        paint();
    });
    const tabEq = btn('📉 Equity', () => {
        subTab = 'equity';
        paint();
    });
    const tabConfig = btn('⚙ Configuración', () => {
        subTab = 'config';
        paint();
    });
    subtabs.append(tabControl, tabLog, tabEq, tabConfig);

    // ── Panel de control ──────────────────────────────────────────────────────────────
    const paneControl = h('div', 'pane');
    const ctrlHead = h('div', 'pf-control-head');
    ctrlHead.append(h('h3', undefined, 'Cuentas de la corrida'), btn('+ Comprar cuentas', () => openBuyDialog(ctx, sim), 'on'));
    (ctrlHead.firstChild as HTMLElement).style.cssText = 'margin:0;font-size:13px';
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
    const ctrlList = h('div', 'pf-list');
    ctrlList.style.maxHeight = 'none';
    ctrlList.style.marginTop = '10px';
    paneControl.append(ctrlHead, catTabs, ctrlList);

    // ── Registro ──────────────────────────────────────────────────────────────────────
    const paneLog = h('div', 'pane');
    const logHead = h('div', 'pf-log-head');
    const logSelectLabel = h('span', 'lbl', 'Cuenta');
    let logSelectEl: HTMLElement = h('div'); // placeholder — reemplazado en el primer paintLogSelect()
    let logSelectCtrl: Select | null = null;
    logHead.append(logSelectLabel, logSelectEl);
    const logBody = h('div');
    paneLog.append(logHead, logBody);

    // ── Equity ────────────────────────────────────────────────────────────────────────
    const paneEq = h('div', 'pane');
    const eqWrap = h('div', 'canvaswrap');
    const eqCv = h('canvas', 'pf-eq');
    const tip = h('div', 'pf-tip');
    tip.hidden = true;
    eqWrap.append(eqCv, tip);
    const ddTitle = h('div', 'mini', 'DRAWDOWN (profundidad bajo el pico previo)');
    ddTitle.style.margin = '10px 0 4px';
    const ddCv = h('canvas', 'pf-dd');
    const statsBox = h('div');
    paneEq.append(eqWrap, ddTitle, ddCv, statsBox);

    const paneSimple = h('div', 'pane');

    // ── Configuración ─────────────────────────────────────────────────────────────────
    const paneConfig = h('div', 'pane narrow');
    const sData = h('div');
    sData.appendChild(h('h3', undefined, 'Datos'));
    (sData.firstChild as HTMLElement).style.cssText = 'margin:0 0 10px;font-size:13px';
    const csvFile = nativeInput('file');
    csvFile.accept = '.csv,.txt';
    csvFile.hidden = true;
    const csvBtn = btn('Cargar CSV', () => csvFile.click());
    // Un CSV de años de datos intradía (cientos de miles de líneas) parseado de una sola pasada
    // bloqueaba el hilo principal varios segundos seguidos — el navegador terminaba mostrando
    // "Page Unresponsive". parseCSVAsync() reusa parseCSV() tal cual (misma lógica, sin tocarla)
    // pero de a pedazos, cediendo el control entre cada uno.
    csvFile.addEventListener('change', () => {
        const f = csvFile.files?.[0];
        if (!f) return;
        const r = new FileReader();
        r.onload = async () => {
            csvBtn.disabled = true;
            try {
                const bars = await parseCSVAsync(String(r.result), st.tradingDayCutoff, (done, total) => {
                    csvBtn.textContent = `Cargando… ${Math.round((done / total) * 100)}%`;
                });
                sim.loadBars(bars);
            } finally {
                csvBtn.disabled = false;
                csvBtn.textContent = 'Cargar CSV';
            }
        };
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
        csvBtn,
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
    cfg.style.marginTop = '8px';
    cfg.append(labeled('Instrumento', instr.el), labeled('Comis/lado', comm.el), labeled('Cierre jornada', cutoff));
    sData.append(dataRow, csvFile, sessFile, cfg, hint('Formato CSV: datetime,open,high,low,close[,volume] — 1 fila por barra, datetime ISO o YYYY-MM-DD HH:MM. Con el corte de jornada, la sesión nocturna queda del lado del día de trading siguiente.'));
    paneConfig.appendChild(sData);

    root.append(subtabs, paneControl, paneLog, paneEq, paneSimple, paneConfig);
    body.appendChild(root);

    let eqProj: { pts: LedgerPoint[]; X: (t: number) => number; padL: number; plotW: number; w: number } | null = null;
    eqCv.addEventListener('mousemove', (e) => {
        if (!eqProj || eqProj.pts.length < 2) return void (tip.hidden = true);
        const r = eqCv.getBoundingClientRect();
        const mx = e.clientX - r.left;
        const my = e.clientY - r.top;
        if (mx < eqProj.padL) return void (tip.hidden = true);
        const t0 = eqProj.pts[0]!.time;
        const t1 = eqProj.pts[eqProj.pts.length - 1]!.time;
        const targetT = t0 + ((mx - eqProj.padL) / eqProj.plotW) * (t1 - t0);
        const i = nearestPointIndex(eqProj.pts, targetT);
        if (i < 1) return void (tip.hidden = true);
        // el punto i-1 (baseline) no tiene entrada de ledger propia; el ledger real empieza en i=1
        const entry = st.ledger.filter((l) => l.time != null)[i - 1];
        if (!entry) return void (tip.hidden = true);
        tip.replaceChildren();
        for (const [k, v] of [
            ['Fecha', new Date(eqProj.pts[i]!.time).toLocaleString()],
            ['Cuenta', entry.acc || '—'],
            ['Tipo', entry.type],
            ['Monto', `${entry.amount >= 0 ? '+' : ''}${money(entry.amount)}`],
            ['Acumulado', money(eqProj.pts[i]!.cum)],
        ]) {
            const row = h('div', 'r');
            row.append(h('span', 'k', k), h('span', undefined, v));
            tip.appendChild(row);
        }
        let leftPx = mx + 14;
        if (leftPx + 170 > eqProj.w) leftPx = mx - 180;
        tip.style.left = `${leftPx}px`;
        tip.style.top = `${my + 14}px`;
        tip.hidden = false;
    });
    eqCv.addEventListener('mouseleave', () => (tip.hidden = true));

    function acctCard(list: HTMLElement, acc: Account, onClick: (acc: Account) => void): HTMLElement {
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

        let div = list.querySelector<HTMLElement>(`[data-accid="${acc.id}"]`);
        if (!div) {
            div = h('div');
            div.dataset.accid = acc.id;
            div.addEventListener('click', (e) => {
                if ((e.target as HTMLElement).closest('button')) return;
                onClick(acc);
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

    function paintControl(): void {
        const counts = { challenge: 0, funded: 0, paid: 0, blown: 0 };
        for (const a of st.accounts) counts[acctCategory(a)]++;
        CATS.forEach((c, i) => {
            catBtns[i]!.classList.toggle('on', c.cat === catFilter);
            (catBtns[i]!.querySelector('.cnt') as HTMLElement).textContent = String(counts[c.cat]);
        });
        const visible = st.accounts.filter((a) => acctCategory(a) === catFilter);
        if (!visible.length) {
            ctrlList.replaceChildren(hint('Sin cuentas en esta categoría.'));
            return;
        }
        if (ctrlList.firstElementChild && !(ctrlList.firstElementChild as HTMLElement).dataset.accid) ctrlList.replaceChildren();
        const seen = new Set<string>();
        for (const acc of visible) {
            seen.add(acc.id);
            ctrlList.appendChild(
                acctCard(ctrlList, acc, (a) => {
                    sim.selectAccount(a.id); // esta pasa a ser también la cuenta operativa del panel Backtest
                    logSelAcct = a.id;
                    paint();
                }),
            );
        }
        for (const el of [...ctrlList.children]) if ((el as HTMLElement).dataset.accid && !seen.has((el as HTMLElement).dataset.accid!)) el.remove();
    }

    let logSelectOptKey = '';
    function paintLogSelect(): void {
        if (logSelAcct == null && st.selAcct) logSelAcct = st.selAcct; // arranca alineado a la cuenta operativa
        const options = [{ value: '', label: '— elegí una cuenta —' }, ...st.accounts.map((a) => ({ value: a.id, label: `${a.name} — ${statusBadge(a).text}` }))];
        // El kit no permite reemplazar options in-place: se reconstruye el Select si cambió el set de cuentas.
        const key = options.map((o) => o.value).join(',');
        if (key !== logSelectOptKey) {
            logSelectOptKey = key;
            const fresh = new Select({
                options,
                value: logSelAcct ?? '',
                size: 'sm',
                fill: true,
                onChange: (v) => {
                    logSelAcct = v || null;
                    paint();
                },
            });
            logSelectEl.replaceWith(fresh.el);
            logSelectEl = fresh.el;
            logSelectCtrl = fresh;
        } else {
            logSelectCtrl?.setValue(logSelAcct ?? '');
        }
    }

    function paintLog(): void {
        paintLogSelect();
        const acc = st.accounts.find((a) => a.id === logSelAcct);
        if (!acc) return void logBody.replaceChildren(hint('Elegí una cuenta arriba para ver qué ATM se ejecutó, a qué hora y con qué resultado.'));
        const title = h('h3', undefined, `${acc.name} — ${acc.tradeLog.length} operacion${acc.tradeLog.length === 1 ? '' : 'es'}`);
        title.style.cssText = 'margin:0 0 10px;font-size:13px';
        const milestones = acc.milestones || [];
        if (!acc.tradeLog.length && !milestones.length) return void logBody.replaceChildren(title, hint('Todavía no tiene operaciones ni hitos registrados.'));
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
        logBody.replaceChildren(title, table);
    }

    function paintEquity(): void {
        const { g, w, h: hgt } = fitCanvas(eqCv);
        g.clearRect(0, 0, w, hgt);
        const font = cssVar(eqCv, '--vela-font-family', 'system-ui');
        const muted = cssVar(eqCv, '--lux-fg-muted', '#8f8f8f');
        const grid = cssVar(eqCv, '--lux-border', 'rgba(255,255,255,.08)');
        const up = cssVar(eqCv, '--lux-up', '#089981');
        const down = cssVar(eqCv, '--lux-down', '#f23645');
        const padL = 64;
        const padR = 16;
        const padT = 16;
        const padB = 22;
        const plotW = w - padL - padR;
        const plotH = hgt - padT - padB;
        const pts = ledgerEquityPoints(st.ledger);
        eqProj = null;
        g.font = `12px ${font}`;
        if (pts.length < 2) {
            g.fillStyle = muted;
            g.fillText('Sin movimientos todavía en el negocio', padL, padT + 20);
            return;
        }
        const cums = pts.map((p) => p.cum);
        let mn = Math.min(0, ...cums);
        let mx = Math.max(0, ...cums);
        if (mx === mn) mx = mn + 1;
        const t0 = pts[0]!.time;
        const t1 = pts[pts.length - 1]!.time;
        const spanMs = Math.max(1, t1 - t0);
        const X = (t: number): number => padL + ((t - t0) / spanMs) * plotW;
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
        // eje X: fechas reales, ~6 marcas
        for (let k = 0; k <= 6; k++) {
            const t = t0 + (spanMs * k) / 6;
            const x = X(t);
            g.fillText(fmtAxisDate(t, spanMs), Math.min(x, padL + plotW - 30), padT + plotH + 14);
        }
        g.strokeStyle = muted;
        g.beginPath();
        g.moveTo(padL, Y(0));
        g.lineTo(padL + plotW, Y(0));
        g.stroke();
        const last = cums[cums.length - 1]!;
        g.strokeStyle = last >= 0 ? up : down;
        g.lineWidth = 1.8;
        g.beginPath();
        pts.forEach((p, i) => (i ? g.lineTo(X(p.time), Y(p.cum)) : g.moveTo(X(p.time), Y(p.cum))));
        g.stroke();
        g.fillStyle = g.strokeStyle;
        g.font = `13px ${font}`;
        g.fillText(`${last >= 0 ? '+' : ''}$${Math.round(last).toLocaleString('en-US')}`, padL + 8, padT + 16);
        eqProj = { pts, X, padL, plotW, w };
    }

    function paintDrawdown(): void {
        const { g, w, h: hgt } = fitCanvas(ddCv);
        g.clearRect(0, 0, w, hgt);
        const font = cssVar(ddCv, '--vela-font-family', 'system-ui');
        const muted = cssVar(ddCv, '--lux-fg-muted', '#8f8f8f');
        const grid = cssVar(ddCv, '--lux-border', 'rgba(255,255,255,.08)');
        const down = cssVar(ddCv, '--lux-down', '#f23645');
        const padL = 64;
        const padR = 16;
        const padT = 8;
        const padB = 8;
        const plotW = w - padL - padR;
        const plotH = hgt - padT - padB;
        const pts = ledgerDrawdownPoints(st.ledger);
        if (pts.length < 2) {
            g.fillStyle = muted;
            g.font = `12px ${font}`;
            g.fillText('Sin movimientos todavía', padL, padT + 20);
            return;
        }
        const dds = pts.map((p) => p.cum);
        const mx = Math.max(1, ...dds);
        const t0 = pts[0]!.time;
        const t1 = pts[pts.length - 1]!.time;
        const spanMs = Math.max(1, t1 - t0);
        const X = (t: number): number => padL + ((t - t0) / spanMs) * plotW;
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
        g.moveTo(X(t0), Y(0));
        pts.forEach((p) => g.lineTo(X(p.time), Y(p.cum)));
        g.lineTo(X(t1), Y(0));
        g.closePath();
        g.fill();
        g.strokeStyle = down;
        g.lineWidth = 1.8;
        g.beginPath();
        pts.forEach((p, i) => (i ? g.lineTo(X(p.time), Y(p.cum)) : g.moveTo(X(p.time), Y(p.cum))));
        g.stroke();
        const maxDD = Math.max(...dds);
        const maxIdx = dds.indexOf(maxDD);
        g.fillStyle = down;
        g.font = `13px ${font}`;
        g.fillText(`máx: -$${Math.round(maxDD).toLocaleString('en-US')}`, padL + 8, padT + plotH - 6);
        g.beginPath();
        g.arc(X(pts[maxIdx]!.time), Y(maxDD), 3, 0, Math.PI * 2);
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

    function paintConfig(): void {
        instr.setValue(st.instr);
        cutoff.value = fmtHM(st.tradingDayCutoff);
    }

    let raf = 0;
    function paint(): void {
        raf = 0;
        tabControl.classList.toggle('on', subTab === 'control');
        tabLog.classList.toggle('on', subTab === 'log');
        tabEq.classList.toggle('on', subTab === 'equity');
        tabConfig.classList.toggle('on', subTab === 'config');
        const simpleModeActive = st.simMode !== 'full';
        const showSimple = simpleModeActive && (subTab === 'log' || subTab === 'equity');
        paneControl.hidden = subTab !== 'control';
        paneConfig.hidden = subTab !== 'config';
        paneSimple.hidden = !showSimple;
        paneLog.hidden = showSimple || subTab !== 'log';
        paneEq.hidden = showSimple || subTab !== 'equity';

        if (subTab === 'control') paintControl();
        else if (subTab === 'config') paintConfig();
        else if (showSimple) paintSimple();
        else if (subTab === 'log') paintLog();
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
    title: 'Centro de control',
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
