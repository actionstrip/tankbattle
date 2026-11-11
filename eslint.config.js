import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist', '**/build', '**/node_modules', '.claude', '.agents'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: globals.browser,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  // Node에서 도는 스크립트·테스트·서버
  {
    files: ['tools/**/*.{js,mjs}', 'packages/shared/test/**/*.ts', 'apps/server/**/*.{ts,js,mjs,cjs}'],
    languageOptions: { globals: globals.node },
  },
  // CommonJS 설정 파일 (PM2 ecosystem 등)
  {
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: globals.node },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  // 공용 로직은 서버(Node)에서도 돌아야 하므로 Phaser·브라우저 전용 코드를 쓰지 않는다.
  {
    files: ['packages/shared/src/**/*.ts'],
    languageOptions: { globals: {} },
    rules: {
      'no-restricted-imports': ['error', { patterns: ['phaser', 'phaser/*', 'howler'] }],
      'no-restricted-globals': ['error', 'window', 'document', 'location', 'navigator'],
    },
  },
);
