// Cargar un CSV grande (años de datos intradía) con parseCSV() de una sola pasada congela la
// pestaña — el navegador termina mostrando "Page Unresponsive" porque el hilo principal queda
// bloqueado varios segundos sin ceder control. Acá se reusa parseCSV() TAL CUAL (misma lógica
// línea por línea que el HTML original, sin tocarla — paridad) pero invocada sobre pedazos del
// archivo, cediendo el control del hilo entre cada uno con un setTimeout(0).
import { parseCSV, type SimBar, type TradingDayCutoff } from '../engine/data';

const CHUNK_LINES = 20_000;

/** Mismo resultado que `parseCSV(text, cutoff)` de una sola pasada (se ordena una última vez al
 *  juntar todos los pedazos, por si el archivo no venía cronológico), pero sin bloquear el hilo
 *  principal por más de un puñado de milisegundos seguidos. */
export async function parseCSVAsync(text: string, cutoff: TradingDayCutoff | null, onProgress?: (done: number, total: number) => void): Promise<SimBar[]> {
    const lines = text.trim().split(/\r?\n/);
    const out: SimBar[] = [];
    for (let i = 0; i < lines.length; i += CHUNK_LINES) {
        const chunk = lines.slice(i, i + CHUNK_LINES).join('\n');
        out.push(...parseCSV(chunk, cutoff));
        onProgress?.(Math.min(i + CHUNK_LINES, lines.length), lines.length);
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
    out.sort((a, b) => a.t.getTime() - b.t.getTime());
    return out;
}
