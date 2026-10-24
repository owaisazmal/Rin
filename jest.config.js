// a zone with daylight saving, so local-date tests run the same on every machine
process.env.TZ = 'America/Los_Angeles';

module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/__tests__/**/*.test.ts'],
  clearMocks: true,
  // these carry their own package.json, which Jest would treat as a duplicate
  modulePathIgnorePatterns: ['<rootDir>/ios/', '<rootDir>/android/', '<rootDir>/.claude/'],
  // @noble/* ship ESM only
  transformIgnorePatterns: ['node_modules/(?!@noble/)'],
};
