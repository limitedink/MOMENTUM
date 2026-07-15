import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  // Keep legacy runtime files as separate, inspectable assets while the
  // application transitions from classic globals to modules.
  build: {
    assetsInlineLimit: 0
  }
});
