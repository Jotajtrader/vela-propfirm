// Las contribuciones de Vela (attachments, paneles, acciones) se registran a nivel de módulo y no
// reciben instancias: acá viven el simulador y el provider activos para que puedan alcanzarlos.
import type { Simulator } from '../engine/Simulator';
import type { ReplayProvider } from './ReplayProvider';

let sim: Simulator | null = null;
let provider: ReplayProvider | null = null;

export function setPropFirmContext(s: Simulator, p: ReplayProvider): void {
    sim = s;
    provider = p;
}

export function getSimulator(): Simulator | null {
    return sim;
}

export function getReplayProvider(): ReplayProvider | null {
    return provider;
}
