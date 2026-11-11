// 서버 진입점. 포트는 PORT 환경변수 (없으면 2567). Colyseus Cloud에서는 Cloud가 정한다.
import { listen } from '@colyseus/tools';
import { server } from './app.config';

void listen(server);
