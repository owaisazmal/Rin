// Needs a running Firestore emulator, so it runs through `npm run test:rules`, not `npm test`
module.exports = {
  rootDir: '..',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/firebase/**/*.test.ts'],
  testTimeout: 20000,
  modulePathIgnorePatterns: ['<rootDir>/ios/', '<rootDir>/android/', '<rootDir>/.claude/'],
  transformIgnorePatterns: ['node_modules/(?!@noble/)'],
};
