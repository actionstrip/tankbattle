// 방 상태 (모든 접속자에게 자동 동기화). 작은 값만 둔다.
// 지형처럼 큰 데이터는 넣지 않는다 (구덩이 기록은 4단계에서 메시지로 보낸다).
import { schema, t } from '@colyseus/schema';
import type { SchemaType } from '@colyseus/schema';

export const PlayerState = schema({
  name: t.string(),
  /** 'blue' | 'red' */
  team: t.string(),
  ready: t.boolean().default(false),
  /** 접속이 잠깐 끊겨 재접속을 기다리는 중이면 false */
  connected: t.boolean().default(true),
  /** 들어온 순서 (방장 넘길 때·턴 순서에 사용) */
  joinOrder: t.number(),
}, 'PlayerState');
export type PlayerState = SchemaType<typeof PlayerState>;

export const FortressState = schema({
  /** 'lobby' | 'playing' | 'ended' */
  phase: t.string().default('lobby'),
  title: t.string(),
  /** 팀당 인원 (1 = 1:1, 2 = 2:2) */
  teamSize: t.number().default(1),
  /** 방장 sessionId */
  hostId: t.string(),
  /** key = sessionId */
  players: t.map(PlayerState),
}, 'FortressState');
export type FortressState = SchemaType<typeof FortressState>;
