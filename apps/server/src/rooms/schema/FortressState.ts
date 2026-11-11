// 방 상태 (모든 접속자에게 자동 동기화). 작은 값만 둔다.
// 지형(픽셀)은 넣지 않는다. 바뀐 내용은 'shot' 메시지로, 처음부터의 기록은 'terrainLog' 요청으로 보낸다.
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

/** 게임 중 탱크. 배열 순서 = 턴 순서 */
export const TankState = schema({
  /** 조종하는 사람 sessionId (나가면 빈 문자열) */
  owner: t.string(),
  name: t.string(),
  team: t.string(),
  color: t.number(),
  sprite: t.string(),
  x: t.number(),
  y: t.number(),
  facing: t.number(),
  elevation: t.number(),
  hp: t.number(),
  fuel: t.number(),
  dead: t.boolean().default(false),
  /** 무기별 남은 탄 (-1 = 무제한) */
  stock: t.array('number'),
}, 'TankState');
export type TankState = SchemaType<typeof TankState>;

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

  // ---- 게임 중 ----
  tanks: t.array(TankState),
  /** 지금 차례인 탱크 번호 (-1 = 아직 시작 전) */
  turn: t.number().default(-1),
  /** 'intro' | 'aiming' | 'flying' | 'resolving' | '' */
  turnPhase: t.string().default(''),
  /** 몇 번째 턴인지 (같은 탱크 차례가 다시 와도 새 턴임을 알 수 있게) */
  turnCount: t.number().default(0),
  wind: t.number().default(0),
  /** 남은 시간 (초, 0.1초 단위로 갱신) */
  timeLeft: t.number().default(0),
  /** 'blue' | 'red' | 'draw' | '' */
  winner: t.string().default(''),
}, 'FortressState');
export type FortressState = SchemaType<typeof FortressState>;
