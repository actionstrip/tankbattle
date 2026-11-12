// 방 공통 채팅 (모든 게임). 방의 messages에 handlers를 펼쳐 넣고, 나간 사람은 forget으로 지운다.
//   messages = { ...this.chat.handlers, ...게임 메시지 }
//   - chat:        채팅 보내기 → 다듬어서 방 전체에 'chat' 으로 돌린다 (길이 제한·도배 방지)
//   - chatHistory: 최근 채팅 (입장·재접속 직후 클라이언트가 한 번 요청)
import { validate } from 'colyseus';
import type { Client, Room } from 'colyseus';
import { z } from 'zod';
import { CHAT, cleanText } from '@games/common';
import type { ChatMessage } from '@games/common';

/** 보낸 사람 정보 (방에 없는 사람이면 null → 무시) */
export type ChatSender = (client: Client) => { name: string; color: number } | null | undefined;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRoom = Room<any>;

export class RoomChat {
  /** 최근 채팅 (대기실·게임 공통) */
  private readonly log: ChatMessage[] = [];
  /** 사람별 마지막 채팅 시각 (도배 방지) */
  private readonly lastAt = new Map<string, number>();

  constructor(private readonly room: AnyRoom, private readonly sender: ChatSender) {}

  readonly handlers = {
    chat: validate(z.object({ text: z.string().max(500) }), (client: Client, { text }) => {
      const who = this.sender(client);
      if (!who) return;
      const now = Date.now();
      if (now - (this.lastAt.get(client.sessionId) ?? 0) < CHAT.INTERVAL_MS) return;
      const clean = cleanText(text, CHAT.MAX, '');
      if (!clean) return;
      this.lastAt.set(client.sessionId, now);
      const msg: ChatMessage = { name: who.name, color: who.color, text: clean };
      this.log.push(msg);
      if (this.log.length > CHAT.HISTORY) this.log.shift();
      this.room.broadcast('chat', msg);
    }),

    chatHistory: (): ChatMessage[] => this.log,
  };

  /** 방을 완전히 나간 사람 정리 */
  forget(sessionId: string): void {
    this.lastAt.delete(sessionId);
  }
}
