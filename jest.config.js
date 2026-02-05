module.exports = {
  testEnvironment: 'node',
  testMatch: [
    '**/tests/**/*.test.js',
    '**/*.test.js'
  ],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/tests/e2e/'  // E2E tests run separately
  ],
  collectCoverageFrom: [
    '*.js',
    '!jest.config.js',
    '!coverage/**'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  verbose: true,
  testTimeout: 30000,
  
  // Setup files
  setupFilesAfterEnv: ['./tests/setup.js'],
};
