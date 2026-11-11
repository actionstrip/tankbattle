// 게임 규칙 상수 (클라이언트·서버 공용).
// 화면·연출 전용 값은 클라이언트 config.ts에 있다. 월드(WORLD)는 땅 레이어 크기인 2560×768이다.

export type WeaponKey = 'normal' | 'heavy' | 'triple';

export interface Weapon {
  key: WeaponKey;
  name: string;
  damage: number;
  radius: number;
  stock: number;
  shells: number;
  /** 포탄 크기 배율 */
  scale?: number;
  /** 포탄 주위에 도는 빛 색 */
  glow?: number;
  /** 발사 반동 배율 */
  recoil?: number;
}

export type Team = 'blue' | 'red';

export interface PlayerDef {
  name: string;
  team: Team;
  color: number;
  sprite: string;
  spawnX: number;
  facing: number; // -1 | 1
}

export interface Player extends PlayerDef {
  ai: boolean;
}

export type GameMode = 'cpu' | '2p' | '2v2' | '2v2hot';

export interface ModeDef {
  /** 2:2 팀전 여부 */
  team: boolean;
  /** 레드팀을 CPU가 조종 */
  redAi: boolean;
}

const WEAPONS: Weapon[] = [
  { key: 'normal', name: '일반탄', damage: 35, radius: 45, stock: Infinity, shells: 1 },
  { key: 'heavy', name: '강력탄', damage: 55, radius: 75, stock: 2, shells: 1, scale: 1.5, glow: 0x15803d, recoil: 1.6 },
  { key: 'triple', name: '3연발', damage: 18, radius: 30, stock: 2, shells: 3 },
];

// 양 끝 울타리(땅 레이어에 포함되어 단단함) 바로 안쪽에서 생성한다.
const PLAYERS: PlayerDef[] = [
  { name: '블루', team: 'blue', color: 0x3b82f6, sprite: 'blue', spawnX: 290, facing: 1 },
  { name: '레드', team: 'red', color: 0xef4444, sprite: 'red', spawnX: 2270, facing: -1 },
];

// 2:2 팀전. 배열 순서가 턴 순서다 (팀 번갈아). 2대는 서로 다른 발판에 둔다.
const TEAM_PLAYERS: PlayerDef[] = [
  { name: '블루1', team: 'blue', color: 0x3b82f6, sprite: 'blue', spawnX: 290, facing: 1 },
  { name: '레드1', team: 'red', color: 0xef4444, sprite: 'red', spawnX: 2270, facing: -1 },
  { name: '블루2', team: 'blue', color: 0x3b82f6, sprite: 'blue', spawnX: 770, facing: 1 },
  { name: '레드2', team: 'red', color: 0xef4444, sprite: 'red', spawnX: 1720, facing: -1 },
];

// 게임 모드: team = 2:2 팀전 여부, redAi = 레드팀을 CPU가 조종
const MODES: Record<GameMode, ModeDef> = {
  cpu: { team: false, redAi: true },
  '2p': { team: false, redAi: false },
  '2v2': { team: true, redAi: true },
  '2v2hot': { team: true, redAi: false },
};

export const RULES = {
  WORLD_W: 2560,
  WORLD_H: 768,

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
    // 탱크 직격 시 탱크 바닥 모양대로 땅이 눌려 파이는 정도
    BLAST_DIG: {
      WIDTH: 0.85,     // 자국 폭 = 탱크 몸체 폭 × 이 값
      DEPTH: 0.2,      // 반대쪽 끝 깊이 = 폭발 반경 × 이 값 (일반탄 약 9px)
      NEAR: 0.35,      // 맞은 쪽 끝 깊이 = 반대쪽 깊이 × 이 값
      ROUND: 0.25,     // 양 끝이 둥글게 올라오는 구간 (반폭 대비)
      MAX_DROP: 20,    // 탱크보다 이만큼 이상 낮은 표면(낭떠러지 아래)은 건드리지 않음 (px)
    },
  },

  TURN_SECONDS: 30,
  CHARGE_SPEED: 65,    // 파워/초

  WEAPONS,
  TRIPLE_SPREAD: 3,    // 도

  PLAYERS,
  TEAM_PLAYERS,
  MODES,
  // 시작 위치는 발판마다 한 대씩 무작위 (위 spawnX는 발판을 못 찾을 때만 쓰임)
  SPAWN: {
    MIN_PLATFORM: 120, // 이보다 좁은 발판에는 놓지 않는다 (px)
    EDGE: 45,          // 발판 끝에서 이만큼 안쪽에 놓는다
    MIN_GAP: 110,      // 같은 발판에 둘 이상 놓아야 할 때 최소 간격
  },
  TEAMS: { blue: '블루팀', red: '레드팀' } as Record<Team, string>,
};

// 탱크 그림 기준 좌표. 포구 위치 계산(판정)에 쓰이므로 서버도 같은 값을 쓴다.
// 탱크는 몸체(<color>_body.png, 1536×1024)와 공용 포신(po.png, 2172×724) 두 장으로 그린다.
// 좌표는 모두 몸체 이미지 픽셀 기준이다. 포신의 크기·위치는 사용자가 맞춘 배치 시안과
// 픽셀 대조로 구했다 (시안에서 몸체 0.5배, 포신 0.304배 → 포신은 몸체 대비 0.608배).
export const TANK_SHEET = {
  SCALE: 0.16,                 // 몸체 이미지 → 텍스처 축소 배율 (화면 크기는 RULES.TANK.SCALE을 한 번 더 곱함)
  BODY_W: 1536,                // 몸체 이미지 폭
  ORIGIN: { x: 765, y: 955 },  // 궤도 바닥 중앙 (몸체 좌표)
  PO: {
    SCALE: 0.608,              // 포신 이미지 → 몸체 좌표 배율
    LENGTH: 2 / 3,             // 회전축~총구 길이 배율 (가운데 관을 잘라 내 줄임, 굵기·모양 유지)
    TUBE_CUT_START: 900,       // 잘라 낼 관 구간 시작 x (관은 약 x 565~1550)
    PIVOT: { x: 1864, y: 364 },  // 포신 이미지 안 회전축 (오른쪽 둥근 고리 중심)
    MUZZLE: { x: 168, y: 362 },  // 포신 이미지 안 총구 끝 중심
  },
  // 포신 회전축이 놓이는 몸체 좌표 (포탑 앞쪽)
  PIVOT: { x: 862, y: 306 },
  COLORS: ['blue', 'red'],
};

/** 몸체 좌표 기준 회전축~총구 거리 */
export const BARREL_LENGTH = (TANK_SHEET.PO.PIVOT.x - TANK_SHEET.PO.MUZZLE.x) * TANK_SHEET.PO.SCALE * TANK_SHEET.PO.LENGTH;

/** 축소 텍스처 기준 몸체 폭 (px, 표시 배율 적용 전) */
export const BODY_TEXTURE_W = Math.ceil(TANK_SHEET.BODY_W * TANK_SHEET.SCALE);
