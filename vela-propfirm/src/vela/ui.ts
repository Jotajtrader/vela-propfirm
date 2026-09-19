// Helpers de DOM + la hoja de estilos del panel y los diálogos, todo sobre los tokens `--vela-*`
// para que el simulador se vea como el resto del shell (tema claro/oscuro incluido).
import { injectStyles } from '@luxalgo/vela/ui';

export const STYLE_ID = 'propfirm-ui';
export const CSS = `
.pf{font:12px/1.4 var(--vela-font-family,system-ui);color:var(--vela-fg)}
.pf .sec{padding:10px 12px;border-bottom:1px solid var(--vela-border-soft)}
.pf .sec h3{margin:0 0 8px;font-size:10px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:var(--vela-fg-muted)}
.pf .row{display:flex;gap:6px;align-items:center}
.pf .col{display:flex;flex-direction:column;gap:6px}
.pf .grid2{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.pf .grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px}
.pf .kv{display:flex;justify-content:space-between;gap:8px;padding:1px 0;font-variant-numeric:tabular-nums}
.pf .kv .k{color:var(--vela-fg-muted)} .pf .kv .v{font-weight:600}
.pf .pos{color:var(--vela-up,#26a65b)} .pf .neg{color:var(--vela-down,#e0524f)}
.pf .hint{color:var(--vela-fg-muted);font-size:11px;line-height:1.5}
.pf .mini{font-size:11px;color:var(--vela-fg-muted);font-variant-numeric:tabular-nums}
.pf .stat-net{font-size:20px;font-weight:700;font-variant-numeric:tabular-nums}
.pf .lbl{display:block;color:var(--vela-fg-muted);font-size:10px;margin-bottom:2px}
.pf-btn{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:4px;padding:5px 9px;border-radius:var(--vela-radius-sm);
  border:1px solid var(--vela-border-soft);background:var(--vela-surface-raised,transparent);color:var(--vela-fg);cursor:pointer;font:inherit;line-height:1.3;white-space:nowrap}
.pf-btn:hover{border-color:var(--vela-accent)}
.pf-btn:disabled{opacity:.4;cursor:not-allowed}
.pf-btn.on{background:var(--vela-accent);border-color:var(--vela-accent);color:var(--vela-fg-on-accent,#0b0e14)}
.pf-btn.buy{border-color:var(--vela-up,#26a65b)} .pf-btn.buy:hover{background:var(--vela-up,#26a65b);color:#04120a}
.pf-btn.sell{border-color:var(--vela-down,#e0524f)} .pf-btn.sell:hover{background:var(--vela-down,#e0524f);color:#1a0505}
.pf-btn.big{padding:8px 12px;font-weight:700;border:none}
.pf-btn.big.buy{background:var(--vela-up,#26a65b);color:#04120a} .pf-btn.big.sell{background:var(--vela-down,#e0524f);color:#1a0505}
.pf-btn.big.flat{background:var(--vela-surface-raised,transparent);color:var(--vela-fg);border:1px solid var(--vela-border-soft)}
.pf-btn.wide{width:100%}
.pf-btn.tab{flex:1;padding:6px 2px;font-size:10px;overflow:hidden;text-overflow:ellipsis}
.pf-btn .cnt{opacity:.65;margin-left:2px}
.pf-tabs{display:flex;gap:4px}
.pf-list{display:flex;flex-direction:column;gap:5px;max-height:260px;overflow-y:auto}
.pf-card{border:1px solid var(--vela-border-soft);border-radius:var(--vela-radius-md);padding:6px 8px;background:var(--vela-surface-raised,transparent);cursor:pointer}
.pf-card.sel{border-color:var(--vela-accent);background:color-mix(in srgb,var(--vela-accent) 14%,transparent)}
.pf-card .top{display:flex;justify-content:space-between;align-items:center;margin-bottom:3px}
.pf-card .nm{font-weight:600}
.pf-badge{font-size:9px;padding:1px 5px;border-radius:8px;text-transform:uppercase;letter-spacing:.5px}
.pf-badge.b-p1{background:color-mix(in srgb,var(--vela-fg) 12%,transparent);color:var(--vela-fg)}
.pf-badge.b-funded{background:color-mix(in srgb,var(--vela-up,#26a65b) 22%,transparent);color:var(--vela-up,#26a65b)}
.pf-badge.b-blown{background:color-mix(in srgb,var(--vela-down,#e0524f) 22%,transparent);color:var(--vela-down,#e0524f)}
.pf-badge.b-paid{background:color-mix(in srgb,#e0a53f 25%,transparent);color:#b5790f} .pf-badge.b-paused{background:color-mix(in srgb,#e0a53f 25%,transparent);color:#b5790f}
:root:not([data-theme=light]) .pf-badge.b-paid,:root:not([data-theme=light]) .pf-badge.b-paused{color:#ffb84d}
.pf-bars{display:flex;gap:2px;margin-top:4px}
.pf-bar{flex:1;height:4px;border-radius:2px;background:color-mix(in srgb,var(--vela-fg) 12%,transparent);overflow:hidden}
.pf-bar .fill{height:100%}
.pf-canvas{width:100%;height:90px;display:block;background:var(--vela-surface,transparent);border:1px solid var(--vela-border-soft);border-radius:var(--vela-radius-sm)}
.pf-ordrow{display:flex;justify-content:space-between;align-items:center;padding:2px 0;font-variant-numeric:tabular-nums}
.pf-chips{display:flex;gap:4px;flex-wrap:wrap}
.pf-seg{display:flex;gap:4px} .pf-seg .pf-btn{flex:1}
.pf-native{background:transparent;color:var(--vela-fg);border:1px solid var(--vela-border-soft);border-radius:var(--vela-radius-sm);padding:5px 7px;font:inherit;width:100%;box-sizing:border-box;color-scheme:dark}
.pf-native:focus{outline:none;border-color:var(--vela-accent)}
.pf-dialog{width:min(92vw,var(--pf-w,380px))}
.pf-dialog .body{display:flex;flex-direction:column;gap:10px}
.pf-foot{display:flex;justify-content:flex-end;gap:8px}
.pf-phase{border:1px solid var(--vela-border-soft);border-radius:var(--vela-radius-md);padding:8px;background:var(--vela-surface-raised,transparent);display:flex;flex-direction:column;gap:6px}
.pf-sep{border-top:1px solid var(--vela-border-soft);padding-top:8px;margin-top:2px}
.pf-title{font-size:10px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:var(--vela-accent)}
.pf-title.green{color:var(--vela-up,#26a65b)} .pf-title.muted{color:var(--vela-fg-muted)}
.pf-toggrow{display:flex;align-items:center;gap:8px}
.pf-toggrow .grow{flex:1}
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
