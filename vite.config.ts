import { defineConfig } from 'vite';

export default defineConfig({
  // Keep legacy runtime files as separate, inspectable assets while the
  // application transitions from classic globals to modules.
  build: {
    assetsInlineLimit: 0
  }
});
