import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    base: './',
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        '/v1': {
          target: env.MOMENTUM_BACKEND_PROXY_URL || 'http://127.0.0.1:3000',
          ws: true
        }
      }
    },
    // Keep legacy runtime files as separate, inspectable assets while the
    // application transitions from classic globals to modules.
    build: {
      assetsInlineLimit: 0
    }
  };
});
