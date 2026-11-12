# 저장소 구조와 새 게임 추가 방법

이 저장소는 여러 게임을 담는 모노레포다. 게임 서버는 **하나**(Colyseus, 포트 2567, PM2 `game-server`)이고,
게임마다 클라이언트 앱과 공용 로직 패키지를 따로 둔다.

## 구조
```
apps/
  fortress/              탱크배틀 클라이언트 (Phaser 4)          @fortress/client
  server/                게임 서버 (모든 게임의 방)               @games/server
    src/app.config.ts      방 등록 (LobbyRoom 하나를 모든 게임이 같이 씀)
    src/common/            게임 공통 방 코드 (chat.ts: 채팅)
    src/fortress/          탱크배틀 방 (FortressRoom, Match, schema/)
    test/fortress/
packages/
  common/                모든 게임 공용, 서버·브라우저 (DOM·엔진 금지)  @games/common
                           cleanText, ChatMessage, CHAT·COMMON 제한값
  web/                   모든 게임 공용, 브라우저 전용                  @games/web
                           ChatLog·ChatBox(채팅창), serverUrl, GameStorage(이름·재접속 토큰)
  fortress-shared/       탱크배틀 규칙·물리 (서버·클라 공용)            @fortress/shared
```

## 규칙
- **게임끼리는 서로 import 하지 않는다.** 두 게임 이상이 쓰게 되는 것만 `packages/common`(서버도 씀) 또는 `packages/web`(브라우저만)으로 옮긴다.
- `packages/common`, `packages/*-shared`는 서버(Node)에서도 돌아야 하므로 DOM·게임 엔진(Phaser, Pixi, Howler)을 쓰지 않는다 (eslint가 막음).
- 서버는 공용 패키지를 npm 의존성이 아니라 **소스째 묶는다** (`apps/server/tsconfig.json`의 `paths`, `tsup.config.ts`의 `SHARED`). 새 패키지를 서버에서 쓰면 두 곳에 같이 추가한다.

## 새 게임 추가 순서 (예: 오목 `omok`)
1. **공용 로직** `packages/omok-shared/` — `package.json` 이름 `@omok/shared`, `exports: ./src/index.ts`,
   `dependencies: { "@games/common": "*" }`. 판·규칙·방 이름(`ROOMS.OMOK = 'omok'`)·옵션 타입. vitest로 규칙 테스트.
2. **서버 방** `apps/server/src/omok/OmokRoom.ts` (+ `schema/`)
   - 채팅: `private readonly chat: RoomChat = new RoomChat(this, (c) => ...)` 후 `messages = { ...this.chat.handlers, ... }`, `onLeave`에서 `this.chat.forget(id)`.
   - `app.config.ts`에 `[ROOMS.OMOK]: defineRoom(OmokRoom).enableRealtimeListing()` 추가.
   - `tsconfig.json` paths, `tsup.config.ts` SHARED 에 `@omok/shared` 추가.
   - 테스트는 `apps/server/test/omok/` (테스트 파일마다 다른 포트로 `boot`).
3. **클라이언트** `apps/omok/` — Vite 앱 (`base: './'`), `package.json` 이름 `@omok/client`,
   의존성 `@omok/shared`, `@games/web`, `@colyseus/sdk`. `public/web.config`는 `apps/fortress/public/web.config`를 복사.
   - 방 목록: `client.joinOrCreate('lobby', { filter: { name: 'omok' } })` — 같은 LobbyRoom을 방 이름으로 걸러 쓴다.
   - 채팅·저장: `new ChatLog(room)`, `new ChatBox(log, 'docked' | 'floating', …)`, `new GameStorage('omok')`, `serverUrl(import.meta.env.VITE_SERVER_URL)`.
   - 서버 타입: `import type { server } from '../../../server/src/app.config'` 로 방·메시지 타입을 자동으로 맞춘다.
4. **루트** `package.json`에 `dev:omok` 스크립트, `npm install`로 workspace 연결.
5. **배포**: `npm run build -w @omok/client` → IIS 주소 `http://<호스트>/test/pixi_ai/fortress/apps/omok/dist/`.
   서버는 `npm run server:start`로 다시 빌드·재시작(방 종류만 늘어남).
   루트 `web.config`가 소스 폴더(src, public, packages, server 등)를 숨기므로 dist 외에는 웹에 보이지 않는다.

## 확인
`npm run typecheck`, `npm test`, `npm run lint` — 모든 workspace를 한 번에 검사한다.
