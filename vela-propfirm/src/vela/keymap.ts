// Atajos del HTML (Espacio play/pause · → step · saltar día) sobre el keymap del shell, en un scope
// propio apilado mientras hay una sesión de replay cargada. "Saltar día" va en Alt+D (no D como en
// el HTML): el workspace enruta cualquier letra suelta a la búsqueda de símbolo con un listener
// propio, fuera del keymap, y las dos cosas dispararían a la vez.
import type { KeymapManager } from '@luxalgo/vela/ui';
import type { Simulator } from '../engine/Simulator';

export const PROPFIRM_SCOPE = 'propfirm';

export function installKeymap(keymap: KeymapManager, sim: Simulator): () => void {
    const when = (): boolean => sim.state.bars.length > 0;
    keymap.register({ id: 'propfirm.play', keys: 'space', label: 'Replay: play / pausa', category: 'Prop firm', scope: PROPFIRM_SCOPE, when, run: () => sim.togglePlay() });
    keymap.register({ id: 'propfirm.step', keys: 'arrowright', label: 'Replay: avanzar una barra', category: 'Prop firm', scope: PROPFIRM_SCOPE, when, run: () => sim.step() });
    keymap.register({ id: 'propfirm.skip-day', keys: 'alt+d', label: 'Replay: saltar día', category: 'Prop firm', scope: PROPFIRM_SCOPE, when, run: () => sim.skipDay() });

    let popScope: (() => void) | null = null;
    const syncScope = (): void => {
        const active = sim.state.bars.length > 0;
        if (active && !popScope) popScope = keymap.pushScope(PROPFIRM_SCOPE);
        else if (!active && popScope) {
            popScope();
            popScope = null;
        }
    };
    syncScope();
    const off = sim.on('change', syncScope);
    return () => {
        off();
        popScope?.();
        for (const id of ['propfirm.play', 'propfirm.step', 'propfirm.skip-day']) keymap.unregister(id);
    };
}
