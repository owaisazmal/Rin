/**
 * Tests cover the pure logic only: streaks, deadlines, history, what the month
 * and task stores accept off disk, and the session adapter. None of it renders,
 * so this runs in plain Node rather than a React Native environment — faster,
 * and it keeps the suite honest about what it actually exercises.
 */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/__tests__/**/*.test.ts'],
  clearMocks: true,
  // generated native projects and the scratch worktrees each carry their own
  // package.json, which Jest would otherwise treat as a duplicate of this one
  modulePathIgnorePatterns: [
    '<rootDir>/ios/',
    '<rootDir>/android/',
    '<rootDir>/.claude/',
  ],
  // @noble/* ship ESM only. Metro reads them as-is; Jest needs to be told to
  // transform them, since it skips node_modules by default.
  transformIgnorePatterns: ['node_modules/(?!@noble/)'],
};
