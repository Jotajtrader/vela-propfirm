// "Code": correr Pine arbitrario contra el motor del chart, on demand — réplica del botón "Code"
// del playground de referencia de Vela-pinets (Vela-pinets/playground/widget.ts: "The 'Code' topbar
// entry runs arbitrary Pine through the addon engine on demand"), restyleada con nuestros tokens
// .pf/--lux-* para que combine con el resto de los diálogos del plugin en vez de quedar en el
// estilo crudo --vela-* del original. `runIndicator()` solo inyecta el indicador si la corrida sale
// bien — un script que falla muestra su error inline en vez de dejar una fila muerta en la leyenda.
import { registerIcon, registerWidgetAction, type WidgetContext } from '@luxalgo/vela/plugin';
import { Dialog } from '@luxalgo/vela/ui';
import { btn, ensureStyles, h } from './ui';

registerIcon(
    'propfirm.pine-code',
    '<svg viewBox="0 0 16 16" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="m5.5 4.5-4 3.5 4 3.5M10.5 4.5l4 3.5-4 3.5"/></svg>',
);

// Singletons de DOM perezosos — así el script editado sobrevive a cerrar y reabrir el diálogo. El
// WidgetContext NUNCA se guarda: `run(ctx)` reengancha el handler de Run en cada invocación, así
// que el ctx vive solo en ese closure y siempre pertenece al widget que lo abrió (el patrón que
// sigue andando en un shell con varios charts).
let codeDialog: Dialog | null = null;
let codeArea: HTMLTextAreaElement | null = null;
let codeStatus: HTMLElement | null = null;
let codeRun: HTMLButtonElement | null = null;

registerWidgetAction({
    id: 'propfirm.pine-code',
    target: 'topbar',
    label: 'Code',
    icon: 'propfirm.pine-code',
    align: 'left',
    order: 20,
    run: (ctx) => {
        ensureStyles(ctx.host.ownerDocument);
        if (!codeDialog) {
            const body = h('div', 'pf body');
            codeArea = h('textarea', 'pf-native');
            codeArea.value = `//@version=5
indicator("My RSI", overlay=false)
plot(ta.rsi(close, 14), color=color.purple)`;
            codeArea.spellcheck = false;
            codeArea.style.cssText = 'width:560px;max-width:80vw;height:260px;resize:vertical;white-space:pre';
            // Ctrl/⌘+Enter corre sin soltar el teclado (el textarea se queda con el Enter normal).
            codeArea.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    codeRun?.click();
                }
            });
            codeRun = btn('Run', () => void runCode(ctx), 'on wide');
            codeStatus = h('div', 'hint');
            codeStatus.style.cssText = 'min-height:1.3em;white-space:pre-wrap';
            body.append(codeArea, codeRun, codeStatus);
            codeDialog = new Dialog({
                title: 'Correr un indicador Pine',
                host: ctx.host,
                closeOnInteractOutside: true,
                className: 'pf-dialog',
                content: (el) => el.appendChild(body),
            });
            codeDialog.panel.style.setProperty('--pf-w', '600px');
        }
        // Reengancha por invocación — el ctx se queda en este closure, no a nivel de módulo.
        codeRun!.onclick = () => void runCode(ctx);
        codeStatus!.textContent = '';
        codeDialog.show();
        setTimeout(() => codeArea?.focus(), 0);
    },
});

async function runCode(ctx: WidgetContext): Promise<void> {
    if (!codeArea || !codeStatus) return;
    codeStatus.style.color = 'var(--lux-fg-muted)';
    codeStatus.textContent = 'Corriendo…';
    const r = await ctx.chart.runIndicator(codeArea.value);
    if (r.ok) {
        codeStatus.style.color = 'var(--lux-up)';
        codeStatus.textContent = `✓ ${r.handle!.title || 'Indicador'} agregado al chart`;
    } else {
        codeStatus.style.color = 'var(--lux-down)';
        codeStatus.textContent = `✗ ${r.error!.message}`;
    }
}
