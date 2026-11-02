// 게임 전역 상수.
// 화면(GAME)은 1280×768, 월드(WORLD)는 땅 레이어 크기인 2560×768이다.
const CONFIG = {
  GAME_W: 1280,
  GAME_H: 768,
  WORLD_W: 2560,
  WORLD_H: 768,
  FONT: '"Malgun Gothic", "Apple SD Gothic Neo", sans-serif',

  STAGE: {
    BG: 'images/background/stage1_bg.png',         // 화면에 고정
    GROUND: 'images/background/stage1_ground.png', // 월드 폭에 맞춰 확대, 하단 정렬
  },

  TERRAIN: {
    ALPHA_SOLID: 128,  // 이 알파 이상이면 땅
    SPECK_MIN: 200,    // 로드 시 이보다 작은 떠 있는 덩어리는 잡티로 지운다
    FRINGE: 2,         // 땅에서 이 거리 안의 반투명 픽셀만 외곽선으로 남긴다
    ANCHOR_RADIUS: 20, // 처음부터 떠 있는 섬의 자동 고정점 반지름
    DEBRIS_MIN: 30,    // 이보다 작은 조각은 떨어뜨리지 않고 부순다
    CRUSH_MAX: 30,     // 떨어지는 땅에 깔렸을 때 최대 피해
    CRUSH_FACTOR: 0.06, // 낙하 속도(px/s)당 깔림 피해
  },

  PHYSICS: {
    GRAVITY: 420,        // px/s²
    POWER_TO_SPEED: 10.5, // 파워 100 = 1050 px/s (최대 사거리 약 2600px)
    WIND_ACCEL: 5,       // 바람 1당 px/s²
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
    MAX_CLIMB: 2,      // 1px 전진당 오를 수 있는 높이
    CLEARANCE: 40,     // 지나가려면 앞쪽에 비어 있어야 하는 높이 (낮은 천장 판정)
    SAFE_FALL: 40,     // 이 높이까지는 낙하 피해 없음
    FALL_DAMAGE: 0.4,  // 초과 1px당 피해
    HIT_RX: 42,
    HIT_RY: 28,
    HIT_CENTER_Y: 26,
    BODY_RADIUS: 22,   // 폭발 거리 계산 시 빼는 몸체 반경
    MARKER_Y: 92,      // 턴 표시 화살표 높이
  },

  TURN_SECONDS: 30,
  CHARGE_SPEED: 65,    // 파워/초

  WEAPONS: [
    { key: 'normal', name: '일반탄', damage: 35, radius: 45, stock: Infinity, shells: 1 },
    { key: 'heavy',  name: '강력탄', damage: 55, radius: 75, stock: 2, shells: 1 },
    { key: 'triple', name: '3연발',  damage: 18, radius: 30, stock: 2, shells: 3 },
  ],
  TRIPLE_SPREAD: 3,    // 도

  // 양 끝 울타리(땅 레이어에 포함되어 단단함) 바로 안쪽에서 생성한다.
  PLAYERS: [
    { name: '파랑', color: 0x3b82f6, sprite: 'blue', spawnX: 290, facing: 1 },
    { name: '빨강', color: 0xef4444, sprite: 'red', spawnX: 2270, facing: -1 },
  ],

  DEPTH: { BACK: 0, TERRAIN: 5, TANK: 10, WORLD_UI: 15, SHELL: 20, FX: 30, HUD: 100, OVERLAY: 200 },
};
