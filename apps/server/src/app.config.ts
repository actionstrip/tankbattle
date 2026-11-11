// 서버 정의. 클라이언트는 `import type { server }`로 방 이름·옵션·상태·메시지 타입을 그대로 가져다 쓴다.
import { LobbyRoom, defineRoom, defineServer } from 'colyseus';
import { monitor } from '@colyseus/monitor';
import { playground } from '@colyseus/playground';
import { ROOMS } from '@fortress/shared';
import { FortressRoom } from './rooms/FortressRoom';
import { scalingOptions } from './scaling';

const production = process.env.NODE_ENV === 'production';

export const server = defineServer({
  rooms: {
    // 방 목록 화면용: 접속해 있으면 방이 생기고 바뀔 때마다 목록을 받는다
    [ROOMS.LOBBY]: defineRoom(LobbyRoom),
    [ROOMS.FORTRESS]: defineRoom(FortressRoom).enableRealtimeListing(),
  },

  ...(await scalingOptions()),

  express: (app) => {
    // IIS·Cloud 상태 확인용
    app.get('/health', (_req, res) => {
      res.json({ ok: true });
    });

    // 개발 도구는 개발 환경에서만 (운영에서 열려면 보호 미들웨어를 use 옵션으로 넘길 것)
    if (!production) {
      app.use('/playground', playground());
      app.use('/monitor', monitor());
    }
  },
});

export default server;
