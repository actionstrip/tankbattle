// 게임 전역 상수.
// 게임 규칙(판정에 쓰이는 값)은 @fortress/shared 의 RULES에 있고, 여기서는 화면·연출 값을 더한다.
// 화면(GAME)은 1280×768, 월드(WORLD)는 땅 레이어 크기인 2560×768이다.
import { RULES } from '@fortress/shared';

export type { GameMode, ModeDef, Player, PlayerDef, Team, Weapon, WeaponKey } from '@fortress/shared';

export const CONFIG = {
  ...RULES,

  GAME_W: 1280,
  GAME_H: 768,
  FONT: '"Malgun Gothic", "Apple SD Gothic Neo", sans-serif',

  STAGE: {
    BG: 'images/background/stage1_bg.jpg',         // 땅보다 느리게 스크롤 (시차)
    GROUND: 'images/background/stage1_ground.png', // 월드 폭에 맞춰 확대, 하단 정렬 (충돌 마스크는 npm run build:mask)
  },

  TANK: {
    ...RULES.TANK,
    // 발사 반동 연출 (무기의 recoil 배율이 곱해짐)
    RECOIL: {
      PUSH: 12,        // 쏜 반대쪽으로 밀리는 거리 (px)
      TILT: 0.18,      // 앞쪽이 들리는 각도 (rad, 약 10°)
      BARREL: 14,      // 포신이 뒤로 들어가는 거리 (px)
      PULSE: 0.22,     // 크기 출렁임 (0.22 = 22% 커짐)
      KICK_MS: 450,    // 밀림·들림이 돌아오는 시간
      PULSE_MS: 700,   // 크기 출렁임이 잦아드는 시간
    },
    MARKER_GAP: 10,      // 포신을 90°로 세웠을 때 총구 끝과 화살표 사이 간격 (px)
    MARKER_BOB: 6,       // 화살표가 위아래로 움직이는 폭 (px)
    MARKER_SCALE: 0.45,  // arrow.png 한 칸(약 58×57) 표시 배율
    MARKER_FRAME_MS: 110, // 회전 프레임 간격
  },

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
