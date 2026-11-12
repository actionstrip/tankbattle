// 서버 주소와 브라우저 저장소 (닉네임, 새로고침 후 재접속 정보).
// 저장소가 막혀 있어도(사생활 보호 모드 등) 게임은 그대로 진행되도록 모두 try/catch.
import { COMMON } from '@games/common';

/**
 * 게임 서버 주소. 빌드 설정(VITE_SERVER_URL)을 그대로 넘긴다.
 * 개발: http://localhost:2567, 운영(IIS): https://도메인/colyseus, Cloud: Cloud 주소.
 * 지정이 없으면 같은 호스트의 2567 포트.
 */
export function serverUrl(configured?: string): string {
  if (configured) return configured;
  return `${location.protocol}//${location.hostname}:2567`;
}

function local(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}

function session(): Storage | null {
  try { return window.sessionStorage; } catch { return null; }
}

/** 게임별 저장 공간. 키 앞에 게임 이름을 붙인다 (예: fortress.name, fortress.reconnect) */
export class GameStorage {
  constructor(private readonly game: string) {}

  private key(k: string): string { return `${this.game}.${k}`; }

  /** 마지막으로 쓴 닉네임 */
  get name(): string {
    try { return local()?.getItem(this.key('name')) ?? ''; } catch { return ''; }
  }

  set name(value: string) {
    try { local()?.setItem(this.key('name'), value.slice(0, COMMON.NAME_MAX)); } catch { /* 저장 못 해도 진행 */ }
  }

  /** 새로고침 직전 방의 재접속 토큰 (탭을 닫으면 사라짐) */
  get reconnectToken(): string | null {
    try { return session()?.getItem(this.key('reconnect')) ?? null; } catch { return null; }
  }

  set reconnectToken(token: string | null) {
    try {
      if (token) session()?.setItem(this.key('reconnect'), token);
      else session()?.removeItem(this.key('reconnect'));
    } catch { /* 저장 못 해도 진행 */ }
  }

  /** 아무 값 (게임별 설정 등). 문자열로 저장 */
  get(k: string): string | null {
    try { return local()?.getItem(this.key(k)) ?? null; } catch { return null; }
  }

  set(k: string, value: string): void {
    try { local()?.setItem(this.key(k), value); } catch { /* 저장 못 해도 진행 */ }
  }
}
