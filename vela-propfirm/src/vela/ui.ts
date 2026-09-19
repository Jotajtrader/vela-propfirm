// Helpers de DOM + la hoja de estilos del panel y los diálogos, todo sobre los tokens `--vela-*`
// para que el simulador se vea como el resto del shell (tema claro/oscuro incluido).
import { injectStyles } from '@luxalgo/vela/ui';

export const STYLE_ID = 'propfirm-ui';
export const CSS = `
/* ── tokens, inspirados en la estética de luxalgo.com (fondo casi negro en capas, teal de marca
   #0f9c85, verde/rojo alineados a TradingView, bordes en blanco-alpha muy tenues, radios 4-8px).
   Van en :root (no en .pf): el chrome nativo de los Dialog de Vela (header, borde, footer) vive
   FUERA del div .pf que envolvemos como body — si los tokens quedaban escapados a .pf, ese chrome
   y los botones del footer no los heredaban y quedaban con el estilo default de Vela, generando el
   efecto "cortado y pegado" contra el body ya restyleado. Con contraparte clara si el usuario pasa
   el chart a theme:'light'. */
:root{
  --lux-accent:#0f9c85; --lux-accent-fg:#ffffff;
  --lux-bg:#0a0a0a; --lux-bg-2:#141414; --lux-bg-3:#1c1c1c;
  --lux-border:rgba(255,255,255,.08); --lux-border-strong:rgba(255,255,255,.16);
  --lux-fg:#ededed; --lux-fg-muted:#a0a0a0; --lux-fg-subtle:#7d7d7d;
  --lux-up:#089981; --lux-down:#f23645; --lux-warn:#ffa02f;
  --lux-radius-sm:4px; --lux-radius-md:6px; --lux-radius-lg:8px;
}
:root[data-theme=light]{
  --lux-accent:#0f9c85; --lux-accent-fg:#ffffff;
  --lux-bg:#fafafa; --lux-bg-2:#f0f0f0; --lux-bg-3:#e6e6e6;
  --lux-border:rgba(0,0,0,.08); --lux-border-strong:rgba(0,0,0,.18);
  --lux-fg:#171717; --lux-fg-muted:#555555; --lux-fg-subtle:#7d7d7d;
  --lux-up:#089981; --lux-down:#f23645; --lux-warn:#c97600;
}
/* el atributo [hidden] debe ganarle a cualquier clase que fije su propio display (.row/.col fijan
   flex) — si no, un elemento oculto con esas clases queda visible igual (empate de especificidad
   resuelto por orden de aparición, no por [hidden]). */
.pf [hidden]{display:none !important}
.pf{font:12px/1.4 var(--vela-font-family,system-ui);color:var(--lux-fg);background:var(--lux-bg)}
.pf .sec{margin:8px 10px;padding:12px;border:1px solid var(--lux-border);border-radius:var(--lux-radius-lg);background:var(--lux-bg-2)}
.pf .sec h3{margin:0 0 10px;font-size:10px;font-weight:700;letter-spacing:1.1px;text-transform:uppercase;color:var(--lux-fg-subtle);display:flex;align-items:center;gap:6px}
.pf .sec h3::before{content:'';display:inline-block;width:3px;height:11px;border-radius:2px;background:var(--lux-accent);flex:none}
.pf .row{display:flex;gap:6px;align-items:center}
.pf .col{display:flex;flex-direction:column;gap:6px}
.pf .grid2{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.pf .grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px}
.pf .kv{display:flex;justify-content:space-between;gap:8px;padding:1px 0;font-variant-numeric:tabular-nums}
.pf .kv .k{color:var(--lux-fg-muted)} .pf .kv .v{font-weight:600;color:var(--lux-fg)}
.pf .pos{color:var(--lux-up)} .pf .neg{color:var(--lux-down)}
.pf .hint{color:var(--lux-fg-muted);font-size:11px;line-height:1.5}
.pf .mini{font-size:11px;color:var(--lux-fg-muted);font-variant-numeric:tabular-nums}
.pf .stat-net{font-size:20px;font-weight:700;font-variant-numeric:tabular-nums;color:var(--lux-fg)}
.pf .lbl{display:block;color:var(--lux-fg-muted);font-size:10px;margin-bottom:2px}
.pf-btn{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:4px;padding:6px 10px;border-radius:var(--lux-radius-md);
  border:1px solid var(--lux-border);background:var(--lux-bg-3);color:var(--lux-fg);cursor:pointer;font:inherit;line-height:1.3;white-space:nowrap;
  transition:background-color .12s ease,border-color .12s ease}
.pf-btn:hover{border-color:var(--lux-border-strong);background:color-mix(in srgb,var(--lux-fg) 6%,var(--lux-bg-3))}
.pf-btn:disabled{opacity:.4;cursor:not-allowed}
.pf-btn.on{background:var(--lux-accent);border-color:var(--lux-accent);color:var(--lux-accent-fg)}
.pf-btn.on:hover{background:var(--lux-accent);filter:brightness(1.08)}
.pf-btn.buy{border-color:var(--lux-up)} .pf-btn.buy:hover{background:var(--lux-up);color:#fff}
.pf-btn.sell{border-color:var(--lux-down)} .pf-btn.sell:hover{background:var(--lux-down);color:#fff}
.pf-btn.big{padding:9px 14px;font-weight:700;border:none;border-radius:var(--lux-radius-lg)}
.pf-btn.big.buy{background:var(--lux-up);color:#fff} .pf-btn.big.sell{background:var(--lux-down);color:#fff}
.pf-btn.big.flat{background:var(--lux-bg-3);color:var(--lux-fg);border:1px solid var(--lux-border-strong)}
.pf-btn.wide{width:100%}
.pf-btn.tab{flex:1;padding:6px 2px;font-size:10px;overflow:hidden;text-overflow:ellipsis}
.pf-btn .cnt{opacity:.65;margin-left:2px}
.pf-tabs{display:flex;gap:4px}
.pf-list{display:flex;flex-direction:column;gap:6px;max-height:260px;overflow-y:auto}
.pf-card{border:1px solid var(--lux-border);border-radius:var(--lux-radius-lg);padding:8px 10px;background:var(--lux-bg-3);cursor:pointer;
  transition:border-color .12s ease,background-color .12s ease}
.pf-card:hover{border-color:var(--lux-border-strong)}
.pf-card.sel{border-color:var(--lux-accent);background:color-mix(in srgb,var(--lux-accent) 14%,var(--lux-bg-3))}
.pf-card .top{display:flex;justify-content:space-between;align-items:center;margin-bottom:3px}
.pf-card .nm{font-weight:600;color:var(--lux-fg)}
.pf-badge{font-size:9px;padding:2px 6px;border-radius:20px;text-transform:uppercase;letter-spacing:.5px;font-weight:700}
.pf-badge.b-p1{background:color-mix(in srgb,var(--lux-fg) 14%,transparent);color:var(--lux-fg)}
.pf-badge.b-funded{background:color-mix(in srgb,var(--lux-up) 22%,transparent);color:var(--lux-up)}
.pf-badge.b-blown{background:color-mix(in srgb,var(--lux-down) 22%,transparent);color:var(--lux-down)}
.pf-badge.b-paid{background:color-mix(in srgb,var(--lux-warn) 25%,transparent);color:var(--lux-warn)}
.pf-badge.b-paused{background:color-mix(in srgb,var(--lux-warn) 25%,transparent);color:var(--lux-warn)}
.pf-bars{display:flex;gap:2px;margin-top:4px}
.pf-bar{flex:1;height:4px;border-radius:2px;background:var(--lux-bg);overflow:hidden}
.pf-bar .fill{height:100%}
.pf-canvas{width:100%;height:90px;display:block;background:var(--lux-bg);border:1px solid var(--lux-border);border-radius:var(--lux-radius-md)}
.pf-ordrow{display:flex;justify-content:space-between;align-items:center;padding:2px 0;font-variant-numeric:tabular-nums}
.pf-chips{display:flex;gap:4px;flex-wrap:wrap}
.pf-seg{display:flex;gap:4px} .pf-seg .pf-btn{flex:1}
.pf-native{background-color:var(--lux-bg-3);color:var(--lux-fg);border:1px solid var(--lux-border);border-radius:var(--lux-radius-md);padding:6px 8px;font:inherit;width:100%;box-sizing:border-box;color-scheme:dark}
.pf-native:focus{outline:none;border-color:var(--lux-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--lux-accent) 25%,transparent)}
/* el listado desplegado de un <select> es chrome nativo del SO — Chromium sí respeta el color de
   fondo puesto en <option>/<optgroup>, así que se fija explícito para que no aparezca blanco. */
select.pf-native option,select.pf-native optgroup{background-color:var(--lux-bg-2);color:var(--lux-fg)}
:root[data-theme=light] .pf-native,:root[data-theme=light] select.pf-native option,:root[data-theme=light] select.pf-native optgroup{color-scheme:light}
/* Trading Panel y Centro de control (.pf-panel, además de .pf) son paneles persistentes, no
   diálogos modales — más aire entre secciones y controles más grandes/legibles, como pidió el
   usuario con una captura de referencia (los .pf-dialog se quedan en la escala compacta de antes:
   agrandarlos también los haría sentir menos "de paso"). Selector compuesto .pf-panel.pf para
   ganarle a .pf .sec / .pf .hint (misma especificidad si no) sin depender del orden de la hoja. */
.pf-panel.pf{font-size:13px}
.pf-panel.pf .sec{margin:12px 14px;padding:16px}
.pf-panel.pf .sec h3{font-size:11px;margin-bottom:12px;gap:8px}
.pf-panel.pf .sec h3::before{width:4px;height:13px}
.pf-panel.pf .hint{font-size:12.5px}
.pf-panel .pf-btn{padding:9px 14px}
.pf-panel .pf-btn.tab{padding:12px 8px;font-size:12.5px;font-weight:600}
.pf-panel .pf-native{padding:9px 11px}
.pf-panel .pf-chips .pf-btn{padding:10px 16px;font-size:13px}

/* el panel del Dialog (header + borde + fondo) es chrome propio de Vela (.vela-dialog, sobre sus
   propios tokens --vela-*): se sobreescribe acá — con el selector compuesto para ganarle a
   .vela-dialog sin depender del orden de las hojas — para que combine con el body .pf de adentro
   en vez de quedar con el tema default de Vela. */
.vela-dialog.pf-dialog{width:min(92vw,var(--pf-w,380px));background:var(--lux-bg);border:1px solid var(--lux-border);border-radius:var(--lux-radius-lg);color:var(--lux-fg)}
.vela-dialog.pf-dialog .vela-dialog-header{border-bottom:1px solid var(--lux-border)}
.vela-dialog.pf-dialog .vela-dialog-title{color:var(--lux-fg)}
.vela-dialog.pf-dialog .vela-dialog-close{color:var(--lux-fg-muted)}
.vela-dialog.pf-dialog .vela-dialog-close:hover{background:var(--lux-bg-3);color:var(--lux-fg)}
.vela-dialog.pf-dialog .vela-dialog-body{padding:0}
.pf-dialog .body{display:flex;flex-direction:column;gap:10px;padding:var(--vela-space-4,16px)}
.pf-foot{display:flex;justify-content:flex-end;gap:8px;border-top:1px solid var(--lux-border);padding:10px var(--vela-space-4,16px)}
.pf-phase{border:1px solid var(--lux-border);border-radius:var(--lux-radius-lg);padding:10px;background:var(--lux-bg-2);display:flex;flex-direction:column;gap:6px}
.pf-sep{border-top:1px solid var(--lux-border);padding-top:8px;margin-top:2px}
.pf-title{font-size:10px;font-weight:700;letter-spacing:1.1px;text-transform:uppercase;color:var(--lux-accent)}
.pf-title.green{color:var(--lux-up)} .pf-title.muted{color:var(--lux-fg-subtle)}
.pf-toggrow{display:flex;align-items:center;gap:8px}
.pf-toggrow .grow{flex:1}
.pf-unit-field{display:flex;align-items:center;gap:4px}
.pf-unit-seg{display:flex;border:1px solid var(--lux-border);border-radius:var(--lux-radius-sm);overflow:hidden}
.pf-unit-seg button{all:unset;padding:4px 6px;font-size:10px;color:var(--lux-fg-muted);cursor:pointer;line-height:1}
.pf-unit-seg button.on{background:var(--lux-accent);color:var(--lux-accent-fg)}
.pf-unit-seg button:disabled{opacity:.4;cursor:not-allowed}
`;

export function ensureStyles(doc: Document): void {
    injectStyles(STYLE_ID, CSS, doc);
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
}

export function btn(label: string, onClick: (ev: MouseEvent) => void, cls = ''): HTMLButtonElement {
    const b = h('button', `pf-btn${cls ? ' ' + cls : ''}`, label);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
}

export function kv(k: string, v: string, vCls = ''): HTMLElement {
    const row = h('div', 'kv');
    row.append(h('span', 'k', k), h('span', `v${vCls ? ' ' + vCls : ''}`, v));
    return row;
}

export function section(title: string): HTMLElement {
    const s = h('div', 'sec');
    s.appendChild(h('h3', undefined, title));
    return s;
}

export function hint(text: string): HTMLElement {
    return h('div', 'hint', text);
}

export function labeled(label: string, control: HTMLElement): HTMLElement {
    const w = h('div');
    w.append(h('span', 'lbl', label), control);
    return w;
}

/** Input nativo (date/time/file/datalist) vestido con los tokens — para lo que el kit no cubre. */
export function nativeInput(type: string, value = ''): HTMLInputElement {
    const i = h('input', 'pf-native');
    i.type = type;
    i.value = value;
    return i;
}

export function cssVar(el: Element, name: string, fallback: string): string {
    const v = getComputedStyle(el).getPropertyValue(name).trim();
    return v || fallback;
}

/** Botón con confirmación de dos clicks (4 s), como el "🗑 ¿Seguro?" del HTML. */
export function armedButton(label: string, confirmLabel: string, onConfirm: () => void, cls = ''): HTMLButtonElement {
    let armed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const b = btn(label, () => {
        if (!armed) {
            armed = true;
            b.textContent = confirmLabel;
            timer = setTimeout(() => {
                armed = false;
                b.textContent = label;
            }, 4000);
            return;
        }
        if (timer) clearTimeout(timer);
        armed = false;
        b.textContent = label;
        onConfirm();
    }, cls);
    return b;
}

export function fmtHM(hm: { h: number; m: number } | null): string {
    return hm ? `${String(hm.h).padStart(2, '0')}:${String(hm.m).padStart(2, '0')}` : '';
}

export function parseHM(v: string): { h: number; m: number } | null {
    if (!v) return null;
    const [h, m] = v.split(':');
    return { h: +h!, m: +m! };
}

export function isoDate(d: Date | null): string {
    return d ? d.toISOString().slice(0, 10) : '';
}
