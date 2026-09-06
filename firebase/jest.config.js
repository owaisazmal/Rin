/**
 * The rules suite talks to a running Firestore emulator, so it is kept out of
 * `npm test` and run through `npm run test:rules`, which starts one for it.
 */
module.exports = {
  rootDir: '..',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/firebase/**/*.test.ts'],
  testTimeout: 20000,
  modulePathIgnorePatterns: ['<rootDir>/ios/', '<rootDir>/android/', '<rootDir>/.claude/'],
};
