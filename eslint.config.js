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
    files: ['tools/**/*.{js,mjs}', 'packages/*/test/**/*.ts', 'apps/server/**/*.{ts,js,mjs,cjs}'],
    languageOptions: { globals: globals.node },
  },
  // CommonJS 설정 파일 (PM2 ecosystem 등)
  {
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: globals.node },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  // 공용 로직(모든 게임 공용 common, 게임별 *-shared)은 서버(Node)에서도 돌아야 하므로
  // 게임 엔진·브라우저 전용 코드를 쓰지 않는다. (브라우저 공용 코드는 packages/web)
  {
    files: ['packages/common/src/**/*.ts', 'packages/*-shared/src/**/*.ts'],
    languageOptions: { globals: {} },
    rules: {
      'no-restricted-imports': ['error', { patterns: ['phaser', 'phaser/*', 'pixi.js', 'pixi.js/*', 'howler', '@games/web'] }],
      'no-restricted-globals': ['error', 'window', 'document', 'location', 'navigator'],
    },
  },
);
