import { defineConfig } from 'vitest/config';

const coverageRun = process.argv.some(
  (arg) => arg === '--coverage' || arg.startsWith('--coverage='),
);

const coverageDir = process.env.SCAFFOLD_DEPTH === '1'
  ? '.tmp/vitest-coverage/nested'
  : '.tmp/vitest-coverage';

const sharedTest = {
  name: 'default' as const,
  root: '.' as const,
  globals: true as const,
  environment: 'node' as const,
  setupFiles: ['tests/setup.ts'] as const,
  include: ['tests/**/*.test.ts'] as const,
  exclude: ['node_modules', 'dist', 'tests/benchmarks/**'] as const,
  pool: 'forks' as const,
  poolOptions: {
    forks: {
      singleFork: true as const,
      maxForks: 1 as const,
      minForks: 1 as const,
    },
  },
  maxWorkers: 1 as const,
  minWorkers: 1 as const,
  fileParallelism: false as const,
  isolate: true as const,
  sequence: { hooks: 'stack' as const },
  reporters: ['verbose'] as const,
  testTimeout: 10_000,
  hookTimeout: 10_000,
};

const coverageTest = {
  ...sharedTest,
  pool: 'threads' as const,
  poolOptions: {
    threads: {
      singleThread: true as const,
    },
  },
};

export default defineConfig({
  test: coverageRun
    ? {
      ...coverageTest,
      coverage: {
        provider: 'v8' as const,
        reporter: ['text', 'json-summary'] as const,
        reportsDirectory: coverageDir,
        include: ['src/**/*.ts'],
        exclude: [
          'src/types/**',
          '**/*.d.ts',
          'src/index.ts',
          'src/connectors/postgres/schema.ts',
        ],
        thresholds: {
          lines: 95,
          functions: 95,
          branches: 88,
          statements: 95,
        },
      },
    }
    : sharedTest,
});
