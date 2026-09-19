// El puente entre lo que pasa sobre el chart (el ticket de Comprar/Vender, o arrastrar el SL/TP de
// una posición ya abierta) y el panel de orden acoplado a la derecha (panel-order.ts). Un `nonce`
// nuevo dispara un reset total en el panel; reabrir sin nonce nuevo (el usuario solo cambió de
// pestaña sin confirmar) retoma exactamente donde quedó.
import type { Side } from '../engine/types';

export interface NewOrderRequest {
    kind: 'new';
    side: Side;
    qty: number;
    nonce: number;
}

/** El usuario arrastró el SL o el TP de una posición YA ABIERTA — pide confirmación antes de aplicar. */
export interface AdjustRequest {
    kind: 'adjust';
    field: 'sl' | 'tp';
    /** Precio absoluto al que quedó el handle tras soltar. */
    price: number;
    nonce: number;
}

export type PendingRequest = NewOrderRequest | AdjustRequest;

let pending: PendingRequest | null = null;
let counter = 0;

export function requestOrder(side: Side, qty: number): void {
    pending = { kind: 'new', side, qty, nonce: ++counter };
}

export function requestAdjust(field: 'sl' | 'tp', price: number): void {
    pending = { kind: 'adjust', field, price, nonce: ++counter };
}

export function currentPendingRequest(): PendingRequest | null {
    return pending;
}
