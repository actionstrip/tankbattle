# 포트리스 네트워크 멀티플레이 전환 계획 (모노레포 + Colyseus 0.18)

## 배경
지금 포트리스는 Phaser 4 + TS + Vite로 만든 **싱글 클라이언트** 게임이다 (CPU 대전, 한 PC 2인 핫시트, 2:2 모드).
이것을 **여러 명이 각자 PC에서 접속하는 네트워크 게임**으로 바꾼다.
- 클라이언트와 서버를 한 저장소(모노레포)에서 관리
- 지금은 **직접 설치한 Colyseus 0.18 서버** 사용 (내 Windows PC, IIS 있음)
- 나중에 **Colyseus Cloud**로 옮길 때 코드를 고치지 않아도 되게 구성

현재 코드에서 확인한 사실 (설계에 영향을 줌):
- `src/projectile.ts`(탄도 계산)는 Phaser 없이 돌아가는 순수 로직이라 서버에서도 그대로 쓸 수 있다
- `src/terrain.ts`는 충돌 마스크(`solid: Uint8Array`) 로직과 Phaser/Canvas 그리기가 한 클래스에 섞여 있다. 마스크를 **브라우저 canvas로 확대한 PNG 알파값**에서 만들기 때문에 서버(Node)는 같은 마스크를 만들 수 없다
- 구덩이 모양(`carveBowl`)에 `Math.random()`, 바람에 `Phaser.Math.Between`을 쓴다 → 서버가 정해서 내려줘야 한다
- `src/tank.ts`도 상태(x, y, hp, fuel…)와 스프라이트가 한 클래스에 섞여 있다
- `GameScene.ts`(776줄)에 턴 진행, 입력, 연출이 모두 들어 있다

## 1. 핵심 설계 결정

| 항목 | 결정 | 이유 |
|---|---|---|
| 모노레포 도구 | **npm workspaces** (Turborepo는 필요해지면 추가) | 이미 npm/package-lock 사용 중, 추가 도구 없음 |
| 서버 | **Colyseus 0.18** (`colyseus` 0.18.x + `@colyseus/schema` 5.x + `@colyseus/tools`) | `npm create colyseus-app@latest` 템플릿 = Cloud가 기대하는 구조 |
| 클라이언트 SDK | **`@colyseus/sdk`** (옛 `colyseus.js` 아님) | 0.17부터 패키지 이름 변경 |
| 판정 방식 | **서버가 판정 (server-authoritative)** | 턴제라 지연에 민감하지 않음. 치트 방지, 판정 불일치 없음 |
| 공용 로직 | `packages/shared`에 **Phaser 없는** 물리·지형 마스크·설정·메시지 타입 | 서버와 클라가 같은 코드로 계산 |
| 지형 마스크 | **빌드 때 미리 만든 마스크 파일**(`ground.mask`, RLE)을 양쪽이 같이 사용 | 브라우저 canvas 확대 결과가 서버와 달라지는 문제 제거 |
| 서버 빌드 | **tsup(esbuild)으로 `build/index.js` 한 파일로 묶기** (shared 코드 포함) | Cloud가 서버 폴더만 빌드해도 workspace 의존성 문제가 없음 |
| 타입 공유 | 클라가 `import type { server }`로 서버 정의를 가져와 `new Client<typeof server>()` | 방 이름·옵션·상태·메시지 타입이 서버와 자동으로 맞음 (type-only라 번들에 서버 코드가 안 들어감) |
| 로컬 운영 | IIS = 클라 정적 파일 + **ARR 리버스 프록시(WebSocket)** → Node 서버(:2567), Node는 **PM2** | Cloud와 같은 "한 주소 + wss" 구조를 로컬에서 미리 맞춤. iisnode는 관리가 끊겨 사용 안 함 |

## 2. 폴더 구조

```
fortress/
├─ package.json            # "workspaces": ["apps/*", "packages/*"], 루트 스크립트
├─ tsconfig.base.json      # 공통 컴파일 옵션 (지금 tsconfig.json 내용 이전)
├─ eslint.config.js        # 루트 하나로 전체 lint
├─ apps/
│  ├─ client/              # 지금 프로젝트를 그대로 이동 (Vite + Phaser)
│  │  ├─ index.html, vite.config.ts, public/, src/
│  │  ├─ src/net/          # NetworkController, 로비 연결 (@colyseus/sdk)
│  │  ├─ .env.development  # VITE_SERVER_URL=http://localhost:2567
│  │  └─ .env.production   # VITE_SERVER_URL=https://(도메인)/colyseus  ← Cloud 이전 시 이 줄만 변경
│  └─ server/              # Colyseus 0.18
│     ├─ src/
│     │  ├─ index.ts       # listen(app)  ← Cloud 표준 진입점
│     │  ├─ app.config.ts  # export const server = defineServer({ rooms, express })
│     │  ├─ rooms/FortressRoom.ts
│     │  ├─ rooms/schema/FortressState.ts   # schema({...}, "이름") 빌더 방식
│     │  └─ game/          # 서버 쪽 턴 진행, 서버 AI 봇
│     ├─ ecosystem.config.cjs  # PM2 설정 (Cloud도 이 파일을 읽음)
│     ├─ tsup.config.ts
│     └─ package.json      # "build": "tsup", "start": "node build/index.js"
├─ packages/
│  └─ shared/              # @fortress/shared (Phaser·DOM import 금지)
│     ├─ src/config.ts     # 무기·물리 상수 (클라 config.ts에서 순수 데이터 분리)
│     ├─ src/projectile.ts # 그대로 이동, Tank 대신 {x,y,dead} 인터페이스로
│     ├─ src/terrainMask.ts# solid 배열, isSolid/surfaceY/carve(seed)/낙하판정
│     ├─ src/rng.ts        # 시드 난수 (mulberry32)
│     ├─ src/protocol.ts   # 메시지 payload 타입 + zod 스키마 (aim, move, fire, shotResult…)
│     └─ assets/ground.mask
├─ tools/
│  └─ build-mask.ts        # stage1_ground.png → ground.mask (pngjs, 확대 규칙 고정)
└─ deploy/iis/web.config   # 정적 파일 + /colyseus 경로 WebSocket 프록시 규칙
```

## 3. 개발 스택

- 공통: Node 22 LTS (현재 22.18 설치됨), TypeScript 6, ESLint (지금 설정 재사용)
- 클라이언트: Phaser 4.1, Vite 8, Howler, `@colyseus/sdk` 0.18
- 서버: `colyseus` 0.18, `@colyseus/schema` 5, `@colyseus/tools`, `@colyseus/ws-transport`, `zod`(메시지 검증), 개발용 `@colyseus/playground`·`@colyseus/monitor`
- 서버 빌드/실행: tsup(빌드), tsx watch(개발), PM2(로컬 상시 실행, Windows 서비스 등록)
- 테스트: Vitest — shared 물리·지형 마스크 단위 테스트, `@colyseus/testing`으로 방 입장·턴 진행 테스트
- 동시 실행: 루트 `npm run dev` = `concurrently`로 client(5173) + server(2567)

## 4. 0.18 코드 규칙 (예전 버전 방식 금지)

| 쓰지 않음 (옛 방식) | 사용 (0.18) |
|---|---|
| `import { Client } from "colyseus.js"` | `import { Client, Callbacks } from "@colyseus/sdk"` |
| `new Server()` + `gameServer.define()`, `config({ initializeGameServer })` | `defineServer({ rooms: { fortress: defineRoom(FortressRoom) } })` |
| `class FortressRoom extends Room<State>` | `class FortressRoom extends Room` + `state = new FortressState()` |
| `onCreate` 안에서 `this.onMessage(...)` | 클래스 속성 `messages = { fire: validate(zodSchema, handler) }` |
| `@type("string")` 데코레이터 / `schema({ name: "string" })` | `schema({ name: t.string() }, "Player")` |
| `getStateCallbacks(room)` / `$(state).players.onAdd` | `Callbacks.get(room).onAdd("players", ...)` |
| `onLeave(client, consented)`에서 재접속 처리 | `onDrop` → `allowReconnection(client, 30)`, `onReconnect`, `onLeave`(완전 퇴장) |
| `client.id` | `client.sessionId` |
| `setSimulationInterval` | `setTimestep` (턴제라 거의 안 씀) |
| 전역 `setTimeout` | `this.clock.setTimeout()` (방이 닫힐 때 자동 정리) |
| `setMetadata({ status })` (병합 기대) | `setMetadata({ ...this.metadata, status })` (0.18은 통째로 교체) |

- 하나의 Schema는 필드 63개까지 (상속 포함). 넘으면 하위 Schema로 나눈다
- playground는 운영 환경(`NODE_ENV=production`)에서 404 → 필요하면 `use` 옵션으로 보호 미들웨어 지정

## 5. 네트워크 게임 흐름 (서버 판정)

**방 상태 `FortressState` (Schema, 자동 동기화)** — 작은 값만 넣는다
- `phase`(lobby/playing/resolving/ended), `turnIndex`, `turnEndsAt`, `wind`, `seed`
- `players: t.map(Player)` (닉네임, 팀, ready, connected) — 키는 `sessionId`
- `tanks: t.array(Tank)` (x, y, facing, elevation, hp, fuel, dead, stock)

**지형은 Schema에 넣지 않는다** (픽셀 배열은 너무 큼). 대신 구덩이 기록 `{x, y, r, seed}` 목록만 보낸다 → 중간 입장/재접속 시 처음부터 다시 적용해 같은 지형을 만든다. (재접속 시 `room.request("terrain-log")`로 받거나, 작은 배열이면 Schema에 둠)

**메시지 흐름**
1. 내 턴: 클라가 `move`(좌/우), `aim`(각도) 전송 → 서버가 shared 로직으로 이동·연료 계산 후 상태 반영 (다른 사람 화면에도 탱크가 움직임). 서버는 "보낸 사람이 지금 턴인지"를 `client.sessionId`로 확인
2. 발사: 클라는 `fire {power, weaponIndex}`만 보낸다 (zod로 범위 검증)
3. 서버: shared `simulateShot`으로 끝까지 계산 → 착탄점, 피해, 구덩이, 탱크 낙하 결과를 한 번에 정함 → `broadcast("shotResult", ...)` (포구 위치·속도·바람·착탄점·피해 목록·구덩이)
4. 모든 클라: 받은 값으로 포탄을 날리는 **연출만** 재생, 착탄 시 서버가 준 결과를 적용 (계산 오차가 있어도 서버 결과로 맞춤)
5. 서버: 연출 시간만큼 `this.clock.setTimeout`으로 기다린 뒤(`resolving`) 다음 턴. 턴 시간 초과도 서버가 처리
6. 접속 끊김: `onDrop`에서 `allowReconnection(client, 30)` + `connected=false`(그동안 턴은 자동 넘김), `onReconnect`에서 복귀, `onLeave`에서 완전 퇴장 처리. 클라는 SDK가 자동 재시도하므로 `room.onDrop`/`room.onReconnect`로 "재접속 중" 표시만. 새로고침은 `client.reconnect(token)`
7. CPU 자리: 서버에서 shared `planAiShot`으로 봇이 둔다 (`src/ai.ts` 재사용)

**클라 코드 분리**: `GameScene`이 직접 판정하지 않고 `GameController` 인터페이스를 거친다
- `LocalController` — 지금 동작 그대로 (CPU 대전, 핫시트). 내부에서 shared 로직 사용
- `NetworkController` — 입력을 서버로 보내고, `Callbacks.get(room)`으로 상태 변화·`shotResult`를 화면에 반영
→ 오프라인 모드는 그대로 남고, 같은 화면 코드를 둘 다 사용

**타이틀 화면**: "온라인 대전" 추가 → 닉네임 입력 → 방 목록/방 만들기/입장 (매치메이커) → 대기실(팀 선택·준비) → 방장이 시작

## 6. 단계별 진행 (각 단계마다 게임이 동작하는 상태로 커밋)

1. **모노레포 전환** — 지금 코드를 `apps/client`로 이동, 루트 workspaces·tsconfig.base·eslint 정리. 동작 변화 없음
2. **shared 분리** — config(순수 데이터)·projectile·rng·terrainMask를 `packages/shared`로. `Terrain`은 마스크(shared) + 그리기(클라 `TerrainView`)로, `Tank`도 상태 + 스프라이트로 나눔. `tools/build-mask.ts`로 마스크 파일 생성. 오프라인 게임 그대로 동작 확인
3. **서버 뼈대** — `npm create colyseus-app@latest`(0.18) 템플릿 구조로 `apps/server` 생성, tsup 번들로 변경, `FortressRoom` 입장/퇴장/대기실, playground로 확인
4. **온라인 대전** — Schema·메시지 구현, 클라 `NetworkController`·로비 화면. 브라우저 2개로 1:1, 이후 2:2
5. **로컬 운영 (IIS)** — 클라 `vite build` 결과를 IIS 사이트에 배포, ARR+URL Rewrite로 `/colyseus` → `localhost:2567` WebSocket 프록시, 서버는 PM2 서비스로 상시 실행
6. **Cloud 이전 준비 확인** — 아래 체크리스트 점검

## 7. Colyseus Cloud 호환 규칙 (처음부터 지킨다)
- 진입점은 `@colyseus/tools`의 `listen(app)` → 포트는 직접 정하지 않고 환경(`PORT`)에 맡긴다
- `apps/server`에 `ecosystem.config.cjs`, `npm run build` → `build/index.js` 구조 유지 (Cloud가 이 규칙으로 빌드·실행)
- 서버 빌드 결과에 shared가 묶여 있어 서버 폴더만 있어도 실행 가능 (Cloud 모노레포 지원 여부와 상관없게)
- 서버에 파일 저장·전역 상태 금지 (방 상태는 Room 안에만). 여러 프로세스 대비 `presence`/`driver`를 설정에서 바꿀 수 있게 둔다 (로컬: 기본, Cloud: Redis)
- 클라 접속 주소는 `VITE_SERVER_URL` 환경변수 하나로만 → 이전 시 이 값만 변경
- monitor/playground는 개발 환경에서만 켜고, 운영에선 보호 미들웨어 적용
- 클라 정적 파일은 Cloud로 옮기지 않는다 (Cloud는 게임 서버 전용) → IIS 또는 정적 호스팅에 그대로
- 이전 시점에 `https://docs.colyseus.io/cloud.md`, `deployment.md`를 다시 확인

## 8. IIS 로컬 구성 (준비할 것)
- IIS 기능: **WebSocket 프로토콜** 켜기, **URL Rewrite**, **Application Request Routing(ARR)** 설치 후 프록시 사용 켜기
- `deploy/iis/web.config`: `/colyseus/*` → `http://localhost:2567/*` 리라이트 (WebSocket 업그레이드 포함), 그 외는 정적 파일
- 개발 중에는 IIS 없이 `npm run dev`(Vite 5173 + 서버 2567)로 작업하고, IIS는 "배포 연습" 용도
- 다른 PC에서 접속 테스트 시 Windows 방화벽에서 80(IIS) 포트 허용

## 9. 확인 방법
- 1~2단계 후: `npm run dev -w client`로 기존 CPU 대전·핫시트·2:2가 그대로 되는지, `npm run typecheck`·`npm run lint` 통과
- shared: Vitest로 같은 시드·같은 입력이면 같은 착탄점·같은 구덩이가 나오는지 테스트
- 3~4단계 후: 루트 `npm run dev` → 브라우저 창 2개(일반+시크릿)로 같은 방 입장, 턴·바람·피해·지형이 두 화면에서 같은지, 한쪽 네트워크를 끊었다 붙였을 때 재접속되는지 확인. `@colyseus/testing`으로 턴 진행 자동 테스트
- 5단계 후: `npm run build` → IIS 주소로 접속, 같은 네트워크의 다른 기기에서 접속해 대전

## 10. 진행 상황

| 단계 | 상태 | 커밋 |
|---|---|---|
| 1. 모노레포 전환 | 완료 | `b72ecfb` |
| 2. shared 분리 | 완료 | `6d26198` |
| 3. 서버 뼈대 | 완료 | `783abb5` |
| 4. 온라인 대전 | 완료 | `7397b75`(서버) + 클라이언트 커밋 |
| 5. 로컬 운영 (IIS) | 다음 | |

### 실행 명령
- `npm run dev` — 서버(2567) + 클라이언트(5173) 함께 실행
- `npm run dev:client -- --port 5180` — 클라이언트만, 포트 지정
- `npm run build` → `npm run start:server` — 빌드 결과(`apps/server/build/index.js`)로 서버 실행
- `npm test` — shared(재현성) + server(대기실) 테스트
- 개발 중 서버 도구: `http://localhost:2567/playground`, `/monitor` (운영 모드에서는 꺼짐), 상태 확인 `/health`

### 3단계에서 확인한 사실 (Cloud 이전 시 참고)
- `@colyseus/tools`의 `listen()`은 **옵션 객체**를 넘길 때만 Cloud용 Redis(presence/driver)를 자동으로 붙인다. 우리는 `defineServer()` 결과를 넘기므로 `apps/server/src/scaling.ts`에서 같은 조건(`COLYSEUS_CLOUD` + CPU 여러 개, 또는 `REDIS_URI`)으로 직접 붙인다. Colyseus 버전을 올릴 때 tools의 `getColyseusCloudConfig`와 조건이 같은지 다시 확인할 것.
- Cloud에서는 포트를 `2567 + 프로세스 번호`, 유닉스 소켓으로 듣는다 (tools가 처리).
- 서버는 `@fortress/shared`를 패키지 의존성으로 갖지 않는다. `tsconfig.json`의 `paths`와 tsup `alias`로 소스를 직접 읽어 `build/index.js`에 묶는다 → 서버 폴더의 `npm install`이 레지스트리에 없는 `@fortress/shared`를 찾다가 실패하는 일이 없다. (단, 빌드할 때 저장소의 `packages/shared` 폴더는 있어야 함)
- 방 목록은 `LobbyRoom`(`lobby`) + `defineRoom(FortressRoom).enableRealtimeListing()`으로 실시간 제공.
- 메시지 payload는 zod로 검증하고, 형식이 틀리면 서버가 연결을 끊는다(4002). 클라이언트 SDK에서도 `Client<typeof server>` 덕분에 잘못된 payload가 컴파일 오류로 잡힌다.

### 4단계 구현 요약 (온라인 대전)
- **판정 흐름**: 클라이언트는 `move`(키 누름 방향)·`aim`(각도)·`fire`(무기·파워·각도·방향)만 보낸다. 서버가 `fireVolley`로 끝까지 계산하고 `shot` 메시지(포구 위치·착탄 스텝·구덩이·피해)를 모두에게 보낸다. 클라이언트는 서버 포구 위치에서 포탄을 날리고, 서버가 정한 스텝에 서버가 정한 자리에서 터뜨린다 → 화면마다 지형·체력이 같다 (두 브라우저로 지형 체크섬 일치 확인).
- **이동**: 내 차례에는 화면이 먼저 움직이고(같은 shared 코드), 키를 떼면 서버 위치로 부드럽게 맞춘다. 상대 차례에는 서버 위치를 따라간다.
- **턴 동기화**: 클라이언트는 `turnCount`가 바뀌면 새 턴을 열고 탱크 상태를 서버 값으로 맞춘다. 연출 중에 신호가 오면 연출이 끝난 뒤 반영한다. 놓친 발사가 있으면 `terrainLog` 요청으로 지형을 따라잡는다.
- **새로고침·끊김**: 방 재접속 토큰을 sessionStorage에 두고, 타이틀이 자동으로 로비 → 방 → 게임으로 되돌린다 (30초 안). 지형은 `terrainLog`로 복원 (확인함).
- **기권·종료**: 게임 중 나가면 그 탱크는 격파 처리, 한 팀만 남으면 종료. 결과 화면의 `대기실로`(방장이 방을 대기실로 되돌림) / `나가기`.
- **화면**: 타이틀 `온라인 대전` → 로비(닉네임·방 목록 실시간·1:1/2:2 만들기) → 대기실(팀 바꾸기·준비·시작). 로비·대기실은 입력창 때문에 HTML로 그린다 (`apps/client/src/net/lobbyView.ts`).
- **서버 주소**: `apps/client/.env.development`(`http://localhost:2567`), `.env.production`(비우면 같은 호스트 2567 포트). IIS·Cloud 단계에서 이 값만 바꾼다.

### 남은 일 / 알려진 한계
- 빈 자리를 CPU로 채우기 (지금은 양 팀 인원이 다 차야 시작)
- 상대의 파워 충전·무기 선택은 상대 화면에 보이지 않음 (발사 순간에만 반영)
- 서버 시간과 클라이언트 연출 시간이 조금 어긋날 수 있음 → 턴 시작마다 서버 값으로 맞추는 방식으로 흡수
