// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'ios/*', 'android/*', '.expo/*', '.claude/*', 'modules/*/android/build/*'],
  },
  {
    rules: {
      // React Compiler rule; `useRef(new Animated.Value(x)).current` is the React Native idiom and no compiler runs here
      'react-hooks/refs': 'off',
      // the async loads and the resets when a sheet opens set state from effects on purpose
      'react-hooks/set-state-in-effect': 'off',
    },
  },
  {
    files: ['**/__tests__/**', '**/*.test.ts', '**/*.test.tsx'],
    rules: {
      // jest.mock factories and modules loaded after a mock need require
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
]);
