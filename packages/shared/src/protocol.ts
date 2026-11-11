// 클라이언트·서버가 함께 쓰는 네트워크 약속 (방 이름·제한값·메타데이터 모양).
// 메시지 payload 타입은 서버의 messages 정의에서 Client<typeof server>로 자동으로 맞춰진다.
import type { Team } from './config';

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

/** 닉네임·제목 정리: 앞뒤 공백 제거, 제어 문자 제거, 길이 제한. 비면 fallback */
export function cleanText(value: unknown, max: number, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  // eslint-disable-next-line no-control-regex
  const s = value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
  return s || fallback;
}
