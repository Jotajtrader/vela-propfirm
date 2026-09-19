// Helpers de DOM + la hoja de estilos del panel y los diálogos, todo sobre los tokens `--vela-*`
// para que el simulador se vea como el resto del shell (tema claro/oscuro incluido).
import { injectStyles } from '@luxalgo/vela/ui';

export const STYLE_ID = 'propfirm-ui';
export const CSS = `
:root{
  --lux-accent:#0f9c85; --lux-accent-fg:#ffffff; --lux-accent-soft:rgba(15,156,133,.16);
  --lux-bg:#0a0a0a; --lux-bg-2:#131313; --lux-bg-3:#1c1c1c;
  --lux-border:rgba(255,255,255,.08); --lux-border-strong:rgba(255,255,255,.16);
  --lux-fg:#ededed; --lux-fg-muted:#8f8f8f; --lux-fg-subtle:#7d7d7d;
  --lux-up:#089981; --lux-down:#f23645; --lux-warn:#ffa02f;
  --lux-radius-sm:4px; --lux-radius-md:7px; --lux-radius-lg:10px; --lux-radius-pill:999px;
  --lux-mono:'IBM Plex Mono',ui-monospace,SFMono-Regular,Menlo,monospace;
}
:root[data-theme=light]{
  --lux-accent:#0f9c85; --lux-accent-fg:#ffffff; --lux-accent-soft:rgba(15,156,133,.14);
  --lux-bg:#fafafa; --lux-bg-2:#f2f2f2; --lux-bg-3:#e8e8e8;
  --lux-border:rgba(0,0,0,.09); --lux-border-strong:rgba(0,0,0,.18);
  --lux-fg:#171717; --lux-fg-muted:#5a5a5a; --lux-fg-subtle:#7d7d7d;
  --lux-up:#089981; --lux-down:#f23645; --lux-warn:#c97600;
}
.pf [hidden]{display:none !important}
.pf{font:12px/1.45 var(--vela-font-family,system-ui);color:var(--lux-fg);background:var(--lux-bg)}

/* ── secciones = tarjeta de superficie 2, borde fino, radio 10 ───────────────── */
.pf .sec{margin:12px;padding:16px;border:1px solid var(--lux-border);border-radius:var(--lux-radius-lg);background:var(--lux-bg-2);display:flex;flex-direction:column;gap:12px}
.pf .sec h3{margin:0;font-size:10.5px;font-weight:600;letter-spacing:.16em;text-transform:uppercase;color:var(--lux-fg-subtle)}
.pf .sec h3::before{content:none}
.pf .row{display:flex;gap:6px;align-items:center}
.pf .col{display:flex;flex-direction:column;gap:8px}
.pf .grid2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.pf .grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px}
.pf .kv{display:flex;justify-content:space-between;gap:8px;padding:1px 0;font-size:12.5px}
.pf .kv .k{color:var(--lux-fg-muted)}
.pf .kv .v{font-family:var(--lux-mono);font-weight:500;color:var(--lux-fg);font-variant-numeric:tabular-nums}
.pf .pos{color:var(--lux-up)} .pf .neg{color:var(--lux-down)}
.pf .hint{color:var(--lux-fg-muted);font-size:12px;line-height:1.6;text-wrap:pretty}
.pf .mini{font-size:11.5px;color:var(--lux-fg-muted);font-variant-numeric:tabular-nums}
.pf .stat-net{font:700 22px/1 var(--lux-mono);font-variant-numeric:tabular-nums;color:var(--lux-fg)}
.pf .lbl{display:block;color:var(--lux-fg-muted);font-size:11px;margin-bottom:5px}

/* ── botones ─────────────────────────────────────────────────────────────────── */
.pf-btn{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:9px 14px;
  border-radius:var(--lux-radius-md);border:1px solid var(--lux-border);background:var(--lux-bg-3);color:#b4b4b4;cursor:pointer;
  font:500 12px/1.3 var(--vela-font-family,system-ui);white-space:nowrap;transition:background-color .12s ease,border-color .12s ease,color .12s ease}
.pf-btn:hover{border-color:var(--lux-border-strong);color:var(--lux-fg)}
.pf-btn:disabled{opacity:.4;cursor:not-allowed}
.pf-btn.on{background:var(--lux-accent);border-color:var(--lux-accent);color:var(--lux-accent-fg);font-weight:600}
.pf-btn.on:hover{filter:brightness(1.08);color:var(--lux-accent-fg)}
.pf-btn.buy{border-color:var(--lux-up);color:var(--lux-up)} .pf-btn.buy:hover{background:var(--lux-up);color:#fff}
.pf-btn.sell{border-color:var(--lux-down);color:var(--lux-down)} .pf-btn.sell:hover{background:var(--lux-down);color:#fff}
.pf-btn.big{padding:12px 16px;font-weight:700;border:none;border-radius:var(--lux-radius-lg)}
.pf-btn.big.buy{background:var(--lux-up);color:#fff} .pf-btn.big.sell{background:var(--lux-down);color:#fff}
.pf-btn.big.flat{background:var(--lux-bg-3);color:var(--lux-fg);border:1px solid var(--lux-border-strong)}
.pf-btn.wide{width:100%}
.pf-btn.tab{flex:1;padding:10px 4px;font-size:12px;overflow:hidden;text-overflow:ellipsis}
.pf-btn .cnt{opacity:.6;margin-left:3px}
.pf-tabs{display:flex;gap:6px}
.pf-chips .pf-btn{border-radius:var(--lux-radius-pill);padding:8px 14px}

/* ── listas y tarjetas de cuenta ─────────────────────────────────────────────── */
.pf-list{display:flex;flex-direction:column;gap:10px;max-height:260px;overflow-y:auto}
.pf-card{border:1px solid var(--lux-border);border-radius:var(--lux-radius-lg);padding:16px;background:var(--lux-bg-2);cursor:pointer;
  display:flex;flex-direction:column;gap:9px;transition:border-color .12s ease}
.pf-card:hover{border-color:var(--lux-border-strong)}
.pf-card.sel{border-color:var(--lux-accent);background:var(--lux-bg-2)}
.pf-card .top{display:flex;justify-content:space-between;align-items:center;margin:0}
.pf-card .nm{font-weight:600;font-size:14px;color:var(--lux-fg)}
.pf-card .kv .v b,.pf-card .kv b{font-family:var(--lux-mono)}
.pf-badge{font-size:9.5px;padding:4px 9px;border-radius:var(--lux-radius-pill);text-transform:uppercase;letter-spacing:.08em;font-weight:700}
.pf-badge.b-p1{background:rgba(255,255,255,.12);color:var(--lux-fg)}
.pf-badge.b-funded{background:var(--lux-accent-soft);color:#2fd4ae}
.pf-badge.b-blown{background:rgba(242,54,69,.2);color:var(--lux-down)}
.pf-badge.b-paid{background:rgba(255,160,47,.2);color:var(--lux-warn)}
.pf-badge.b-paused{background:rgba(255,160,47,.2);color:var(--lux-warn)}
.pf-bars{display:flex;gap:4px;margin-top:3px}
.pf-bar{flex:1;height:4px;border-radius:2px;background:var(--lux-bg);overflow:hidden}
.pf-bar .fill{height:100%}
.pf-canvas{width:100%;height:90px;display:block;background:var(--lux-bg-2);border:1px solid var(--lux-border);border-radius:var(--lux-radius-lg)}
.pf-ordrow{display:flex;justify-content:space-between;align-items:center;padding:9px 11px;background:var(--lux-bg-3);border-radius:var(--lux-radius-md);
  font:500 12px/1 var(--lux-mono);font-variant-numeric:tabular-nums}
.pf-chips{display:flex;gap:6px;flex-wrap:wrap}
.pf-seg{display:flex;gap:6px} .pf-seg .pf-btn{flex:1}

/* ── inputs nativos ──────────────────────────────────────────────────────────── */
.pf-native{background-color:var(--lux-bg-3);color:var(--lux-fg);border:1px solid var(--lux-border);border-radius:var(--lux-radius-md);
  padding:11px 12px;font:500 13px/1 var(--lux-mono);width:100%;box-sizing:border-box;color-scheme:dark}
.pf-native:focus{outline:none;border-color:var(--lux-accent);box-shadow:0 0 0 3px var(--lux-accent-soft)}
select.pf-native option,select.pf-native optgroup{background-color:var(--lux-bg-2);color:var(--lux-fg)}
:root[data-theme=light] .pf-native,:root[data-theme=light] select.pf-native option,:root[data-theme=light] select.pf-native optgroup{color-scheme:light}

/* ── escala de los paneles persistentes ──────────────────────────────────────── */
.pf-panel.pf{font-size:13px}
.pf-panel.pf .sec{margin:12px 14px;padding:16px}
.pf-panel.pf .hint{font-size:12.5px}
.pf-panel .pf-btn.tab{padding:11px 6px;font-size:12.5px}

/* ── diálogos ────────────────────────────────────────────────────────────────── */
.vela-dialog.pf-dialog{width:min(92vw,var(--pf-w,380px));background:var(--lux-bg);border:1px solid var(--lux-border);border-radius:14px;color:var(--lux-fg)}
.vela-dialog.pf-dialog .vela-dialog-header{border-bottom:1px solid var(--lux-border)}
.vela-dialog.pf-dialog .vela-dialog-title{color:var(--lux-fg);font-weight:600}
.vela-dialog.pf-dialog .vela-dialog-close{color:var(--lux-fg-muted)}
.vela-dialog.pf-dialog .vela-dialog-close:hover{background:var(--lux-bg-3);color:var(--lux-fg)}
.vela-dialog.pf-dialog .vela-dialog-body{padding:0}
.pf-dialog .body{display:flex;flex-direction:column;gap:12px;padding:16px}
.pf-foot{display:flex;justify-content:flex-end;gap:8px;border-top:1px solid var(--lux-border);padding:12px 16px}
.pf-phase{border:1px solid var(--lux-border);border-radius:var(--lux-radius-lg);padding:14px;background:var(--lux-bg-2);display:flex;flex-direction:column;gap:8px}
.pf-sep{border-top:1px solid var(--lux-border);padding-top:10px;margin-top:2px}
.pf-title{font-size:10.5px;font-weight:600;letter-spacing:.16em;text-transform:uppercase;color:var(--lux-fg-subtle)}
.pf-title.green{color:var(--lux-up)} .pf-title.muted{color:var(--lux-fg-subtle)}
.pf-toggrow{display:flex;align-items:center;gap:10px}
.pf-toggrow .grow{flex:1}
.pf-unit-field{display:flex;align-items:center;gap:6px}
.pf-unit-seg{display:flex;border:1px solid var(--lux-border);border-radius:var(--lux-radius-sm);overflow:hidden}
.pf-unit-seg button{all:unset;padding:6px 8px;font-size:10.5px;color:var(--lux-fg-muted);cursor:pointer;line-height:1}
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
