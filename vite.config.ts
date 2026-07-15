import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    proxy: {
      '/v1': {
        target: 'http://127.0.0.1:3000',
        ws: true
      }
    }
  },
  // Keep legacy runtime files as separate, inspectable assets while the
  // application transitions from classic globals to modules.
  build: {
    assetsInlineLimit: 0
  }
});
