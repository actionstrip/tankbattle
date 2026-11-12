// 서버를 build/index.js 하나로 묶는다.
// - 공용 패키지(@games/common, 게임별 @<게임>/shared)는 소스째 포함 → 배포할 때 packages/ 가 없어도 된다
//   새 게임을 추가하면 아래 SHARED 에 한 줄 추가 (tsconfig.json paths 와 같게)
// - colyseus 등 package.json dependencies 는 묶지 않고 node_modules 에서 읽는다
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'tsup';

const pkg = (dir: string) => fileURLToPath(new URL(`../../packages/${dir}/src/index.ts`, import.meta.url));

const SHARED: Record<string, string> = {
  '@games/common': pkg('common'),
  '@fortress/shared': pkg('fortress-shared'),
};

export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'build',
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  clean: true,
  noExternal: Object.keys(SHARED),
  esbuildOptions(options) {
    options.alias = SHARED;
  },
});
