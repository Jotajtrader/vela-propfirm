// "Configurar Modo Agente": qué challenge compra, ventana de fechas/horas, cupos, operativa, pausas, esperas.
import type { WidgetContext } from '@luxalgo/vela/plugin';
import { Dialog, NumberInput, Select } from '@luxalgo/vela/ui';
import type { Simulator } from '../../engine/Simulator';
import { btn, ensureStyles, fmtHM, h, isoDate, labeled, nativeInput, parseHM } from '../ui';

export function openAgentDialog(ctx: WidgetContext, sim: Simulator, onApplied?: () => void): void {
    ensureStyles(ctx.host.ownerDocument);
    const st = sim.state;
    const A = st.agent;
    const body = h('div', 'pf body');

    const companies = sim.companies();
    const curTpl = st.templates.find((t) => t.id === A.tplId);
    let company = curTpl ? curTpl.company || 'Sin empresa' : companies[0] || '';
    const tplOptions = () => st.templates.filter((t) => (t.company || 'Sin empresa') === company).map((t) => ({ value: t.id, label: t.name }));
    const tplSelWrap = h('div');
    let tplSel: Select;
    let tplId = A.tplId && tplOptions().some((o) => o.value === A.tplId) ? A.tplId : (tplOptions()[0]?.value ?? '');
    function renderTplSelect(): void {
        const opts = tplOptions();
        tplId = opts.some((o) => o.value === tplId) ? tplId : (opts[0]?.value ?? '');
        tplSel = new Select({ options: opts, value: tplId, size: 'md', fill: true, onChange: (v) => (tplId = v) });
        tplSelWrap.replaceChildren(tplSel.el);
    }
    renderTplSelect();
    const companySel = new Select({
        options: companies.map((c) => ({ value: c, label: c })),
        value: company,
        size: 'md',
        fill: true,
        onChange: (v) => {
            company = v;
            renderTplSelect();
        },
    });
    const what = h('div', 'col');
    const whatGrid = h('div', 'grid2');
    whatGrid.append(labeled('Empresa', companySel.el), labeled('Challenge', tplSelWrap));
    what.append(h('span', 'pf-title', 'Qué challenge compra esta corrida'), h('div', 'hint', 'Por ahora el agente compra un solo tipo por corrida (no mezcla challenges distintos).'), whatGrid);

    const from = nativeInput('date', isoDate(A.dateFrom));
    const to = nativeInput('date', isoDate(A.dateTo));
    const dates = h('div', 'grid2');
    dates.append(labeled('Desde', from), labeled('Hasta', to));
    const start = nativeInput('time', fmtHM(A.startTimeOfDay));
    const end = nativeInput('time', fmtHM(A.endTimeOfDay));
    const times = h('div', 'grid2');
    times.append(labeled('Hora de inicio diaria (opcional)', start), labeled('Hora de cierre diaria (opcional)', end));

    const n = (value: number, step: number, min?: number): NumberInput => new NumberInput({ value, step, min, size: 'md', fill: true, commit: 'blur', steppers: false });
    const challengeTarget = n(A.challengeTarget, 1, 0);
    const maxFunded = n(A.maxFundedActive, 1, 0);
    const maxWaiting = n(A.maxWaiting, 1, 0);
    const cupos = h('div', 'pf-sep col');
    const cuposGrid = h('div', 'grid3');
    cuposGrid.append(labeled('Challenge a mantener', challengeTarget.el), labeled('Máx. fondeadas activas', maxFunded.el), labeled('Máx. en espera', maxWaiting.el));
    cupos.append(h('span', 'pf-title', 'Cupos'), cuposGrid);

    const qty = n(A.qty || 2, 1, 1);
    const oper = h('div', 'pf-sep col');
    oper.append(
        h('span', 'pf-title green', 'Operativa (SL y TP automáticos)'),
        h('div', 'hint', 'El agente no usa presets ATM: en cada trade arriesga lo que la cuenta tenga disponible ese día (lo menor entre el límite diario y el drawdown restante) y apunta a lo que le falte del objetivo. Solo hace falta definir el tamaño de la posición.'),
        labeled('Contratos por operación', qty.el),
    );

    const pC = n(A.profitPauseChallenge, 10);
    const pD1 = n(A.profitPauseFundedDay1, 10);
    const pR = n(A.profitPauseFundedRest, 10);
    const pausa = h('div', 'pf-sep col');
    const pausaGrid = h('div', 'grid3');
    pausaGrid.append(labeled('Challenge', pC.el), labeled('Fondeada día 1', pD1.el), labeled('Fondeada día 2+', pR.el));
    pausa.append(h('span', 'pf-title muted', 'Pausa por profit diario $ (0 = sin freno)'), pausaGrid);

    const wMin = n(A.waitMinMin, 1, 0);
    const wMax = n(A.waitMaxMin, 1, 0);
    const espera = h('div', 'pf-sep col');
    const esperaGrid = h('div', 'grid2');
    esperaGrid.append(labeled('Mínimo', wMin.el), labeled('Máximo', wMax.el));
    espera.append(h('span', 'pf-title muted', 'Espera entre trades (minutos, rango aleatorio)'), esperaGrid);

    body.append(
        what,
        dates,
        times,
        h('div', 'hint', 'Con ambas cargadas, el agente solo opera dentro de esa ventana horaria todos los días — una sesión que arranca fuera de la ventana (ej. domingo a la noche) simplemente nunca entra.'),
        cupos,
        oper,
        pausa,
        espera,
    );

    const dialog = new Dialog({
        title: '🤖 Configurar Modo Agente',
        host: ctx.host,
        closeOnInteractOutside: false,
        className: 'pf-dialog',
        content: (el) => el.appendChild(body),
        footer: (el) => {
            el.className += ' pf-foot';
            el.append(
                btn('Cancelar', () => dialog.hide()),
                btn(
                    'Aplicar y activar',
                    () => {
                        const ok = sim.applyAgentConfig({
                            tplId,
                            dateFrom: from.value ? new Date(`${from.value}T00:00:00`) : null,
                            dateTo: to.value ? new Date(`${to.value}T23:59:59`) : null,
                            startTimeOfDay: parseHM(start.value),
                            endTimeOfDay: parseHM(end.value),
                            challengeTarget: challengeTarget.value,
                            maxFundedActive: maxFunded.value,
                            maxWaiting: maxWaiting.value,
                            profitPauseChallenge: pC.value,
                            profitPauseFundedDay1: pD1.value,
                            profitPauseFundedRest: pR.value,
                            waitMinMin: wMin.value,
                            waitMaxMin: wMax.value,
                            qty: qty.value,
                        });
                        if (ok) {
                            dialog.hide();
                            onApplied?.();
                        }
                    },
                    'on',
                ),
            );
        },
        onOpenChange: (open) => {
            if (!open) setTimeout(() => dialog.destroy(), 0);
        },
    });
    dialog.panel.style.setProperty('--pf-w', '420px');
    dialog.show();
}
