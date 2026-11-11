// 대전 방. 지금은 대기실(입장·팀 선택·준비·시작)까지. 게임 진행은 4단계에서 붙인다.
import { Room, validate } from 'colyseus';
import type { Client } from 'colyseus';
import { z } from 'zod';
import { NET, TEAMS, cleanText } from '@fortress/shared';
import type { FortressJoinOptions, FortressRoomMetadata, RoomPhase, Team, TeamSize } from '@fortress/shared';
import { FortressState, PlayerState } from './schema/FortressState';

const teamSchema = z.enum(['blue', 'red']);

export class FortressRoom extends Room<{ state: FortressState; metadata: FortressRoomMetadata }> {
  state = new FortressState();
  private joinCounter = 0;

  messages = {
    /** 팀 바꾸기 (대기실에서만, 자리가 있을 때만) */
    setTeam: validate(z.object({ team: teamSchema }), (client: Client, { team }) => {
      const p = this.player(client);
      if (!p || this.state.phase !== 'lobby' || p.team === team) return;
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

    /** 방장이 게임 시작. 시작할 수 없으면 이유를 돌려준다 (room.request로 받을 수 있음) */
    start: (client: Client) => {
      if (client.sessionId !== this.state.hostId) return { ok: false, reason: '방장만 시작할 수 있어요' };
      const reason = this.cannotStartReason();
      if (reason) return { ok: false, reason };
      this.setPhase('playing');
      this.lock();
      // TODO(4단계): 시드·지형·탱크 배치·첫 턴
      this.broadcast('started', {});
      return { ok: true };
    },
  };

  onCreate(options: FortressJoinOptions): void {
    const teamSize: TeamSize = options.teamSize === 2 ? 2 : 1;
    this.maxClients = teamSize * 2;
    this.state.teamSize = teamSize;
    this.state.title = cleanText(options.title, NET.TITLE_MAX, '포트리스 한 판');
    this.state.phase = 'lobby';
    this.metadata = { title: this.state.title, teamSize, phase: 'lobby' };
  }

  onJoin(client: Client, options: FortressJoinOptions): void {
    const order = this.joinCounter++;
    const p = new PlayerState();
    p.name = cleanText(options?.name, NET.NAME_MAX, `플레이어${order + 1}`);
    // 사람이 적은 팀으로 (같으면 블루)
    p.team = this.teamCount('blue') <= this.teamCount('red') ? 'blue' : 'red';
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
    this.allowReconnection(client, NET.RECONNECT_SECONDS);
  }

  onReconnect(client: Client): void {
    const p = this.player(client);
    if (p) p.connected = true;
  }

  // 완전히 나감 (스스로 나갔거나 재접속 시간 초과)
  onLeave(client: Client): void {
    this.state.players.delete(client.sessionId);
    if (this.state.hostId === client.sessionId) this.passHost();
    // TODO(4단계): 게임 중에 나가면 해당 탱크를 기권 처리
  }

  // ---- 내부 ----

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
    let next: string = '';
    let best = Infinity;
    this.state.players.forEach((p, id) => {
      if (p.joinOrder < best) { best = p.joinOrder; next = id; }
    });
    this.state.hostId = next;
  }

  private cannotStartReason(): string | null {
    if (this.state.phase !== 'lobby') return '이미 시작했어요';
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
