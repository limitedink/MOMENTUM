import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Default environment is node for most tests.
    // arena-input.test.ts uses "// @vitest-environment jsdom" to opt into a DOM environment
    // for deterministic KeyboardEvent.code injection and preventDefault verification.
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Ensure jsdom tests can still load without polluting node suites.
    environmentMatchGlobs: [
      ['tests/arena-input.test.ts', 'jsdom'],
    ],
  }
});
