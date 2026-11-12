// PM2 실행 설정. Colyseus Cloud도 이 파일을 읽어 서버를 띄운다.
//   로컬 운영: 루트에서 npm run server:start (빌드 → PM2 로 상시 실행)
// 프로세스를 여러 개 띄우려면 Redis가 필요하다 (src/scaling.ts 참고). 로컬 PC는 1개로 충분하다.
const os = require('node:os');

const cloud = process.env.COLYSEUS_CLOUD !== undefined;

module.exports = {
  apps: [
    {
      name: 'game-server',
      // 어디서 pm2 를 실행하든 이 폴더 기준으로 build/index.js 를 찾는다
      cwd: __dirname,
      script: 'build/index.js',
      time: true,
      watch: false,
      instances: cloud ? os.cpus().length : 1,
      exec_mode: 'fork',
      wait_ready: true, // @colyseus/tools listen()이 준비되면 알린다
      listen_timeout: 15000,
      // 갑자기 죽으면 다시 띄운다 (계속 죽으면 간격을 늘려 가며)
      autorestart: true,
      exp_backoff_restart_delay: 200,
      env_production: {
        NODE_ENV: 'production',
        PORT: 2567,
      },
    },
  ],
};
