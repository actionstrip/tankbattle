# 테스트 기간 운영 방법

테스트를 계속하면서 클라이언트를 고쳐 나가는 동안의 하루 운영 순서다. 명령은 모두 프로젝트 루트(`E:\inetpub\wwwroot\test\pixi_ai\fortress`)에서 실행한다.

## 하루 흐름

### 출근해서 한 번
```
npm run server:start
```
게임 서버(PM2, 2567)와 테스터용 IIS 클라이언트가 함께 준비된다.
- 테스터 접속 주소: `http://10.1.7.63/test/pixi_ai/fortress/apps/client/dist/`

### 내가 개발할 때
```
npm run dev:client
```
- `npm run dev`(서버+클라이언트) 대신 **클라이언트만** 띄운다.
- 개발용 클라이언트(`localhost:5173`)가 이미 떠 있는 PM2 서버(2567)에 그대로 붙는다 → 포트 충돌 없음.
- 저장하면 바로 반영(HMR)되고, 테스터와 같은 서버라 같은 방에서 대전할 수도 있다.

### 고친 걸 테스터에게 내보낼 때

| 바꾼 것 | 할 일 |
|---|---|
| 클라이언트만 (`apps/client`) | `npm run build -w @fortress/client` — 서버는 그대로. 테스터는 새로고침만 하면 새 버전 |
| 서버나 shared (`apps/server`, `packages/shared`) | `npm run server:start` — 다시 빌드하고 서버 재시작 |

### 퇴근 전
```
npm run server:stop
```
켜 둬도 부담은 적지만, PC가 절전에 들어가면 어차피 접속이 안 되므로 끄는 게 깔끔하다.

## 주의할 점
- **서버를 재시작하면 진행 중인 게임이 사라진다** (방 정보가 메모리에만 있음). 테스터가 게임 중이 아닐 때 재시작하거나 미리 알린다. 재시작 뒤에는 새로고침하고 방을 다시 만든다.
- **클라이언트·서버가 주고받는 형식을 바꿨다면 둘 다 내보낸다.** 메시지나 동기화 상태(Schema)를 바꾸면 `npm run server:start`를 실행하고 테스터도 새로고침해야 한다. 안 그러면 예전 클라이언트가 새 서버와 맞지 않아 오류가 난다.
- **PM2 서버에서는 개발 도구가 꺼져 있다** (운영 모드라 `/playground`, `/monitor` 안 열림). 서버 쪽을 집중해서 디버깅할 때만 `npm run server:stop` → `npm run dev`로 바꿔 작업한다.
- **서버 로그는 `npm run server:logs`로 본다.** 테스터가 "튕겼다"고 하면 여기서 오류를 먼저 확인한다.
