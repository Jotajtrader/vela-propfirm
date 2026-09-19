// El editor de plantillas del HTML: datos generales, fases dinámicas y reglas de fondeada.
import type { WidgetContext } from '@luxalgo/vela/plugin';
import { Dialog, NumberInput, Select, Switch, TextField } from '@luxalgo/vela/ui';
import type { Simulator } from '../../engine/Simulator';
import type { DdType, FundedRules, Phase, Template } from '../../engine/types';
import { newTemplateDraft } from '../../engine/templates';
import { btn, ensureStyles, h, labeled } from '../ui';

const DD_OPTIONS = [
    { value: 'trailing', label: 'Trailing intradía' },
    { value: 'eod-trailing', label: 'Trailing EOD' },
    { value: 'static', label: 'Estático' },
];
const YESNO = [
    { value: '1', label: 'Sí' },
    { value: '0', label: 'No' },
];

const num = (value: number, step: number, onChange: (v: number) => void, min?: number): NumberInput =>
    new NumberInput({ value, step, min, size: 'md', fill: true, commit: 'blur', steppers: false, onChange });

function toggleRow(label: string, checked: boolean, onChange: (v: boolean) => void, control?: HTMLElement): HTMLElement {
    const r = h('div', 'pf-toggrow');
    const sw = new Switch({ size: 'sm', checked, onChange });
    r.append(sw.el, h('span', 'grow', label));
    if (control) r.appendChild(control);
    return r;
}

export function openTemplateDialog(ctx: WidgetContext, sim: Simulator, existing: Template | null, onSaved?: (t: Template) => void): void {
    ensureStyles(ctx.host.ownerDocument);
    const draft: Template = existing ? (JSON.parse(JSON.stringify(existing)) as Template) : newTemplateDraft(sim.state);

    const body = h('div', 'pf body');
    const name = new TextField({ value: draft.name, size: 'md', fill: true, onChange: (v) => (draft.name = v) });
    const company = new TextField({ value: draft.company || '', size: 'md', fill: true, onChange: (v) => (draft.company = v) });
    company.input.placeholder = 'ej: Lucid';
    const dl = h('datalist');
    dl.id = `pf-companies-${Math.random().toString(36).slice(2, 8)}`;
    for (const c of sim.companies()) {
        const o = h('option');
        o.value = c;
        dl.appendChild(o);
    }
    company.input.setAttribute('list', dl.id);
    const g1 = h('div', 'grid2');
    g1.append(labeled('Nombre', name.el), labeled('Empresa', company.el));
    const g2 = h('div', 'grid2');
    g2.append(labeled('Costo $', num(draft.cost, 1, (v) => (draft.cost = v)).el), labeled('Tamaño de cuenta $', num(draft.size, 1000, (v) => (draft.size = v)).el));
    const g3 = h('div', 'grid2');
    g3.append(labeled('Costo de activación $ (se cobra al fondear)', num(draft.activationCost || 0, 1, (v) => (draft.activationCost = v)).el), h('div'));
    const sameDir = toggleRow('Permitir mismo sentido (long/long o short/short) en simultáneo entre cuentas de esta plantilla', !!draft.allowSameDirectionMultiAccount, (v) => (draft.allowSameDirectionMultiAccount = v));
    body.append(g1, g2, g3, dl, sameDir, h('div', 'hint', 'El hedging (sentidos opuestos entre cuentas) nunca está permitido, sea cual sea este valor.'));

    // ── fases ──
    const phasesHead = h('div', 'row pf-sep');
    phasesHead.style.justifyContent = 'space-between';
    const phasesBox = h('div', 'col');
    phasesHead.append(
        h('span', 'pf-title', 'Fases de challenge'),
        btn('+ Agregar fase', () => {
            const last = draft.phases[draft.phases.length - 1]!;
            draft.phases.push(JSON.parse(JSON.stringify(last)) as Phase);
            renderPhases();
        }),
    );
    function phaseCard(p: Phase, idx: number): HTMLElement {
        const card = h('div', 'pf-phase');
        const head = h('div', 'row');
        head.style.justifyContent = 'space-between';
        head.appendChild(h('b', 'mini', `Fase ${idx + 1}`));
        if (draft.phases.length > 1)
            head.appendChild(
                btn('🗑', () => {
                    draft.phases.splice(idx, 1);
                    renderPhases();
                }),
            );
        const a = h('div', 'grid2');
        a.append(labeled('Objetivo $', num(p.target, 100, (v) => (p.target = v)).el), labeled('Drawdown $', num(p.ddAmount, 100, (v) => (p.ddAmount = v)).el));
        const b = h('div', 'grid2');
        b.append(
            labeled('Tipo DD', new Select({ options: DD_OPTIONS, value: p.ddType, size: 'md', fill: true, onChange: (v) => (p.ddType = v as DdType) }).el),
            labeled('Lock DD en inicio', new Select({ options: YESNO, value: p.lockAtStart ? '1' : '0', size: 'md', fill: true, onChange: (v) => (p.lockAtStart = v === '1') }).el),
        );
        const pct = num(p.consistencyPct, 5, (v) => (p.consistencyPct = v));
        pct.el.style.width = '70px';
        pct.input.disabled = !p.consistencyOn;
        card.append(
            head,
            a,
            b,
            labeled('Daily loss $ (0 = off)', num(p.dailyLoss, 50, (v) => (p.dailyLoss = v)).el),
            toggleRow('Consistencia (mejor día ≤ % del total)', p.consistencyOn, (v) => {
                p.consistencyOn = v;
                pct.input.disabled = !v;
            }, pct.el),
        );
        return card;
    }
    function renderPhases(): void {
        phasesBox.replaceChildren(...draft.phases.map(phaseCard));
    }
    renderPhases();

    // ── fondeada ──
    const fundedHead = h('div', 'pf-sep');
    fundedHead.appendChild(h('span', 'pf-title green', 'Reglas en fondeada'));
    const fundedBox = h('div', 'pf-phase');
    function renderFunded(): void {
        const f: FundedRules = draft.funded;
        fundedBox.replaceChildren();
        const a = h('div', 'grid2');
        a.append(labeled('Drawdown $', num(f.ddAmount, 100, (v) => (f.ddAmount = v)).el), labeled('Tipo DD', new Select({ options: DD_OPTIONS, value: f.ddType, size: 'md', fill: true, onChange: (v) => (f.ddType = v as DdType) }).el));
        const b = h('div', 'grid2');
        b.append(
            labeled('Lock DD en inicio', new Select({ options: YESNO, value: f.lockAtStart ? '1' : '0', size: 'md', fill: true, onChange: (v) => (f.lockAtStart = v === '1') }).el),
            labeled('Daily loss $ (0 = off)', num(f.dailyLoss, 50, (v) => (f.dailyLoss = v)).el),
        );
        const cpct = num(f.consistencyPct, 5, (v) => (f.consistencyPct = v));
        cpct.el.style.width = '70px';
        cpct.input.disabled = !f.consistencyOn;
        const c = h('div', 'grid2');
        c.append(labeled('Payout % (del profit retirable)', num(f.payoutPct, 5, (v) => (f.payoutPct = v), 0).el), labeled('Profit split % (lo que TE quedás)', num(f.splitPct, 5, (v) => (f.splitPct = v), 0).el));
        const buf = num(f.buffer, 100, (v) => (f.buffer = v));
        buf.el.style.width = '90px';
        buf.input.disabled = !f.bufferOn;
        const capRow = f.capScheduleOn
            ? (() => {
                  const tf = new TextField({ value: f.capSchedule.join(', '), size: 'md', fill: true, onChange: (v) => (f.capSchedule = (v.match(/[\d.]+/g) || []).map(Number)) });
                  return labeled('Topes por retiro (1º, 2º, 3º…; el último se repite)', tf.el);
              })()
            : labeled('Tope fijo por retiro $ (0 = sin tope)', num(f.payoutCap, 100, (v) => (f.payoutCap = v)).el);
        const d = h('div', 'grid2');
        d.append(
            labeled('Máx. cantidad de retiros (0 = ∞)', num(f.maxPayouts, 1, (v) => (f.maxPayouts = v), 0).el),
            labeled('Cierra cuenta al cobrar', new Select({ options: YESNO, value: f.closeOnPayout ? '1' : '0', size: 'md', fill: true, onChange: (v) => (f.closeOnPayout = v === '1') }).el),
        );
        const elig = h('div', 'pf-sep col');
        const e3 = h('div', 'grid3');
        e3.append(
            labeled('Días mínimos', num(f.minDays, 1, (v) => (f.minDays = v), 0).el),
            labeled('Profit mín. p/día válido', num(f.minDayProfit, 10, (v) => (f.minDayProfit = v)).el),
            labeled('Suma mín. esos días', num(f.minCycleSum, 100, (v) => (f.minCycleSum = v)).el),
        );
        elig.append(h('span', 'pf-title muted', 'Elegibilidad del retiro (0 = sin exigencia)'), e3);
        fundedBox.append(
            a,
            b,
            toggleRow('Consistencia por ciclo de retiro', f.consistencyOn, (v) => {
                f.consistencyOn = v;
                cpct.input.disabled = !v;
            }, cpct.el),
            c,
            toggleRow('Buffer de retiro (piso no retirable)', f.bufferOn, (v) => {
                f.bufferOn = v;
                buf.input.disabled = !v;
            }, buf.el),
            toggleRow('Tope escalonado por retiro (en vez de tope fijo)', f.capScheduleOn, (v) => {
                f.capScheduleOn = v;
                renderFunded();
            }),
            capRow,
            d,
            elig,
        );
    }
    renderFunded();
    body.append(phasesHead, phasesBox, fundedHead, fundedBox);

    const dialog = new Dialog({
        title: existing ? 'Editar plantilla' : 'Nueva plantilla',
        host: ctx.host,
        closeOnInteractOutside: false,
        className: 'pf-dialog',
        content: (el) => el.appendChild(body),
        footer: (el) => {
            el.className += ' pf-foot';
            el.append(
                btn('Cancelar', () => dialog.hide()),
                btn(
                    'Guardar plantilla',
                    () => {
                        if (sim.saveTemplate(draft)) {
                            dialog.hide();
                            onSaved?.(draft);
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
    dialog.panel.style.setProperty('--pf-w', '460px');
    dialog.show();
}
