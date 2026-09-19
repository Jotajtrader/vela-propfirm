// Carga el <script> ORIGINAL de fondeo-sim (reference/fondeo-sim.html) en jsdom y expone su estado
// y sus funciones, con `Math.random` y `alert`/`showAlert` inyectados. Es la fuente de verdad contra
// la que se compara el port TypeScript: mismos datos + misma secuencia de RNG ⇒ mismo estado final.
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';
import type { SimBar } from '../../src/engine/data';

export interface HtmlSim {
    win: JSDOM['window'];
    /** El `state` global del HTML (any a propósito: es el objeto vivo del script original). */
    state: any;
    call<T = unknown>(fn: string, ...args: unknown[]): T;
    alerts: string[];
    notices: string[];
    setRng(rng: () => number): void;
    close(): void;
}

const HTML = readFileSync(new URL('../../reference/fondeo-sim.html', import.meta.url), 'utf8');

export function loadHtmlSim(): HtmlSim {
    // Sin canvas real, el `drawChart()` del INIT lanza al pintar — después de que TODAS las funciones
    // y el wiring ya existen. La consola virtual se traga ese error y los "not implemented" de jsdom.
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', () => undefined);
    const dom = new JSDOM(HTML, {
        runScripts: 'dangerously',
        pretendToBeVisual: true,
        virtualConsole,
        beforeParse(window) {
            // jsdom no implementa canvas: un contexto 2D falso (todo no-op) deja correr drawChart & co.
            // El modo rápido del HTML pone suppressRender=false al terminar, así que el pintado SÍ ocurre.
            const fakeCtx = new Proxy(
                {},
                {
                    get: (_t, p) => (p === 'measureText' ? () => ({ width: 8 }) : () => undefined),
                    set: () => true,
                },
            );
            (window as unknown as { HTMLCanvasElement: { prototype: { getContext: unknown } } }).HTMLCanvasElement.prototype.getContext = () => fakeCtx;
            (window as unknown as { requestAnimationFrame: unknown }).requestAnimationFrame = () => 0; // sin loop de tick() de fondo
        },
    });
    const win = dom.window as unknown as HtmlSim['win'];
    const state = (win as unknown as { eval(s: string): unknown }).eval('state') as any;
    state.suppressRender = true; // evita reconstruir el DOM en cada paso (mismo atajo que usa el modo rápido)
    const alerts: string[] = [];
    const notices: string[] = [];
    (win as unknown as { alert: (m: string) => void }).alert = (m) => {
        alerts.push(String(m));
    };
    (win as unknown as { showAlert: (m: string, k: string) => void }).showAlert = (m) => {
        notices.push(String(m));
    };
    return {
        win,
        state,
        alerts,
        notices,
        call: (fn, ...args) => ((win as unknown as Record<string, (...a: unknown[]) => unknown>)[fn]!)(...args) as never,
        setRng: (rng) => {
            (win as unknown as { Math: Math }).Math.random = rng;
        },
        close: () => dom.window.close(),
    };
}

/** Copia de barras para el HTML: mismos valores, fechas del realm de jsdom. */
export function barsForHtml(H: HtmlSim, bars: readonly SimBar[]): unknown[] {
    const D = (H.win as unknown as { Date: DateConstructor }).Date;
    return bars.map((b) => ({ t: new D(b.t.getTime()), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v, day: b.day }));
}
