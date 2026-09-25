import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Builds into the ASP.NET Core host's wwwroot; in development /api is proxied to the .NET server.
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': new URL('./src', import.meta.url).pathname } },
  build: {
    outDir: '../src/FurniShop.Web/wwwroot',
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://127.0.0.1:5080', changeOrigin: false } },
  },
});
