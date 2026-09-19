// El puente motor ↔ ReplayProvider ↔ chart. Escucha cada `change` del simulador y:
//  - un avance de UNA barra se empuja por `subscribe` (Vela recalcula indicadores solo);
//  - cualquier otro movimiento del cursor (saltar día, ir a fecha, modo rápido, Reset, datos
//    nuevos) mueve el cursor del provider y fuerza una recarga del mercado (la caché de barras
//    cerradas de Vela se vacía y la identidad del mercado cambia con un flip de sesión).
// Además publica el payload del overlay en cada cambio.
import type { Simulator } from '../engine/Simulator';
import type { SimBar } from '../engine/data';
import type { ReplayProvider } from './ReplayProvider';
import { buildOverlay, pushOverlay } from './overlay';

export interface BridgeChart {
    setMarket(next: { session?: string }): Promise<unknown>;
}

export interface ReplayBridgeDeps {
    chart: () => BridgeChart;
    /** Vacía la caché de barras cerradas de Vela antes de recargar. */
    clearCache: () => void;
}

export class ReplayBridge {
    private generation = 0;
    private lastBars: readonly SimBar[] | null;
    private reloading = false;
    private pendingSync = false;
    private readonly off: () => void;
    /** Recargas forzadas realizadas (telemetría/tests). */
    reloads = 0;

    constructor(
        private readonly sim: Simulator,
        private readonly provider: ReplayProvider,
        private readonly deps: ReplayBridgeDeps,
    ) {
        // Semilla inicial sin recarga: el chart que se construya después ya lee estos datos.
        this.provider.load(sim.state.bars, sim.state.idx);
        this.lastBars = sim.state.bars;
        pushOverlay(buildOverlay(sim.state));
        this.off = sim.on('change', () => void this.sync());
    }

    async sync(): Promise<void> {
        const st = this.sim.state;
        pushOverlay(buildOverlay(st));
        if (st.bars !== this.lastBars) {
            this.lastBars = st.bars;
            this.provider.load(st.bars, st.idx);
            await this.reload();
            return;
        }
        const cur = this.provider.cursor;
        if (st.idx === cur) return;
        if (st.idx === cur + 1) {
            this.provider.step();
            return;
        }
        this.provider.setCursor(st.idx);
        await this.reload();
    }

    private async reload(): Promise<void> {
        if (this.reloading) {
            this.pendingSync = true;
            return;
        }
        this.reloading = true;
        try {
            this.deps.clearCache();
            this.generation++;
            this.reloads++;
            await this.deps.chart().setMarket({ session: this.generation % 2 ? 'extended' : 'regular' });
        } finally {
            this.reloading = false;
            if (this.pendingSync) {
                this.pendingSync = false;
                void this.sync();
            }
        }
    }

    destroy(): void {
        this.off();
        pushOverlay(null);
    }
}
