/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/evals'],
  testMatch: ['**/*.test.ts'],
  maxWorkers: 2,
  testTimeout: 120000,
  setupFiles: ['<rootDir>/evals/setup.ts'],
  moduleNameMapper: {
    '^uuid$': '<rootDir>/tests/setup/uuid-shim.js',
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.test.json' }],
  },
};
