import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    /**
     * Proxy /api to the Express server instead of calling it cross-origin.
     *
     * This is the decision that makes cookie auth painless in development: the
     * browser only ever talks to localhost:5173, so the session cookie is
     * same-origin -- no CORS preflight, no SameSite=None, no `secure` cookie
     * being dropped over http. It also mirrors production, where the built
     * assets are served from the same origin as the API.
     */
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: false,
      },
    },
  },
  build: { outDir: 'dist', sourcemap: true },
});
