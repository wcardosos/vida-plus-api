import { defineConfig } from 'vitest/config';
import { testDatabaseUrl } from './tests/integration/test-database';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          globalSetup: ['tests/integration/global-setup.ts'],
          fileParallelism: false,
          env: {
            NODE_ENV: 'test',
            DATABASE_URL: testDatabaseUrl,
            TRUST_PROXY: 'false',
          },
        },
      },
    ],
  },
});
