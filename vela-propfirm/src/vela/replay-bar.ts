// La barra de replay: flotante sobre el borde inferior del chart, visible con datos cargados.
// Es la "barra de playback" del HTML (ir a fecha/hora, día siguiente misma hora, Play/Step/Saltar
// día, velocidad, progreso, intrabar, modo rápido), montada como attachment del widget.
import { registerWidgetAttachment, type WidgetContext } from '@luxalgo/vela/plugin';
import { injectStyles } from '@luxalgo/vela/ui';
import { SPEED_MS } from '../engine/replay';
import { fmtTime } from '../engine/data';
import type { Simulator } from '../engine/Simulator';
import { getSimulator } from './context';

const STYLE_ID = 'propfirm-replay-bar';
const CSS = `
.pf-replay{position:absolute;left:50%;bottom:44px;transform:translateX(-50%);z-index:20;display:flex;gap:4px;align-items:center;
  padding:5px 8px;border-radius:var(--vela-radius-md);background:var(--vela-surface-overlay);border:1px solid var(--vela-border-soft);
  color:var(--vela-fg);font:12px/1.3 var(--vela-font-family,system-ui);box-shadow:0 4px 16px rgba(0,0,0,.35);white-space:nowrap;max-width:calc(100% - 24px);overflow:auto}
.pf-replay[hidden]{display:none}
.pf-replay .grp{display:flex;gap:3px;align-items:center;padding-right:6px;margin-right:2px;border-right:1px solid var(--vela-border-soft)}
.pf-replay .grp:last-child{border-right:none;padding-right:0;margin-right:0}
.pf-replay button{all:unset;padding:4px 9px;border-radius:var(--vela-radius-sm);cursor:pointer;color:var(--vela-fg);background:transparent;line-height:1.3}
.pf-replay button:hover{background:var(--vela-hover-bg,rgba(255,255,255,.06))}
.pf-replay button.on{background:var(--vela-accent);color:var(--vela-fg-on-accent,#0b0e14)}
.pf-replay button:disabled{opacity:.4;cursor:not-allowed}
.pf-replay input[type=datetime-local]{background:transparent;color:var(--vela-fg);border:1px solid var(--vela-border-soft);border-radius:var(--vela-radius-sm);padding:3px 5px;font:inherit;color-scheme:dark}
.pf-replay input[type=range]{width:96px;accent-color:var(--vela-accent)}
.pf-replay .mini{color:var(--vela-fg-muted);font-size:11px;font-variant-numeric:tabular-nums}
`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
}

function button(label: string, title: string, onClick: () => void): HTMLButtonElement {
    const b = el('button', undefined, label);
    b.title = title;
    b.addEventListener('click', onClick);
    return b;
}

function mountReplayBar(ctx: WidgetContext, sim: Simulator): () => void {
    injectStyles(STYLE_ID, CSS, ctx.host.ownerDocument);
    const bar = el('div', 'pf-replay');
    const st = sim.state;

    // ── ir a fecha/hora ──
    const g1 = el('div', 'grp');
    const gotoInput = el('input');
    gotoInput.type = 'datetime-local';
    g1.append(
        gotoInput,
        button('⏩ Ir', 'Ir a fecha/hora (solo hacia adelante)', () => {
            if (!gotoInput.value) return ctx.toast('Elegí una fecha y hora.', 'error');
            sim.gotoDateTime(new Date(gotoInput.value));
        }),
        button('📆 Día sig.', 'Salta al día siguiente, a la misma hora en la que está parado el replay (o a la hora del campo)', () => {
            const v = gotoInput.value ? new Date(gotoInput.value) : null;
            sim.gotoNextDaySameTime(v && !isNaN(v.getTime()) ? { h: v.getHours(), m: v.getMinutes() } : null);
        }),
    );

    // ── transporte ──
    const g2 = el('div', 'grp');
    const play = button('▶ Play', 'Espacio', () => sim.togglePlay());
    g2.append(play, button('Step ▸', '→', () => sim.step()), button('⏭ Saltar día', 'Alt+D — flatea posiciones y va al final del día', () => sim.skipDay()));

    // ── velocidad ──
    const g3 = el('div', 'grp');
    const speed = el('input');
    speed.type = 'range';
    speed.min = '0';
    speed.max = String(SPEED_MS.length - 1);
    speed.step = '1';
    speed.value = String(Math.max(0, SPEED_MS.indexOf(st.speed as (typeof SPEED_MS)[number])));
    const speedLbl = el('span', 'mini');
    speed.addEventListener('input', () => sim.setSpeed(SPEED_MS[+speed.value] ?? SPEED_MS[2]));
    g3.append(el('span', 'mini', 'Velocidad'), speed, speedLbl);

    // ── progreso ──
    const g4 = el('div', 'grp');
    const prog = el('span', 'mini');
    g4.append(prog);

    // ── intrabar + modo rápido ──
    const g5 = el('div', 'grp');
    const intrabar = button('🎲 Intrabar: OFF', 'Simula un camino aleatorio de precio dentro de cada barra para resolver sin ambigüedad qué nivel se toca primero', () =>
        sim.setRandomIntrabar(!st.randomIntrabar),
    );
    const ff = button('⏩⏩ Modo rápido', 'Corre toda la simulación sin pintar hasta el final — ideal para backtests largos del agente', () => {
        if (st.fastForward.running) sim.cancelFastForward();
        else void sim.fastForward({ onProgress: refresh });
    });
    const ffStatus = el('span', 'mini');
    g5.append(intrabar, ff, ffStatus);

    bar.append(g1, g2, g3, g4, g5);
    ctx.host.appendChild(bar);

    let raf = 0;
    const paint = (): void => {
        raf = 0;
        bar.hidden = st.bars.length === 0;
        if (bar.hidden) return;
        const b = st.bars[st.idx];
        play.textContent = st.playing ? '⏸ Pause' : '▶ Play';
        play.classList.toggle('on', st.playing);
        speedLbl.textContent = `${(1000 / st.speed).toFixed(1)} barras/s`;
        prog.textContent = b ? `bar ${st.idx + 1} / ${st.bars.length} · ${b.day} ${fmtTime(b.t)}` : `bar 0 / ${st.bars.length}`;
        intrabar.textContent = `🎲 Intrabar: ${st.randomIntrabar ? 'ON' : 'OFF'}`;
        intrabar.classList.toggle('on', st.randomIntrabar);
        ff.textContent = st.fastForward.running ? '⏹ Detener' : '⏩⏩ Modo rápido';
        ffStatus.textContent = st.fastForward.running ? `procesando… bar ${st.idx + 1} / ${st.bars.length}` : '';
    };
    const refresh = (): void => {
        if (!raf) raf = requestAnimationFrame(paint);
    };
    paint();

    const offChange = sim.on('change', refresh);
    const offAlert = sim.on('alert', (msg) => ctx.toast(msg, 'error'));
    const offNotice = sim.on('notice', ({ msg, kind }) => ctx.toast(msg, kind === 'blown' ? 'error' : 'info'));
    return () => {
        offChange();
        offAlert();
        offNotice();
        if (raf) cancelAnimationFrame(raf);
        bar.remove();
    };
}

registerWidgetAttachment({
    id: 'propfirm.replay-bar',
    mount: (ctx) => {
        const sim = getSimulator();
        if (!sim) return () => undefined;
        return mountReplayBar(ctx, sim);
    },
});
