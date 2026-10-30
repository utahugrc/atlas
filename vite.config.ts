import tailwindcss from '@tailwindcss/vite';
import googleSecrets from '@ugrc/vite-plugin-google-secrets';
import react from '@vitejs/plugin-react';
import loadVersion from 'vite-plugin-package-version';
import { defineConfig } from 'vitest/config';

const arcgisCorePath = new URL('./node_modules/@arcgis/core', import.meta.url).pathname;

export default defineConfig({
  optimizeDeps: {
    include: ['firebase/analytics', 'firebase/app', 'firebase/performance'],
  },
  plugins: [
    googleSecrets({
      projectId: 'ut-dts-ugrc-atlas-dev',
      secrets: {
        VITE_DISCOVER: 'VITE_DISCOVER',
        VITE_WEB_API: 'VITE_WEB_API',
        VITE_FIREBASE_CONFIG: 'VITE_FIREBASE_CONFIG',
      },
    }),
    tailwindcss(),
    react(),
    loadVersion(),
  ],
  resolve: {
    alias: [
      {
        find: /^@arcgis\/core\/(.*)$/,
        replacement: `${arcgisCorePath}/$1`,
      },
      {
        find: '@arcgis/core',
        replacement: arcgisCorePath,
      },
      {
        find: 'use-sync-external-store/shim/index.js',
        replacement: 'react',
      },
    ],
    // this is only applicable when pnpm-linking the utah-design-package
    // dedupe: ['firebase', '@arcgis/core', '@arcgis/lumina', '@arcgis/map-components', 'react', 'react-dom'],
  },
  test: {
    environment: 'happy-dom',
  },
});
