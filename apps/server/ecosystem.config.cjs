// PM2 실행 설정. Colyseus Cloud도 이 파일을 읽어 서버를 띄운다.
//   로컬: npm run build -w @fortress/server  →  npx pm2 start ecosystem.config.cjs --env production
// 프로세스를 여러 개 띄우려면 Redis가 필요하다 (src/scaling.ts 참고). 로컬 PC는 1개로 충분하다.
const os = require('node:os');

const cloud = process.env.COLYSEUS_CLOUD !== undefined;

module.exports = {
  apps: [
    {
      name: 'fortress-server',
      script: 'build/index.js',
      time: true,
      watch: false,
      instances: cloud ? os.cpus().length : 1,
      exec_mode: 'fork',
      wait_ready: true, // @colyseus/tools listen()이 준비되면 알린다
      env_production: {
        NODE_ENV: 'production',
      },
    },
  ],
};
