// 게임 전역 상수.
// 화면(GAME)은 1280×768, 월드(WORLD)는 땅 레이어 크기인 2560×768이다.
const CONFIG = {
  GAME_W: 1280,
  GAME_H: 768,
  WORLD_W: 2560,
  WORLD_H: 768,
  FONT: '"Malgun Gothic", "Apple SD Gothic Neo", sans-serif',

  STAGE: {
    BG: 'images/background/stage1_bg.jpg',         // 땅보다 느리게 스크롤 (시차)
    GROUND: 'images/background/stage1_ground.png', // 월드 폭에 맞춰 확대, 하단 정렬
  },

  TERRAIN: {
    ALPHA_SOLID: 128,  // 이 알파 이상이면 땅
    SPECK_MIN: 200,    // 로드 시 이보다 작은 떠 있는 덩어리는 잡티로 지운다
    FRINGE: 2,         // 땅에서 이 거리 안의 반투명 픽셀만 외곽선으로 남긴다
    ANCHOR_RADIUS: 20, // 처음부터 떠 있는 섬의 자동 고정점 반지름
  },

  PHYSICS: {
    GRAVITY: 420,        // px/s²
    POWER_TO_SPEED: 10.5, // 파워 100 = 1050 px/s (최대 사거리 약 2600px)
    IMPACT_SPEED_MIN: 300,  // 착탄 속도가 이 이하면 폭발 강도 최소
    IMPACT_SPEED_MAX: 1200, // 이 이상이면 최대 (파워 100 발사 1050px/s + 낙하 가속)
    IMPACT_SCALE_MIN: 0.7,  // 구덩이 반경·데미지 배율
    IMPACT_SCALE_MAX: 1.3,
    // 바람 1당 px/s². 최대 역풍에서 60° 풀파워로 쏘면 제자리로 돌아오도록 맞춘 값:
    // 평지 기준 착지 x = 0 이 되는 조건은 a = g / tan(60°) = 420 / 1.732 ≈ 242.5 → 바람 10으로 나눔.
    WIND_ACCEL: 24.25,
    WIND_MAX: 10,
    STEP: 1 / 240,       // 탄 적분 간격 (최고 속도에서 스텝당 5px 이하)
    MAX_FLIGHT: 12,      // 초
  },

  TANK: {
    SCALE: 0.45,       // 잘라 둔 텍스처(시트의 1/4) 기준 표시 배율
    MAX_HP: 100,
    MOVE_SPEED: 70,    // px/s
    FUEL: 150,         // 턴당 이동 가능한 px
    AIM_SPEED: 35,     // 도/초
    ELEV_MIN: 0,
    ELEV_MAX: 85,
    FEET: 13,          // 중심에서 좌우 접지점까지의 거리
    MAX_CLIMB: 3,      // 1px 전진당 오를 수 있는 높이 (약 71°)
    CLEARANCE: 40,     // 지나가려면 앞쪽에 비어 있어야 하는 높이 (낮은 천장 판정)
    SAFE_FALL: 40,     // 이 높이까지는 낙하 피해 없음
    FALL_DAMAGE: 0.4,  // 초과 1px당 피해
    HIT_RX: 42,
    HIT_RY: 28,
    HIT_CENTER_Y: 26,
    BODY_RADIUS: 22,   // 폭발 거리 계산 시 빼는 몸체 반경
    MARKER_GAP: 10,      // 포신을 90°로 세웠을 때 총구 끝과 화살표 사이 간격 (px)
    MARKER_BOB: 6,       // 화살표가 위아래로 움직이는 폭 (px)
    MARKER_SCALE: 0.45,  // arrow.png 한 칸(약 58×57) 표시 배율
    MARKER_FRAME_MS: 110, // 회전 프레임 간격
  },

  TURN_SECONDS: 30,
  CHARGE_SPEED: 65,    // 파워/초

  WEAPONS: [
    { key: 'normal', name: '일반탄', damage: 35, radius: 45, stock: Infinity, shells: 1 },
    // scale = 포탄 크기 배율, glow = 포탄 주위에 도는 빛 색
    { key: 'heavy',  name: '강력탄', damage: 55, radius: 75, stock: 2, shells: 1, scale: 1.5, glow: 0x15803d },
    { key: 'triple', name: '3연발',  damage: 18, radius: 30, stock: 2, shells: 3 },
  ],
  TRIPLE_SPREAD: 3,    // 도

  // 양 끝 울타리(땅 레이어에 포함되어 단단함) 바로 안쪽에서 생성한다.
  PLAYERS: [
    { name: '블루', team: 'blue', color: 0x3b82f6, sprite: 'blue', spawnX: 290, facing: 1 },
    { name: '레드', team: 'red', color: 0xef4444, sprite: 'red', spawnX: 2270, facing: -1 },
  ],
  // 2:2 팀전. 배열 순서가 턴 순서다 (팀 번갈아). 2대는 서로 다른 발판에 둔다.
  TEAM_PLAYERS: [
    { name: '블루1', team: 'blue', color: 0x3b82f6, sprite: 'blue', spawnX: 290, facing: 1 },
    { name: '레드1', team: 'red', color: 0xef4444, sprite: 'red', spawnX: 2270, facing: -1 },
    { name: '블루2', team: 'blue', color: 0x3b82f6, sprite: 'blue', spawnX: 770, facing: 1 },
    { name: '레드2', team: 'red', color: 0xef4444, sprite: 'red', spawnX: 1720, facing: -1 },
  ],
  // 게임 모드: team = 2:2 팀전 여부, redAi = 레드팀을 CPU가 조종
  MODES: {
    cpu:    { team: false, redAi: true },
    '2p':   { team: false, redAi: false },
    '2v2':  { team: true,  redAi: true },
    '2v2hot': { team: true, redAi: false },
  },
  // 시작 위치는 발판마다 한 대씩 무작위 (위 spawnX는 발판을 못 찾을 때만 쓰임)
  SPAWN: {
    MIN_PLATFORM: 120, // 이보다 좁은 발판에는 놓지 않는다 (px)
    EDGE: 45,          // 발판 끝에서 이만큼 안쪽에 놓는다
    MIN_GAP: 110,      // 같은 발판에 둘 이상 놓아야 할 때 최소 간격
  },
  TEAMS: { blue: '블루팀', red: '레드팀' },

  SNOW: {
    COUNT: 160,          // 화면에 떠 있는 눈송이 수
    SIZE: [1.5, 4],      // 반지름 (먼 것 ~ 가까운 것)
    FALL: [35, 95],      // 낙하 속도 px/s (먼 것 ~ 가까운 것)
    WIND_SPEED: 16,      // 바람 1당 옆으로 날리는 속도 px/s (가까운 눈 기준)
    WIND_EASE: 0.8,      // 바람이 바뀔 때 따라가는 시간 상수 (초)
    SWAY: 14,            // 좌우 하늘거림 폭 px/s
  },

  DEPTH: { BACK: 0, TERRAIN: 5, TANK: 10, WORLD_UI: 15, SHELL: 20, FX: 30, SNOW: 40, HUD: 100, OVERLAY: 200 },
};
