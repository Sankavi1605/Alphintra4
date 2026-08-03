import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Multi-page build: without an explicit input map, `vite build` only emits
// index.html and the Careers page 404s in production.
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        careers: fileURLToPath(new URL('./careers.html', import.meta.url)),
      },
    },
  },
});
