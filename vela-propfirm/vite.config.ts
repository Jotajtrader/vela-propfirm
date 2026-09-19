import { defineConfig } from 'vite';

// Playground en 5193 (Vela usa 5190, Vela-pinets 5192). `dedupe` garantiza UNA sola copia de
// Vela en la página: vela-pinets la declara como peer y una segunda copia duplicaría los
// registros del SDK (acciones, paneles, tipos de chart), no solo los bytes.
export default defineConfig({
    root: 'playground',
    server: { port: 5193, strictPort: true },
    resolve: { dedupe: ['@luxalgo/vela'] },
});
