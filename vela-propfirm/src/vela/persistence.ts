// Las preferencias del simulador viajan DENTRO del documento de estado del shell (`persist`,
// getState/applyState), bajo su propia clave, en vez de en un store paralelo que pueda desfasarse.
import { registerStatePersistence } from '@luxalgo/vela/plugin';
import { applyPrefs, prefsFromState } from '../engine/prefs';
import { retagBarsWithCutoff } from '../engine/data';
import { getSimulator } from './context';

export const PREFS_KEY = 'propfirm.prefs';

registerStatePersistence({
    key: PREFS_KEY,
    scope: 'global',
    serialize: () => {
        const sim = getSimulator();
        return sim ? prefsFromState(sim.state) : undefined;
    },
    restore: (payload) => {
        const sim = getSimulator();
        if (!sim) return;
        const before = sim.state.tradingDayCutoff;
        if (!applyPrefs(sim.state, payload)) return;
        const after = sim.state.tradingDayCutoff;
        if (before.h !== after.h || before.m !== after.m) retagBarsWithCutoff(sim.state.bars, after);
        sim.hooks.render();
    },
});
