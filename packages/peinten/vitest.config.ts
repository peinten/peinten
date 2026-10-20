import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
          exclude: ['**/*.gpu.test.ts'],
        },
      },
      {
        test: {
          name: 'gpu',
          // Dawn's native binding crashes in forked child processes on macOS; worker threads are fine.
          pool: 'threads',
          include: ['src/**/*.gpu.test.ts', 'test/**/*.gpu.test.ts'],
          setupFiles: ['test/gpu-setup.ts'],
          testTimeout: 30_000,
        },
      },
    ],
  },
});
