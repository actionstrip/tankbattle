// 온라인 로비: 방 목록 → 대기실 → (방장이 시작) → GameScene(온라인).
// 게임이 끝나면 같은 세션으로 다시 이 화면(대기실)으로 돌아온다.
import Phaser from 'phaser';
import { FFA_COLORS, NET } from '@fortress/shared';
import { CONFIG } from '../config';
import { ChatBox } from '../net/chat';
import { LobbyView } from '../net/lobbyView';
import type { RoomViewModel } from '../net/lobbyView';
import { NetSession, saveName, savedName } from '../net/session';
import type { GameRoom, GameState } from '../net/session';
import { Sfx } from '../sound';
import { addFixedBackground } from '../ui';

export class LobbyScene extends Phaser.Scene {
  private net!: NetSession;
  private view!: LobbyView;
  private stopWatching: (() => void) | null = null;
  /** 이 화면이 room에 붙인 리스너 해제 */
  private detach: (() => void) | null = null;
  private busy = false;
  /** 이 화면이 떠 있는 동안 true. (create 도중에는 scene.isActive()가 아직 false라 따로 둔다) */
  private alive = false;

  constructor() { super('Lobby'); }

  init(data: { net?: NetSession; message?: string }): void {
    this.net = data.net ?? new NetSession();
    this.registry.set('lobbyMessage', data.message ?? '');
  }

  create(): void {
    const W = CONFIG.GAME_W;
    const H = CONFIG.GAME_H;
    addFixedBackground(this);
    this.add.rectangle(0, 0, W, H, 0x0b1a2b, 0.55).setOrigin(0);
    this.view = new LobbyView();
    this.alive = true;
    this.events.once('shutdown', () => {
      this.alive = false;
      this.stopWatching?.();
      this.stopWatching = null;
      this.detach?.();
      this.detach = null;
      this.view.destroy();
    });

    const message = this.registry.get('lobbyMessage') as string;
    if (this.net.room) {
      this.enterRoom(this.net.room);
    } else {
      this.view.showStatus('서버에 연결하는 중…');
      // 새로고침 직전에 있던 방이 있으면 다시 들어간다
      void this.net.resume().then((room) => {
        if (!this.alive) return;
        if (room) this.enterRoom(room);
        else void this.browse(message);
      });
    }
  }

  // ---- 방 목록 ----

  private async browse(message = ''): Promise<void> {
    this.detach?.();
    this.detach = null;
    this.view.showBrowse(savedName(), {
      onCreate: (name, title, kind) => this.run(async () => {
        saveName(name);
        this.enterRoom(await this.net.create(name, title, kind));
      }),
      onJoin: (name, roomId) => this.run(async () => {
        saveName(name);
        this.enterRoom(await this.net.join(roomId, name));
      }),
      onBack: () => {
        Sfx.play('ui_click');
        this.scene.start('Title');
      },
    });
    if (message) this.view.message(message);
    try {
      this.stopWatching?.();
      this.stopWatching = await this.net.watchRooms((rooms) => this.view.setRooms(rooms));
      if (!this.alive) this.stopWatching();
    } catch {
      this.view.setRooms([]);
      this.view.message('게임 서버에 연결할 수 없어요. 서버가 켜져 있는지 확인하세요.');
    }
  }

  /** 버튼 동작: 겹쳐 누르기 방지 + 실패 메시지 */
  private run(fn: () => Promise<void>): void {
    if (this.busy) return;
    this.busy = true;
    Sfx.play('ui_click');
    fn().catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      this.view.message(`들어갈 수 없어요: ${msg}`);
    }).finally(() => { this.busy = false; });
  }

  // ---- 대기실 ----

  private enterRoom(room: GameRoom): void {
    this.stopWatching?.();
    this.stopWatching = null;
    this.detach?.();

    let sentBack = false;
    const render = (state: GameState) => {
      if (!this.alive) return;
      // 게임이 끝나고 돌아온 방장은 방을 대기실 상태로 되돌린다
      // (재접속 직후에는 상태가 아직 비어 있을 수 있어 상태를 받을 때마다 확인)
      if (state.phase === 'ended' && state.hostId === room.sessionId && !sentBack) {
        sentBack = true;
        room.send('backToLobby', {});
      }
      if (state.phase === 'playing') {
        this.scene.start('Game', { mode: 'online', net: this.net });
        return;
      }
      this.view.showRoom(this.model(room, state), {
        onSwitchTeam: () => {
          Sfx.play('ui_click');
          const me = state.players.get(room.sessionId);
          room.send('setTeam', { team: me?.team === 'blue' ? 'red' : 'blue' });
        },
        onReady: (ready) => {
          Sfx.play('ui_click');
          room.send('setReady', { ready });
        },
        onStart: () => this.run(async () => {
          const res = await room.request('start');
          if (!res.ok) this.view.message(res.reason ?? '시작할 수 없어요');
        }),
        onLeave: () => this.run(async () => {
          await this.net.leave();
          void this.browse();
        }),
      });
    };
    const onLeave = () => {
      if (this.alive) void this.browse('방에서 나왔어요.');
    };
    room.onStateChange(render);
    room.onLeave(onLeave);
    // 대기실 채팅 (게임 화면과 같은 기록)
    const chat = this.net.chat ? new ChatBox(this.net.chat, 'docked') : null;
    this.view.setChat(chat?.el ?? null);
    this.detach = () => {
      room.onStateChange.remove(render);
      room.onLeave.remove(onLeave);
      this.view.setChat(null);
      chat?.destroy();
    };
    if (room.state) render(room.state);
  }

  private model(room: GameRoom, state: GameState): RoomViewModel {
    const players = [...state.players.entries()]
      .sort(([, a], [, b]) => a.joinOrder - b.joinOrder)
      .map(([id, p]) => ({
        id,
        name: p.name,
        team: p.team,
        ready: p.ready,
        connected: p.connected,
        host: id === state.hostId,
        me: id === room.sessionId,
        color: `#${FFA_COLORS[p.slot % FFA_COLORS.length].color.toString(16).padStart(6, '0')}`,
      }));
    return {
      title: state.title,
      teamSize: state.teamSize,
      ffa: state.ffa,
      maxPlayers: state.ffa ? NET.FFA_MAX : state.teamSize * 2,
      phase: state.phase,
      players,
      amHost: state.hostId === room.sessionId,
      myReady: !!state.players.get(room.sessionId)?.ready,
    };
  }
}
