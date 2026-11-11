// 클라이언트·서버가 함께 쓰는 네트워크 약속 (방 이름·제한값·메타데이터 모양).
// 메시지 payload 타입은 서버의 messages 정의에서 Client<typeof server>로 자동으로 맞춰진다.
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

export const NET = {
  NAME_MAX: 12,          // 닉네임 최대 글자 수
  TITLE_MAX: 24,         // 방 제목 최대 글자 수
  RECONNECT_SECONDS: 30, // 접속이 끊긴 사람을 기다리는 시간
} as const;

export type RoomPhase = 'lobby' | 'playing' | 'ended';

/** 방 목록에 보이는 정보 (Room.metadata) */
export interface FortressRoomMetadata {
  title: string;
  teamSize: TeamSize;
  phase: RoomPhase;
}

/** joinOrCreate / create / join 옵션 */
export interface FortressJoinOptions {
  name?: string;
  /** 방을 만들 때만 */
  title?: string;
  teamSize?: TeamSize;
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

/** 닉네임·제목 정리: 앞뒤 공백 제거, 제어 문자 제거, 길이 제한. 비면 fallback */
export function cleanText(value: unknown, max: number, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  // eslint-disable-next-line no-control-regex
  const s = value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
  return s || fallback;
}
