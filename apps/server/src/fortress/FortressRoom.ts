// 대전 방: 대기실(입장·팀 선택·준비·시작) → 게임(서버 판정) → 결과 → 다시 대기실.
import { Room, validate } from 'colyseus';
import type { Client as ColyseusClient, Delayed } from 'colyseus';
import { z } from 'zod';
import {
  FFA_COLORS, NET, RULES, TEAMS, TIMING, cleanText, encodeStock, randomSeed, sideOf,
} from '@fortress/shared';
import type {
  ChatMessage, FortressJoinOptions, FortressRoomMetadata, RoomPhase, ShotMessage, Team, TeamSize, TerrainOp,
} from '@fortress/shared';
import { RoomChat } from '../common/chat';
import { Match } from './Match';
import { FortressState, PlayerState, TankState } from './schema/FortressState';

/** 서버 → 클라이언트 메시지 (클라이언트 room.onMessage 타입이 이것으로 맞춰진다) */
type Client = ColyseusClient<{
  messages: {
    started: Record<string, never>;
    shot: ShotMessage;
    chat: ChatMessage;
  };
}>;

const teamSchema = z.enum(['blue', 'red']);
const TICK_MS = 1000 / 60;

export class FortressRoom extends Room<{ state: FortressState; metadata: FortressRoomMetadata; client: Client }> {
  state = new FortressState();
  private joinCounter = 0;
  private match: Match | null = null;
  private turnTimer: Delayed | null = null;
  /** 연출 대기 시간 배율. 테스트에서만 줄인다 (NODE_ENV=test 일 때 timeScale 옵션) */
  private timeScale = 1;
  /** 채팅 (대기실·게임 어디서나, 모든 게임 공통 처리) */
  private readonly chat: RoomChat = new RoomChat(this, (client) => {
    const p = this.player(client as Client);
    return p && { name: p.name, color: this.chatColor(p) };
  });

  messages = {
    // ---- 채팅: chat(보내기), chatHistory(최근 기록) ----
    ...this.chat.handlers,

    // ---- 대기실 ----

    /** 팀 바꾸기 (자리가 있을 때만) */
    setTeam: validate(z.object({ team: teamSchema }), (client: Client, { team }) => {
      const p = this.player(client);
      if (!p || this.state.ffa || this.state.phase !== 'lobby' || p.team === team) return;
      if (this.teamCount(team) >= this.state.teamSize) return;
      p.team = team;
      p.ready = false;
    }),

    /** 준비 / 준비 취소 */
    setReady: validate(z.object({ ready: z.boolean() }), (client: Client, { ready }) => {
      const p = this.player(client);
      if (!p || this.state.phase !== 'lobby') return;
      p.ready = ready;
    }),

    /** 방장이 게임 시작. 시작할 수 없으면 이유를 돌려준다 (room.request로 받음) */
    start: (client: Client) => {
      if (client.sessionId !== this.state.hostId) return { ok: false, reason: '방장만 시작할 수 있어요' };
      const reason = this.cannotStartReason();
      if (reason) return { ok: false, reason };
      this.startGame(randomSeed());
      return { ok: true };
    },

    /** 게임이 끝난 뒤 방장이 대기실로 되돌린다 */
    backToLobby: (client: Client) => {
      if (client.sessionId !== this.state.hostId || this.state.phase !== 'ended') return;
      this.resetToLobby();
    },

    // ---- 게임 중 (차례인 사람만) ----

    /** 이동 키를 누르고 있는 방향 (-1, 0, 1). 떼면 0 */
    move: validate(z.object({ dir: z.number().int().min(-1).max(1) }), (client: Client, { dir }) => {
      if (!this.isMyAimingTurn(client)) return;
      this.match!.moveDir = dir;
      if (dir) this.match!.active!.facing = dir;
    }),

    /** 포신 각도 */
    aim: validate(z.object({ elevation: z.number().finite() }), (client: Client, { elevation }) => {
      if (!this.isMyAimingTurn(client)) return;
      this.match!.setElevation(elevation);
    }),

    /** 발사 */
    fire: validate(z.object({
      weapon: z.number().int(),
      power: z.number().finite(),
      elevation: z.number().finite(),
      facing: z.number().int().min(-1).max(1),
    }), (client: Client, msg) => {
      if (!this.isMyAimingTurn(client, TIMING.FIRE_GRACE_S)) return;
      const m = this.match!;
      if (m.active!.falling || !m.canUse(msg.weapon)) return;
      this.fire(msg.weapon, msg.power, msg.elevation, msg.facing);
    }),

    /** 처음부터의 지형 변경 기록 (재접속·새로고침 후 지형 맞추기) */
    terrainLog: (): TerrainOp[] => this.match?.terrainLog ?? [],
  };

  onCreate(options: FortressJoinOptions & { timeScale?: number }): void {
    if (process.env.NODE_ENV === 'test' && typeof options.timeScale === 'number') this.timeScale = options.timeScale;
    const ffa = options.ffa === true;
    const teamSize: TeamSize = options.teamSize === 2 ? 2 : 1;
    this.maxClients = ffa ? NET.FFA_MAX : teamSize * 2;
    this.state.ffa = ffa;
    this.state.teamSize = teamSize;
    this.state.title = cleanText(options.title, NET.TITLE_MAX, '포트리스 한 판');
    this.state.phase = 'lobby';
    this.metadata = { title: this.state.title, teamSize, ffa, phase: 'lobby' };
    this.setTimestep((dtMs) => this.update(dtMs / 1000), TICK_MS);
  }

  onJoin(client: Client, options: FortressJoinOptions): void {
    const order = this.joinCounter++;
    const p = new PlayerState();
    p.name = cleanText(options?.name, NET.NAME_MAX, `플레이어${order + 1}`);
    // 사람이 적은 팀으로 (같으면 블루). 개인전은 팀이 없고 비어 있는 색 자리를 받는다
    p.team = this.teamCount('blue') <= this.teamCount('red') ? 'blue' : 'red';
    if (this.state.ffa) p.slot = this.freeSlot();
    p.ready = false;
    p.connected = true;
    p.joinOrder = order;
    this.state.players.set(client.sessionId, p);
    if (!this.state.hostId) this.state.hostId = client.sessionId;
  }

  // 갑자기 끊김: 잠깐 자리를 비워 두고 다시 들어오길 기다린다.
  onDrop(client: Client): void {
    const p = this.player(client);
    if (p) {
      p.connected = false;
      p.ready = false;
    }
    if (this.match?.active && this.match.owners[this.match.turn] === client.sessionId) this.match.moveDir = 0;
    this.allowReconnection(client, NET.RECONNECT_SECONDS);
  }

  onReconnect(client: Client): void {
    const p = this.player(client);
    if (p) p.connected = true;
  }

  // 완전히 나감 (스스로 나갔거나 재접속 시간 초과)
  onLeave(client: Client): void {
    this.state.players.delete(client.sessionId);
    this.chat.forget(client.sessionId);
    if (this.state.hostId === client.sessionId) this.passHost();
    const m = this.match;
    if (m && this.state.phase === 'playing') {
      const i = m.indexOf(client.sessionId);
      if (i >= 0) {
        m.forfeit(client.sessionId);
        this.state.tanks[i].owner = '';
        this.syncTanks();
        // 조준 중이면 다음 틱(update)에서 차례를 넘기거나 게임을 끝낸다. 포탄이 날고 있으면 원래 예정대로.
      }
    }
  }

  // ---- 게임 진행 ----

  private startGame(seed: number): void {
    const seats = [...this.state.players.entries()]
      .sort(([, a], [, b]) => a.joinOrder - b.joinOrder)
      .map(([sessionId, p]) => ({ sessionId, name: p.name, team: p.team as Team, slot: p.slot }));
    const m = new Match(seed, seats, this.state.ffa);
    this.match = m;

    this.state.tanks.clear();
    m.tanks.forEach((t, i) => {
      const s = new TankState();
      s.owner = m.owners[i];
      s.name = t.player.name;
      s.team = t.player.team;
      s.side = sideOf(t.player);
      s.color = t.player.color;
      s.sprite = t.player.sprite;
      this.state.tanks.push(s);
    });
    this.syncTanks();
    this.state.winner = '';
    this.state.turn = -1;
    this.state.turnCount = 0;
    this.state.wind = 0;
    this.state.timeLeft = RULES.TURN_SECONDS;
    this.state.turnPhase = 'intro';
    this.setPhase('playing');
    this.lock();
    this.broadcast('started', {});

    const intro = TIMING.INTRO_BASE_MS + TIMING.INTRO_PER_TANK_MS * m.tanks.length;
    this.schedule(intro, () => this.beginTurn());
  }

  private beginTurn(): void {
    const m = this.match!;
    m.nextTurn();
    this.state.turn = m.turn;
    this.state.turnCount = m.turnCount;
    this.state.wind = m.wind;
    this.state.timeLeft = m.timeLeft;
    this.state.turnPhase = 'aiming';
    this.syncTanks();
  }

  private update(dt: number): void {
    const m = this.match;
    if (!m || this.state.phase !== 'playing') return;
    const aiming = this.state.turnPhase === 'aiming';
    m.tick(dt, aiming);
    if (aiming) {
      m.timeLeft -= dt;
      this.state.timeLeft = Math.max(0, Math.ceil(m.timeLeft * 10) / 10);
      const owner = this.state.players.get(m.owners[m.turn]);
      const away = !owner || !owner.connected;
      if (m.timeLeft < -TIMING.FIRE_GRACE_S
        || (away && m.timeLeft < RULES.TURN_SECONDS - TIMING.DISCONNECTED_TURN_S)
        || m.active!.dead
        || m.aliveSides().length < 2) { // 상대가 모두 나갔거나 추락
        this.skipTurn();
      }
    }
    this.syncTanks();
  }

  private fire(weapon: number, power: number, elevation: number, facing: number): void {
    const m = this.match!;
    const { volley, seconds } = m.fire(weapon, power, elevation, facing);
    this.state.turnPhase = 'flying';
    this.syncTanks();
    this.broadcast('shot', { ...volley, shooter: m.turn, turnCount: m.turnCount });
    this.schedule(seconds * 1000 + TIMING.AFTER_SHOT_MS, () => this.endTurn());
  }

  /** 쏘지 않고 차례를 넘김 (시간 초과·접속 끊김·기권) */
  private skipTurn(): void {
    const m = this.match!;
    m.moveDir = 0;
    this.state.turnPhase = 'resolving';
    this.schedule(TIMING.SKIP_MS, () => this.endTurn());
  }

  private endTurn(): void {
    const m = this.match!;
    const sides = m.aliveSides();
    if (sides.length < 2) {
      this.state.winner = sides[0] ?? 'draw';
      this.state.turnPhase = '';
      this.setPhase('ended');
      return;
    }
    this.beginTurn();
  }

  private resetToLobby(): void {
    this.turnTimer?.clear();
    this.match = null;
    this.state.tanks.clear();
    this.state.turn = -1;
    this.state.turnPhase = '';
    this.state.winner = '';
    this.state.players.forEach((p) => { p.ready = false; });
    this.setPhase('lobby');
    // 꽉 찬 방이 아니면 다시 목록에 보이게
    if (this.clients.length < this.maxClients) this.unlock();
  }

  private schedule(ms: number, fn: () => void): void {
    this.turnTimer?.clear();
    this.turnTimer = this.clock.setTimeout(fn, ms * this.timeScale);
  }

  /** 계산용 탱크 → 동기화 상태 */
  private syncTanks(): void {
    const m = this.match;
    if (!m) return;
    m.tanks.forEach((t, i) => {
      const s = this.state.tanks[i];
      if (!s) return;
      s.x = t.x;
      s.y = t.y;
      s.facing = t.facing;
      s.elevation = Math.round(t.elevation * 10) / 10;
      s.hp = t.hp;
      s.fuel = Math.max(0, t.fuel);
      s.dead = t.dead;
      t.stock.forEach((n, k) => {
        const v = encodeStock(n);
        if (k >= s.stock.length) s.stock.push(v);
        else if (s.stock[k] !== v) s.stock[k] = v;
      });
    });
  }

  private isMyAimingTurn(client: Client, grace = 0): boolean {
    const m = this.match;
    return !!m && this.state.phase === 'playing' && this.state.turnPhase === 'aiming'
      && m.owners[m.turn] === client.sessionId && m.timeLeft > -grace;
  }

  // ---- 대기실 내부 ----

  private player(client: Client): PlayerState | undefined {
    return this.state.players.get(client.sessionId);
  }

  private teamCount(team: Team): number {
    let n = 0;
    this.state.players.forEach((p) => { if (p.team === team) n++; });
    return n;
  }

  /** 가장 먼저 들어온 사람에게 방장을 넘긴다 */
  private passHost(): void {
    let next = '';
    let best = Infinity;
    this.state.players.forEach((p, id) => {
      if (p.joinOrder < best) { best = p.joinOrder; next = id; }
    });
    this.state.hostId = next;
  }

  /** 개인전: 아직 아무도 쓰지 않는 가장 앞 색 자리 */
  private freeSlot(): number {
    const used = new Set<number>();
    this.state.players.forEach((p) => used.add(p.slot));
    for (let i = 0; i < FFA_COLORS.length; i++) if (!used.has(i)) return i;
    return used.size % FFA_COLORS.length;
  }

  /** 채팅 이름 색: 개인전은 자기 색, 팀전은 팀 색 (어두운 바탕에서 읽기 쉽게 밝은 쪽) */
  private chatColor(p: PlayerState): number {
    if (this.state.ffa) return FFA_COLORS[p.slot % FFA_COLORS.length].color;
    return p.team === 'red' ? 0xf87171 : 0x60a5fa;
  }

  private cannotStartReason(): string | null {
    if (this.state.phase !== 'lobby') return '이미 시작했어요';
    // 개인전: 준비 없이 2명 이상이면 방장이 언제든 시작
    if (this.state.ffa) return this.state.players.size >= 2 ? null : '2명 이상 모여야 시작할 수 있어요';
    for (const team of TEAMS) {
      if (this.teamCount(team) !== this.state.teamSize) return '양 팀 인원이 다 차야 시작할 수 있어요';
    }
    let allReady = true;
    this.state.players.forEach((p, id) => {
      // 방장은 시작 버튼이 곧 준비
      if (id !== this.state.hostId && (!p.ready || !p.connected)) allReady = false;
    });
    return allReady ? null : '모두 준비해야 시작할 수 있어요';
  }

  private setPhase(phase: RoomPhase): void {
    this.state.phase = phase;
    // 0.18의 setMetadata는 통째로 바꾸므로 기존 값을 펼쳐서 넘긴다.
    void this.setMetadata({ ...this.metadata, phase });
  }
}
