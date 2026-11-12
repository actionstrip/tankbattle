// @games/common — 모든 게임이 함께 쓰는 네트워크 약속 (서버·클라이언트 공용, DOM·게임 엔진 사용 금지).
// 게임마다 다른 것(방 이름, 규칙, 상태)은 각 게임의 shared 패키지에 둔다.

/** 모든 게임 공통 제한값 */
export const COMMON = {
  NAME_MAX: 12,          // 닉네임 최대 글자 수
  TITLE_MAX: 24,         // 방 제목 최대 글자 수
  RECONNECT_SECONDS: 30, // 접속이 끊긴 사람을 기다리는 시간
} as const;

/** 채팅 제한값 */
export const CHAT = {
  MAX: 80,           // 한 줄 최대 글자 수
  HISTORY: 30,       // 방에 보관하는 최근 채팅 수 (늦게 들어온·재접속한 사람에게 보여 줌)
  INTERVAL_MS: 700,  // 같은 사람이 이보다 빨리 보내면 무시 (도배 방지)
} as const;

/** 채팅 한 줄 (서버 → 모두) */
export interface ChatMessage {
  name: string;
  /** 이름 색 (팀 색, 자기 색 등 게임이 정함) */
  color: number;
  text: string;
}

/** 닉네임·제목·채팅 정리: 앞뒤 공백 제거, 제어 문자 제거, 길이 제한. 비면 fallback */
export function cleanText(value: unknown, max: number, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  // eslint-disable-next-line no-control-regex
  const s = value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
  return s || fallback;
}
