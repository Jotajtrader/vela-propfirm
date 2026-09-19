// Punto de entrada de la integración: conecta un Simulator con un VelaWorkspace.
import type { VelaWorkspace } from '@luxalgo/vela/workspace';
import { sharedBarStore } from '@luxalgo/vela';
import type { Simulator } from '../engine/Simulator';
import { ReplayProvider } from './ReplayProvider';
import { ReplayBridge } from './bridge';
import { setPropFirmContext } from './context';
import { installKeymap } from './keymap';
import { OVERLAY_ID } from './overlay';
import './replay-bar';

export interface PropFirmInstall {
    provider: ReplayProvider;
    bridge: ReplayBridge;
    dispose(): void;
}

/**
 * Crea el provider antes de construir el workspace (`providers: { replay: () => provider }`) y
 * llama a `attach` con el workspace ya construido. Si el simulador ya tiene barras cargadas, el
 * primer load del chart las sirve directamente.
 */
export function createPropFirm(sim: Simulator): { provider: ReplayProvider; attach(ws: VelaWorkspace): PropFirmInstall } {
    const provider = new ReplayProvider();
    setPropFirmContext(sim, provider);
    return {
        provider,
        attach(ws) {
            const bridge = new ReplayBridge(sim, provider, { chart: () => ws.chart, clearCache: () => sharedBarStore.clear() });
            const offKeymap = installKeymap(ws.keymap, sim);
            const mountOverlay = (): void => {
                void ws.chart.ready().then(() => ws.chart.addNativeIndicator(OVERLAY_ID));
            };
            mountOverlay();
            ws.refreshActions(); // proyecta la barra de replay si el workspace se construyó antes del import
            return {
                provider,
                bridge,
                dispose: () => {
                    offKeymap();
                    bridge.destroy();
                },
            };
        },
    };
}
