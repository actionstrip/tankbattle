// 서버를 build/index.js 하나로 묶는다.
// - @fortress/shared(공용 로직)는 소스째 포함 → 배포할 때 packages/shared 가 없어도 된다
// - colyseus 등 package.json dependencies 는 묶지 않고 node_modules 에서 읽는다
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'build',
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  clean: true,
  noExternal: [/^@fortress\//],
  esbuildOptions(options) {
    options.alias = {
      '@fortress/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
    };
  },
});
