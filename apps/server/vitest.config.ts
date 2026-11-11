import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 테스트 파일마다 Colyseus 서버를 띄우므로 한 파일씩 차례로 실행한다 (매치메이커가 프로세스 전역)
    fileParallelism: false,
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});
