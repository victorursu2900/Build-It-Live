import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { smoothKernelPlugin } from './build/smoothKernel.mjs';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react(), smoothKernelPlugin()],
  worker: { plugins: () => [smoothKernelPlugin()] },
  // Recent Models belong to the browser origin. Never silently switch from
  // localhost:5173 to 5174 and make the library appear empty.
  server: { port: 5173, strictPort: true },
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        digital: resolve(import.meta.dirname, 'digital.html'),
        hardware: resolve(import.meta.dirname, 'hardware.html'),
        brickmaker: resolve(import.meta.dirname, 'brickmaker.html'),
        tutorial: resolve(import.meta.dirname, 'tutorial.html'),
      },
    },
  },
});
