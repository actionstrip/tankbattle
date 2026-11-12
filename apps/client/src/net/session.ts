// 서버 연결 (Colyseus 0.18 SDK). 로비·대기실·게임 화면이 같은 세션을 이어서 쓴다.
// 서버 주소는 VITE_SERVER_URL 하나로만 정한다 (.env.development / .env.production).
import { Callbacks, Client } from '@colyseus/sdk';
import type { Room } from '@colyseus/sdk';
import { NET, ROOMS } from '@fortress/shared';
import type { FortressRoomMetadata, TeamSize } from '@fortress/shared';
import { ChatLog } from './chat';
// 서버 정의를 타입으로만 가져온다 → 방 이름·옵션·상태·메시지 타입이 서버와 자동으로 맞는다 (번들에는 안 들어감)
import type { server } from '../../../server/src/app.config';

type ServerType = typeof server;
export type GameRoom = Room<ServerType['~rooms']['fortress']['~room']>;
export type LobbyRoom = Room<ServerType['~rooms']['lobby']['~room']>;
export type GameState = GameRoom['state'];
export type TankNetState = GameState['tanks'][number];

/** 방 목록 한 줄 */
export interface RoomListing {
  roomId: string;
  clients: number;
  maxClients: number;
  locked: boolean;
  metadata: FortressRoomMetadata;
}

const NAME_KEY = 'fortress.name';
const TOKEN_KEY = 'fortress.reconnect';

/** 개발: http://localhost:2567, 운영(IIS): https://도메인/colyseus, Cloud: Cloud 주소 */
export function serverUrl(): string {
  const url = import.meta.env.VITE_SERVER_URL as string | undefined;
  if (url) return url;
  // 지정이 없으면 같은 호스트의 2567 포트
  return `${location.protocol}//${location.hostname}:2567`;
}

function storage(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}

export function savedName(): string {
  return storage()?.getItem(NAME_KEY) ?? '';
}

export function saveName(name: string): void {
  try { storage()?.setItem(NAME_KEY, name.slice(0, NET.NAME_MAX)); } catch { /* 저장 못 해도 진행 */ }
}

/** 새로고침 전에 온라인 방에 있었는지 (있으면 타이틀을 건너뛰고 다시 들어간다) */
export function hasSavedSession(): boolean {
  try { return !!window.sessionStorage.getItem(TOKEN_KEY); } catch { return false; }
}

export class NetSession {
  readonly client = new Client<ServerType>(serverUrl());
  room: GameRoom | null = null;
  /** 지금 방의 채팅 기록 (대기실 ↔ 게임 화면이 같이 쓴다) */
  chat: ChatLog | null = null;

  get sessionId(): string { return this.room?.sessionId ?? ''; }

  get callbacks() { return Callbacks.get(this.room!); }

  /** 방 목록을 실시간으로 받는다. 돌려준 함수를 부르면 그만 받는다 */
  async watchRooms(onChange: (rooms: RoomListing[]) => void): Promise<() => void> {
    const lobby = await this.client.joinOrCreate(ROOMS.LOBBY, { filter: { name: ROOMS.FORTRESS } });
    let rooms: RoomListing[] = [];
    const emit = () => onChange(rooms.filter((r) => r.metadata));
    lobby.onMessage('rooms', (list) => { rooms = list as unknown as RoomListing[]; emit(); });
    lobby.onMessage('+', ([roomId, room]) => {
      const i = rooms.findIndex((r) => r.roomId === roomId);
      const item = room as unknown as RoomListing;
      if (i >= 0) rooms[i] = item; else rooms.push(item);
      emit();
    });
    lobby.onMessage('-', (roomId) => { rooms = rooms.filter((r) => r.roomId !== roomId); emit(); });
    return () => { void lobby.leave(); };
  }

  async create(name: string, title: string, teamSize: TeamSize): Promise<GameRoom> {
    return this.attach(await this.client.create(ROOMS.FORTRESS, { name, title, teamSize }));
  }

  async join(roomId: string, name: string): Promise<GameRoom> {
    return this.attach(await this.client.joinById(roomId, { name }) as GameRoom);
  }

  /** 새로고침 직전 방이 있으면 다시 들어간다 (서버가 30초 동안 자리를 비워 둔다) */
  async resume(): Promise<GameRoom | null> {
    let token: string | null = null;
    try { token = window.sessionStorage.getItem(TOKEN_KEY); } catch { /* 없음 */ }
    if (!token) return null;
    try {
      return this.attach(await this.client.reconnect(token) as GameRoom);
    } catch {
      this.forgetToken();
      return null;
    }
  }

  async leave(): Promise<void> {
    const room = this.room;
    this.room = null;
    this.chat = null;
    this.forgetToken();
    if (room) await room.leave().catch(() => 0);
  }

  private attach(room: GameRoom): GameRoom {
    this.room = room;
    this.chat = new ChatLog(room);
    const remember = () => {
      try { window.sessionStorage.setItem(TOKEN_KEY, room.reconnectionToken); } catch { /* 저장 못 해도 진행 */ }
    };
    remember();
    room.onReconnect(remember);
    room.onLeave(() => {
      if (this.room === room) {
        this.room = null;
        this.chat = null;
      }
      this.forgetToken();
    });
    return room;
  }

  private forgetToken(): void {
    try { window.sessionStorage.removeItem(TOKEN_KEY); } catch { /* 없음 */ }
  }
}
