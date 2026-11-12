// 클라이언트·서버가 함께 쓰는 네트워크 약속 (방 이름·제한값·메타데이터 모양).
// 메시지 payload 타입은 서버의 messages 정의에서 Client<typeof server>로 자동으로 맞춰진다.
import { COMMON } from '@games/common';
import type { Team } from './config';
import type { VolleyResult } from './shot';
import type { CarveResult, EraseOps } from './terrainMask';

/** 매치메이커에 등록하는 방 이름 */
export const ROOMS = {
  /** 방 목록을 실시간으로 받는 로비 */
  LOBBY: 'lobby',
  /** 대전 방 */
  FORTRESS: 'fortress',
} as const;

export type TeamSize = 1 | 2;

/** 이름·제목 길이, 재접속 대기는 모든 게임 공통값(@games/common)을 그대로 쓴다 */
export const NET = {
  ...COMMON,
  FFA_MAX: 8,            // 개인전 최대 인원 (색 수)
} as const;

export { CHAT, cleanText } from '@games/common';
export type { ChatMessage } from '@games/common';

export type RoomPhase = 'lobby' | 'playing' | 'ended';

/** 방 목록에 보이는 정보 (Room.metadata) */
export interface FortressRoomMetadata {
  title: string;
  teamSize: TeamSize;
  /** 개인전 (모두가 서로 적, 2명 이상이면 언제든 시작) */
  ffa: boolean;
  phase: RoomPhase;
}

/** joinOrCreate / create / join 옵션 */
export interface FortressJoinOptions {
  name?: string;
  /** 방을 만들 때만 */
  title?: string;
  teamSize?: TeamSize;
  ffa?: boolean;
}

export const TEAMS: readonly Team[] = ['blue', 'red'];

/** 서버 판정 시간 */
export const TIMING = {
  /** 시작 연출: 처음 대기 + 탱크당 비추는 시간 (클라이언트 playIntroSweep과 맞춤) */
  INTRO_BASE_MS: 1200,
  INTRO_PER_TANK_MS: 1500,
  /** 남은 시간이 0이 된 뒤에도 발사를 받아 주는 여유 (네트워크 지연) */
  FIRE_GRACE_S: 1.5,
  /** 포탄이 다 끝난 뒤 다음 턴까지 쉬는 시간 (클라이언트 resolveWait 0.7초 + 여유) */
  AFTER_SHOT_MS: 1400,
  /** 시간 초과·접속 끊김으로 쏘지 않고 넘길 때 */
  SKIP_MS: 900,
  /** 차례인 사람의 접속이 끊겨 있으면 이만큼 기다렸다가 넘긴다 */
  DISCONNECTED_TURN_S: 3,
} as const;

/** 지형 변경 기록 (재접속·중간 입장 시 처음부터 다시 적용) */
export type TerrainOp =
  | { kind: 'carve'; carve: CarveResult }
  | { kind: 'erase'; ops: EraseOps };

/** 서버 → 모두: 발사 판정 결과 */
export interface ShotMessage extends VolleyResult {
  /** 쏜 탱크 번호 */
  shooter: number;
  turnCount: number;
}

/** 무기 탄 수를 상태로 보낼 때 (무제한 = -1) */
export const encodeStock = (n: number): number => (Number.isFinite(n) ? n : -1);
export const decodeStock = (n: number): number => (n < 0 ? Infinity : n);
