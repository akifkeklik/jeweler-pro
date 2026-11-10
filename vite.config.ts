import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';

// Vite replaces Vue CLI (in maintenance mode). `envPrefix` keeps the existing
// VUE_APP_* variables working next to the Vite-native VITE_* names, so
// existing .env files do not have to change (see src/config/env.ts).
export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      // Only the static app shell is cached; API responses never are.
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        navigateFallbackDenylist: [/^\/api\//, /^\/health/],
      },
      manifest: {
        name: 'Jeweler Pro',
        short_name: 'Jeweler Pro',
        description: 'Jewellery shop management: stock, sales, gold prices, accounts',
        lang: 'tr',
        theme_color: '#14161B',
        background_color: '#14161B',
        display: 'standalone',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  envPrefix: ['VITE_', 'VUE_APP_'],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  server: { port: 8080, strictPort: true },
  preview: { port: 8080, strictPort: true },
  build: {
    sourcemap: true,
    chunkSizeWarningLimit: 900,
  },
});
