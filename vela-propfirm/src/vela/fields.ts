// Un campo numérico con un selector de unidad "Pts"/"$" al lado — el motor siempre trabaja en
// PUNTOS (así arma las órdenes y los ATM), esto es puramente de visualización/edición: cambiar la
// unidad solo reformatea el número mostrado (pts × qty × valor del punto = dólares), nunca cambia
// lo que representa. Se usa en el panel de orden y en el editor de ATM.
import { NumberInput } from '@luxalgo/vela/ui';
import { h } from './ui';

export type ValueUnit = 'pts' | 'usd';

export interface PointsUsdField {
    el: HTMLElement;
    /** El valor canónico, siempre en puntos. */
    getPoints(): number;
    /** Fija el valor (en puntos) y reformatea según la unidad activa — no dispara onChange. */
    setPoints(pts: number): void;
    setDisabled(v: boolean): void;
    /** Llamar cuando cambia qty/pv externamente (afecta la conversión a $) para re-render el campo. */
    refreshConversion(): void;
}

export interface PointsUsdFieldOptions {
    points: number;
    /** Cantidad de contratos vigente — determina cuánto vale un punto en $. */
    qty: () => number;
    /** Valor en $ de UN punto para UN contrato (PV del instrumento). */
    pointValue: () => number;
    onChange: (points: number) => void;
    size?: 'sm' | 'md';
    disabled?: boolean;
}

export function pointsUsdField(opts: PointsUsdFieldOptions): PointsUsdField {
    let unit: ValueUnit = 'pts';
    let points = opts.points;
    const dollarsPerPoint = (): number => Math.max(0, opts.qty()) * opts.pointValue();

    const toggle = h('div', 'pf-unit-seg');
    const ptsBtn = h('button', 'on', 'Pts');
    ptsBtn.type = 'button';
    const usdBtn = h('button', undefined, '$');
    usdBtn.type = 'button';
    toggle.append(ptsBtn, usdBtn);

    const num = new NumberInput({
        value: points,
        min: 0,
        step: unit === 'pts' ? 1 : 10,
        size: opts.size ?? 'sm',
        fill: false,
        commit: 'blur',
        steppers: false,
        disabled: opts.disabled,
        onChange: (v) => {
            points = unit === 'pts' ? v : dollarsPerPoint() > 0 ? v / dollarsPerPoint() : 0;
            opts.onChange(points);
        },
    });

    function render(): void {
        ptsBtn.classList.toggle('on', unit === 'pts');
        usdBtn.classList.toggle('on', unit === 'usd');
        num.setValue(unit === 'pts' ? points : points * dollarsPerPoint());
    }
    function setUnit(u: ValueUnit): void {
        if (u === unit) return;
        unit = u;
        render();
    }
    ptsBtn.addEventListener('click', () => setUnit('pts'));
    usdBtn.addEventListener('click', () => setUnit('usd'));
    render();

    const el = h('div', 'pf-unit-field');
    el.append(num.el, toggle);

    return {
        el,
        getPoints: () => points,
        setPoints: (pts) => {
            points = pts;
            render();
        },
        setDisabled: (v) => {
            num.input.disabled = v;
            ptsBtn.disabled = v;
            usdBtn.disabled = v;
        },
        refreshConversion: render,
    };
}
