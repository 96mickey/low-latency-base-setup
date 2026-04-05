module.exports = {
  root: true,
  env: {
    node: true,
    es2022: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    project: './tsconfig.json',
  },
  plugins: ['@typescript-eslint', 'import'],
  extends: [
    'airbnb-base',
    'airbnb-typescript/base',
  ],
  rules: {
    'import/prefer-default-export': 'off',
    'import/extensions': ['error', 'ignorePackages', { ts: 'never', js: 'always' }],
    'no-console': ['warn', { allow: ['warn', 'error'] }],
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
  },
  ignorePatterns: ['dist/', 'node_modules/', 'coverage/', '*.cjs'],
  overrides: [
    {
      files: ['src/helpers/cidrMatcher.ts'],
      rules: {
        'no-bitwise': 'off',
        'no-restricted-syntax': 'off',
        'no-continue': 'off',
      },
    },
    {
      files: ['src/helpers/lruMap.ts'],
      rules: {
        'no-restricted-syntax': 'off',
        'class-methods-use-this': 'off',
        'no-param-reassign': 'off',
      },
    },
    {
      files: ['src/connectors/redis/syncTask.ts'],
      rules: {
        'no-restricted-syntax': 'off',
        'no-continue': 'off',
      },
    },
    {
      files: ['src/connectors/redis/factory.ts'],
      rules: {
        '@typescript-eslint/no-empty-function': 'off',
      },
    },
    {
      files: ['src/middleware/rateLimit/tokenBucket.ts'],
      rules: {
        'no-param-reassign': 'off',
      },
    },
  ],
};
