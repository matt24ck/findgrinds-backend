/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  // Tests share one Postgres database, so run files serially.
  maxWorkers: 1,
  testTimeout: 30000,
  setupFiles: ['<rootDir>/tests/setup/env.ts'],
  setupFilesAfterEnv: ['<rootDir>/tests/setup/mocks.ts', '<rootDir>/tests/setup/db.ts'],
  globalSetup: '<rootDir>/tests/setup/globalSetup.ts',
  moduleNameMapper: {
    '^uuid$': '<rootDir>/tests/setup/uuid-shim.js',
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.test.json' }],
  },
};
