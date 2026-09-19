// El puente entre el ticket flotante sobre el chart (order-ticket.ts) y el panel de orden acoplado
// a la derecha (panel-order.ts): un pedido "sin ATM" pendiente, con un nonce que distingue un click
// nuevo de Comprar/Vender de una simple reapertura manual del panel (que retoma donde quedó, sin
// resetear campos ni el cuadro ya dibujado en el chart).
import type { Side } from '../engine/types';

export interface PendingOrder {
    side: Side;
    qty: number;
    nonce: number;
}

let pending: PendingOrder | null = null;
let counter = 0;

export function requestOrder(side: Side, qty: number): void {
    pending = { side, qty, nonce: ++counter };
}

export function currentPendingOrder(): PendingOrder | null {
    return pending;
}
