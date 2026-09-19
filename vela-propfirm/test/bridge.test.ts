import { describe, expect, it } from 'vitest';
import { genSample } from '../src/engine/data';
import { Simulator } from '../src/engine/Simulator';
import { ReplayProvider } from '../src/vela/ReplayProvider';
import { ReplayBridge } from '../src/vela/bridge';
import { currentOverlay } from '../src/vela/overlay';

function seeded(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function setup() {
    const sim = new Simulator({ rng: seeded(1) });
    sim.loadBars(genSample(3, 120, { h: 17, m: 0 }, seeded(2)));
    const provider = new ReplayProvider();
    const pushes: number[] = [];
    provider.subscribe('NQ', '1', (b) => pushes.push(b.time));
    const reloads: { session?: string }[] = [];
    let cleared = 0;
    const bridge = new ReplayBridge(sim, provider, {
        chart: () => ({
            setMarket: async (next) => {
                reloads.push(next);
            },
        }),
        clearCache: () => cleared++,
    });
    return { sim, provider, bridge, pushes, reloads, cleared: () => cleared };
}

describe('ReplayBridge', () => {
    it('siembra el provider con las barras del simulador sin recargar', () => {
        const { sim, provider, reloads } = setup();
        expect(provider.cursor).toBe(sim.state.idx);
        expect(provider.length).toBe(sim.state.bars.length);
        expect(reloads).toHaveLength(0);
    });

    it('un paso = un push por subscribe, sin recarga', async () => {
        const { sim, provider, pushes, reloads } = setup();
        sim.step();
        sim.step();
        await flush();
        expect(provider.cursor).toBe(sim.state.idx);
        expect(pushes).toHaveLength(2);
        expect(pushes[1]).toBe(sim.state.bars[sim.state.idx]!.t.getTime());
        expect(reloads).toHaveLength(0);
    });

    it('saltar día = mover el cursor + vaciar caché + recarga por flip de sesión', async () => {
        const { sim, provider, pushes, reloads, cleared, bridge } = setup();
        sim.skipDay();
        await flush();
        expect(provider.cursor).toBe(sim.state.idx);
        expect(pushes).toHaveLength(0);
        expect(reloads).toEqual([{ session: 'extended' }]);
        expect(cleared()).toBe(1);
        expect(bridge.reloads).toBe(1);
        sim.skipDay();
        await flush();
        expect(reloads[1]).toEqual({ session: 'regular' }); // alterna para que la identidad cambie siempre
    });

    it('reset del agente rebobina: recarga, y el stream sigue funcionando después', async () => {
        const { sim, provider, pushes, reloads } = setup();
        sim.buyAccounts(sim.state.templates[0]!, 1);
        const start = sim.state.idx;
        sim.skipDay();
        await flush();
        sim.resetAgentRun();
        await flush();
        expect(sim.state.idx).toBe(start);
        expect(provider.cursor).toBe(start);
        expect(reloads).toHaveLength(2);
        const before = pushes.length;
        sim.step();
        await flush();
        expect(pushes).toHaveLength(before + 1);
    });

    it('cargar datos nuevos recarga y el overlay sigue al estado (posición de la cuenta seleccionada)', async () => {
        const { sim, provider, reloads } = setup();
        sim.buyAccounts(sim.state.templates[0]!, 1);
        sim.openPosition(1, 2, 10, 20);
        await flush();
        const ov = currentOverlay()!;
        expect(ov.accountName).toBe(sim.state.accounts[0]!.name);
        expect(ov.position).toMatchObject({ side: 1, qty: 2, entry: sim.currentPrice() });
        expect(ov.position!.sl).toBe(sim.currentPrice() - 10);
        expect(ov.ddPrice).not.toBeNull();
        expect(ov.dailyPrice).not.toBeNull(); // t1 tiene DLL 600
        const fresh = genSample(2, 60, { h: 17, m: 0 }, seeded(9));
        sim.loadBars(fresh);
        await flush();
        expect(provider.length).toBe(fresh.length);
        expect(provider.cursor).toBe(sim.state.idx);
        expect(reloads).toHaveLength(1);
    });

    it('el modo rápido llega como UN salto (sin pushes intermedios) y una sola recarga', async () => {
        const { sim, provider, pushes, reloads } = setup();
        await sim.fastForward({ chunkMs: 5 });
        await flush();
        expect(sim.state.idx).toBe(sim.state.bars.length - 1);
        expect(provider.cursor).toBe(sim.state.idx);
        expect(pushes).toHaveLength(0);
        expect(reloads).toHaveLength(1);
    });
});
