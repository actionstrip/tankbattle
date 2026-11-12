# 상용 서비스 운영 방안: 스택 · 서버 구성 · 배포 · 유지보수

회사 상용 서비스로 출시할 때 **어떻게 구성하고, 배포하고, 운영할지** 정리한다.
- 부서별로 무엇을 요청할지는 [service-deployment.md](service-deployment.md)에 있다. 이 문서는 기술 관점이다.
- 지금(사내 테스트) 운영 방법은 [daily-operation.md](daily-operation.md).

---

## 1. 현재 스택

| 영역 | 기술 | 위치 |
|---|---|---|
| 클라이언트 | Phaser 4.1 + TypeScript + Vite 8, Howler(사운드) | `apps/fortress` |
| 게임 서버 | Node.js 22 + Colyseus 0.18, 메시지 검증 zod | `apps/server` |
| 공용 코드 | `packages/common`, `packages/fortress-shared`, `packages/web` | 서버 빌드(tsup)에 함께 묶임 |
| 여러 대 확장 | Redis presence/driver (`REDIS_URI`를 지정할 때만) | `apps/server/src/scaling.ts` |
| 프로세스 관리 | PM2 (이름 `game-server`) | `apps/server/ecosystem.config.cjs` |
| 데이터 저장 | 없음. 방·게임·채팅 모두 서버 메모리 | 1차 출시에는 DB가 필요 없다 |

---

## 2. 운영 서버 구성

### 2-1. 구성도 (1차 출시: 게임 서버 1대)
```
브라우저 ─ https://game.도메인    → CDN/웹서버 : 정적 파일 (apps/fortress/dist)
        └ wss://game-ws.도메인   → LB/nginx   : TLS 종료, WebSocket 전달, idle 3600초
                                     └ 내부 :2567 → 게임 서버 컨테이너 (Node 22)
                                                     └ (확장 시) Redis
```

### 2-2. 실행 형태
- **권장: Docker 이미지.** 인프라팀은 Node를 몰라도 이미지만 실행하면 된다.
  - 멀티스테이지 빌드: `npm ci` → `npm run build -w @games/server` → `node:22-slim`에 `apps/server/build/`와 운영 의존성만 남긴다.
  - 컨테이너 재시작 정책(`restart: always` 또는 K8s Deployment)으로 자동 재시작.
- **대안: VM + PM2.** 컨테이너 플랫폼이 없으면 기존 `ecosystem.config.cjs`를 그대로 쓴다(`npm run server:start`).
- 사양 시작점: **2 vCPU / 4GB**. 부하 테스트(5장) 결과로 확정한다.

### 2-3. 환경 분리
| 환경 | 용도 | 주소 예 |
|---|---|---|
| dev | 개발자 PC | `localhost:5173` + `localhost:2567` |
| staging | 사내 검증, 부하 테스트 | `game-stg.사내도메인` (https/wss) |
| prod | 실서비스 | `game.도메인`, `game-ws.도메인` |

환경마다 다른 값은 모두 환경변수로 둔다.

| 이름 | 쓰는 곳 | 설명 |
|---|---|---|
| `VITE_SERVER_URL` | 클라이언트 빌드 | 게임 서버 주소 (`apps/fortress/.env.production`) |
| `NODE_ENV` | 서버 | `production`이면 `/playground`, `/monitor`가 꺼진다 |
| `PORT` | 서버 | 기본 2567 |
| `REDIS_URI` | 서버 | 여러 대로 늘릴 때만 |
| `CORS_ORIGINS` | 서버 | 허용할 서비스 도메인 (3장에서 추가 예정) |

### 2-4. 인프라 선택지
| 환경 | 정적 파일 | 게임 서버 | LB |
|---|---|---|---|
| 사내 IDC | 기존 웹서버(IIS/nginx) | VM 또는 사내 K8s | nginx (`proxy_read_timeout 3600s`, Upgrade 헤더 전달) |
| AWS | S3 + CloudFront | ECS 또는 EC2 | ALB (idle timeout 3600초) |
| NCP 등 국내 클라우드 | Object Storage + CDN | 서버/컨테이너 | 동급 LB, WebSocket·타임아웃 지원 확인 |

어떤 환경이든 **WebSocket 허용과 긴 idle 타임아웃**이 가장 중요하다. 기본 60초면 상대 차례를 기다리다 연결이 끊긴다.

---

## 3. 출시 전 코드 보강 (프론트팀)

- [ ] **Dockerfile, .dockerignore** 추가.
- [ ] **CORS 출처 제한**: 지금은 모든 출처를 허용한다. `app.config.ts`에서 `CORS_ORIGINS` 목록만 허용하도록 바꾼다.
- [ ] **Graceful shutdown**: 종료 신호(SIGTERM)를 받으면 새 방 생성을 막고, 진행 중인 게임이 끝나길 최대 N분 기다린 뒤 내려간다. 배포 때 게임이 끊기는 것을 줄인다.
- [ ] **버전 확인**: 클라이언트가 빌드 버전을 방 입장 옵션으로 보낸다. 서버 버전과 다르면 "새로고침해 주세요"를 띄운다. 메시지·Schema를 바꾼 뒤 예전 클라이언트가 오류 나는 것을 막는다.
- [ ] **로그 형식 통일**: stdout에 JSON 한 줄씩(시간, 방 ID, 이벤트, 오류).
- [ ] **지표 주소**: `/health` 외에 `/metrics`(동시 접속 수, 방 수). 내부망에서만 열리게 한다.
- [ ] **에러 수집**: 클라이언트와 서버에 Sentry(또는 사내 동급 도구) 연동.
- [ ] **채팅**: 금칙어 필터, 신고 기능. 보안팀 검토 결과에 따라 범위를 정한다.

---

## 4. 배포

### 4-1. 브랜치와 CI
- `main` = 운영 기준. 기능 브랜치 → PR → 리뷰 → 병합.
- **PR마다 자동 검사**: `npm ci` → `npm run lint` → `npm run typecheck` → `npm test` → `npm run build`.

### 4-2. CD (버전 태그 `vX.Y.Z`를 붙이면)
1. **서버**: Docker 이미지 빌드 → 사내 레지스트리에 버전 태그로 올림 → staging 자동 배포.
2. **클라이언트**: `npm run build -w @fortress/client` → `dist` 업로드.
   - `assets/*`를 먼저 올리고 `index.html`은 마지막에 바꾼다. 파일 이름에 해시가 붙어 있어 예전 파일과 함께 있어도 된다.
   - CDN 캐시 무효화는 `index.html`만 한다.
3. staging에서 확인한 뒤 **prod는 수동 승인**으로 배포한다.

### 4-3. 무엇을 바꿨느냐에 따라
| 바꾼 것 | 배포 방법 | 사용자 영향 |
|---|---|---|
| 클라이언트만 (화면, 사운드 등) | 정적 파일만 교체 | 없음. 새로고침하면 새 버전 |
| 서버 로직 (메시지 형식 그대로) | 새 서버를 띄우고 예전 서버는 진행 중 게임이 끝나면 내림 (graceful shutdown) | 거의 없음 |
| 메시지·Schema 변경 | 점검 시간에 서버와 클라이언트를 함께 배포 | 점검 공지 필요 |

### 4-4. 롤백
- 서버: 이전 이미지 태그로 다시 실행한다.
- 클라이언트: 이전 `dist`를 다시 올린다.
- 버전별 산출물은 **최소 5개** 보관한다.

---

## 5. 유지보수

### 5-1. 모니터링과 알림
| 볼 것 | 알림 조건 |
|---|---|
| 프로세스/컨테이너 상태, `/health` | 헬스체크 실패, 재시작 반복 |
| CPU·메모리 | 메모리 80% 이상 지속 |
| 동시 접속 수, 방 수 | 용량 기준(5-3)의 70% 도달 |
| 오류 (Sentry) | 오류 급증 |

- 대시보드는 사내 표준(Grafana 등)을 쓴다.
- 알림은 메신저와 당번에게 보낸다.

### 5-2. 로그
- 서버는 stdout으로만 남긴다. 사내 로그 수집(ELK, Loki 등)이 모은다.
- 보관 기간은 보안 정책을 따른다. 채팅 내용을 남길지 먼저 정한다.

### 5-3. 용량 관리
- staging에서 **봇 클라이언트로 부하 테스트**를 한다(`@colyseus/sdk`로 방 N개를 만들어 자동 플레이).
- 결과로 "서버 1대 = 동시 방 X개, 접속자 Y명" 기준을 정한다.
- 70%에 닿으면 증설한다: 서버 여러 대 + Redis(`REDIS_URI`) + sticky session 또는 서버별 공개 주소.

### 5-4. 장애 대응 (런북)
- [ ] 시작·중지·로그 보기·롤백 명령 정리.
- [ ] 장애 등급과 대응 시간. 야간·주말 당번(게임 서버 담당이 프론트팀이므로 필요).
- [ ] 연락망: 프론트(게임 로직), 인프라(서버·네트워크), 보안.
- [ ] 장애가 끝나면 원인과 재발 방지책을 짧게 기록.

### 5-5. 정기 작업
| 주기 | 할 일 |
|---|---|
| 매월 | `npm audit`, Colyseus·Phaser 등 업데이트 확인 → staging에서 먼저 검증 |
| 분기 | 부하 테스트 다시 해서 용량 기준 갱신, 런북 점검 |
| 연 1회 | Node.js LTS 교체 계획 (22 지원 종료 전 24로) |
| 상시 | TLS 인증서 만료 알림 |

---

## 6. 이후 기능 확장 시
- **로그인**: 백엔드 토큰 검증 API를 게임 서버가 호출한다(Colyseus `onAuth`).
- **전적·랭킹**: 게임이 끝나면 게임 서버가 백엔드 API에 결과를 저장한다. DB는 백엔드팀 소관.
- **서버 여러 대**: Redis 도입. 자세한 조건은 `apps/server/src/scaling.ts` 주석 참고.

---

## 7. 진행 순서
1. **코드 보강**: 3장 항목과 Dockerfile.
2. **staging 구축**: https/wss, 타임아웃 설정 확인, 부하 테스트.
3. **보안 점검**: [service-deployment.md](service-deployment.md) 5장.
4. **오픈**: 서버 1대 + 모니터링·알림 + 런북.
5. **확장**: 사용자 수에 따라 서버 증설, 로그인·전적 연동.
