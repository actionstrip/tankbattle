# npm 스크립트 설명

`package.json`의 `scripts`에는 주석을 달 수 없어서 여기에 정리한다.
명령은 모두 프로젝트 루트(`E:\inetpub\wwwroot\test\pixi_ai\fortress`)에서 실행한다.

## 자주 쓰는 것

| 하고 싶은 일 | 명령 |
|---|---|
| 서버 실행 (빌드 + PM2 상시 실행) | `npm run server:start` |
| 프론트 개발 실행 | `npm run dev:fortress` |
| 프론트만 빌드 | `npm run build -w @fortress/client` |
| 서버 멈춤 | `npm run server:stop` |

### 1. 서버 실행 — `npm run server:start`
빌드하고 실행한다. 실제로는 아래 세 단계를 차례로 한다.
```
npm run build  →  pm2 startOrReload apps/server/ecosystem.config.cjs --env production  →  pm2 save
```
1. `npm run build`: 모든 workspace 빌드
   - 서버 → `apps/server/build/index.js`
   - 탱크배틀 클라이언트 → 타입 검사 후 `apps/fortress/dist` (테스터용 화면도 같이 새 버전이 됨)
2. `pm2 startOrReload`: 꺼져 있으면 시작, 떠 있으면 새 빌드로 재시작. PM2 이름 `game-server`, 포트 2567.
   **재시작하면 진행 중이던 게임 방은 사라진다.**
3. `pm2 save`: 지금 PM2 목록 저장.

- 빌드 중 타입 오류가 나면 거기서 멈추고 서버는 재시작되지 않는다 (떠 있던 예전 서버가 그대로 돈다).
- 서버 코드(`apps/server`)나 공용 코드(`packages/*`)를 바꿨을 때도 이 명령으로 다시 빌드·재시작한다.
- 2026-11 폴더 정리 후 **처음 한 번만** 먼저 `npx pm2 delete fortress-server` (예전 이름의 서버 지우기).

### 2. 프론트 개발 실행 — `npm run dev:fortress`
- 탱크배틀 개발용 클라이언트를 `localhost:5173`에 띄운다. 저장하면 바로 반영(HMR).
- 이미 떠 있는 PM2 서버(2567)에 그대로 붙는다 → 테스터와 같은 서버에서 같이 대전 가능.
- 예전 이름 `npm run dev:client`도 같은 동작.

### 3. 프론트만 빌드 — `npm run build -w @fortress/client`
- 서버는 건드리지 않고 `apps/fortress/dist`만 새로 만든다.
- 테스터는 새로고침만 하면 새 버전. 테스터 주소: `http://10.1.7.63/test/pixi_ai/fortress/apps/fortress/dist/`
- 단, 클라이언트·서버가 주고받는 형식(메시지, 상태)을 바꿨다면 서버도 같이 내보내야 한다 → `npm run server:start`.

### 4. 서버 멈춤 — `npm run server:stop`
- PM2의 `game-server`를 멈춘다. 진행 중이던 게임 방은 사라진다.

## 전체 목록

| 스크립트 | 하는 일 |
|---|---|
| `dev` | 서버(`dev:server`) + 탱크배틀 클라이언트(`dev:fortress`)를 함께 개발 모드로 실행. 서버도 저장하면 자동 재시작. PM2 서버와 포트(2567)가 겹치므로 먼저 `server:stop` |
| `dev:fortress` | 탱크배틀 클라이언트 개발 서버 (Vite, 5173) |
| `dev:client` | `dev:fortress`의 예전 이름 (같은 동작) |
| `dev:server` | 게임 서버만 개발 모드로 실행 (`tsx watch`, 저장하면 재시작, `/playground`·`/monitor` 열림) |
| `start:server` | 빌드된 서버(`apps/server/build/index.js`)를 PM2 없이 바로 실행 (먼저 `build` 필요) |
| `build` | 모든 workspace 빌드 (서버 + 클라이언트) |
| `typecheck` | 모든 workspace 타입 검사 |
| `test` | 모든 workspace 테스트 (공용 로직 + 서버 방) |
| `lint` / `lint:fix` | ESLint 검사 / 자동 수정 |
| `build:mask` | 땅 이미지(`stage1_ground.png`)로 충돌 마스크(`packages/fortress-shared/src/stage1Mask.ts`) 다시 만들기. 땅 그림을 바꿨을 때만 |
| `server:start` | 빌드 → PM2로 서버 시작·재시작 → 목록 저장 (위 1번) |
| `server:stop` | PM2 서버 멈춤 |
| `server:status` | PM2 상태 확인 (실행 중인지, 재시작 횟수, 메모리) |
| `server:logs` | 서버 로그 최근 100줄 + 실시간 보기 (Ctrl+C로 나옴). 테스터가 "튕겼다"고 하면 여기부터 확인 |

`-w <패키지명>`을 붙이면 그 workspace의 스크립트만 실행한다.
패키지명: `@fortress/client`(apps/fortress), `@games/server`(apps/server), `@fortress/shared`, `@games/common`, `@games/web`.

하루 운영 순서는 [daily-operation.md](daily-operation.md), 새 게임 추가는 [adding-a-game.md](adding-a-game.md) 참고.
