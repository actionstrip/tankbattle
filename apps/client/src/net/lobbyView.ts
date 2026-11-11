// 로비·대기실 화면 (HTML). 닉네임·방 제목 입력이 필요해서 캔버스 대신 DOM으로 그린다.
// 게임 캔버스 위에 겹쳐 띄우고, LobbyScene이 끝나면 없앤다.
import { NET } from '@fortress/shared';
import type { RoomListing } from './session';

const CSS = `
.fl-root { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center;
  font-family: "Malgun Gothic", "Apple SD Gothic Neo", sans-serif; color: #e5edf7; z-index: 10; padding: 16px;
  box-sizing: border-box; pointer-events: none; }
.fl-panel { pointer-events: auto; width: min(720px, 100%); max-height: 100%; overflow: auto; box-sizing: border-box;
  background: rgba(14, 30, 48, 0.92); border: 2px solid rgba(251, 191, 36, 0.7); border-radius: 16px; padding: 22px 24px; }
.fl-title { font-size: 22px; font-weight: 700; margin: 0 0 14px; display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.fl-sub { color: #94a3b8; font-size: 13px; font-weight: 400; }
.fl-row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 12px; }
.fl-input { flex: 1; min-width: 140px; background: #0b1a2b; border: 1px solid #334155; color: #e5edf7; border-radius: 8px;
  padding: 9px 12px; font-size: 15px; font-family: inherit; }
.fl-input:focus { outline: none; border-color: #fbbf24; }
.fl-btn { background: #13263a; color: #e5edf7; border: 1.5px solid rgba(255,255,255,0.15); border-radius: 10px;
  padding: 9px 16px; font-size: 15px; font-weight: 700; font-family: inherit; cursor: pointer; }
.fl-btn:hover:not(:disabled) { border-color: #fbbf24; background: #23405f; }
.fl-btn:disabled { opacity: 0.45; cursor: default; }
.fl-btn.gold { background: #fbbf24; color: #0b1a2b; border-color: #fbbf24; }
.fl-btn.gold:hover:not(:disabled) { background: #fcd34d; }
.fl-list { border: 1px solid #1e3348; border-radius: 10px; min-height: 180px; max-height: 300px; overflow: auto; margin-bottom: 12px; }
.fl-item { display: flex; align-items: center; gap: 12px; padding: 10px 14px; border-bottom: 1px solid #1e3348; cursor: pointer; }
.fl-item:last-child { border-bottom: none; }
.fl-item:hover { background: #17304a; }
.fl-item.off { opacity: 0.5; cursor: default; }
.fl-item.off:hover { background: none; }
.fl-tag { font-size: 12px; padding: 2px 8px; border-radius: 999px; background: #1e3348; color: #cbd5e1; white-space: nowrap; }
.fl-empty { color: #64748b; text-align: center; padding: 60px 0; font-size: 14px; }
.fl-teams { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 14px; }
@media (max-width: 520px) { .fl-teams { grid-template-columns: 1fr; } }
.fl-team { border-radius: 12px; padding: 12px 14px; background: #0b1a2b; border-top: 4px solid var(--c); min-height: 110px; }
.fl-team h3 { margin: 0 0 8px; font-size: 16px; color: var(--c); }
.fl-player { display: flex; align-items: center; gap: 8px; padding: 6px 0; font-size: 15px; }
.fl-player.me { font-weight: 700; }
.fl-ready { margin-left: auto; font-size: 12px; color: #4ade80; }
.fl-wait { margin-left: auto; font-size: 12px; color: #64748b; }
.fl-msg { min-height: 20px; font-size: 13px; color: #fca5a5; margin: 4px 0 10px; }
.fl-msg.info { color: #94a3b8; }
`;

export interface BrowseHandlers {
  onCreate(name: string, title: string, teamSize: 1 | 2): void;
  onJoin(name: string, roomId: string): void;
  onBack(): void;
}

export interface RoomViewPlayer {
  id: string;
  name: string;
  team: string;
  ready: boolean;
  connected: boolean;
  host: boolean;
  me: boolean;
}

export interface RoomViewModel {
  title: string;
  teamSize: number;
  phase: string;
  players: RoomViewPlayer[];
  amHost: boolean;
  myReady: boolean;
}

export interface RoomHandlers {
  onSwitchTeam(): void;
  onReady(ready: boolean): void;
  onStart(): void;
  onLeave(): void;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export class LobbyView {
  private readonly root: HTMLDivElement;
  private readonly style: HTMLStyleElement;
  private readonly panel: HTMLDivElement;
  private msgEl: HTMLElement | null = null;
  private listEl: HTMLElement | null = null;
  private browse: { name: HTMLInputElement; h: BrowseHandlers } | null = null;

  constructor() {
    this.style = document.createElement('style');
    this.style.textContent = CSS;
    document.head.appendChild(this.style);
    this.root = document.createElement('div');
    this.root.className = 'fl-root';
    this.panel = document.createElement('div');
    this.panel.className = 'fl-panel';
    this.root.appendChild(this.panel);
    document.body.appendChild(this.root);
    // 입력 중 키가 게임(Phaser 키보드)으로 새지 않게
    this.root.addEventListener('keydown', (e) => e.stopPropagation());
  }

  destroy(): void {
    this.root.remove();
    this.style.remove();
  }

  message(text: string, info = false): void {
    if (!this.msgEl) return;
    this.msgEl.textContent = text;
    this.msgEl.classList.toggle('info', info);
  }

  /** 대기 중 화면 (연결 중 등) */
  showStatus(text: string, onCancel?: () => void): void {
    this.browse = null;
    this.panel.innerHTML = `<div class="fl-title">온라인 대전</div><div class="fl-msg info">${esc(text)}</div>
      ${onCancel ? '<div class="fl-row"><button class="fl-btn" data-a="cancel">뒤로</button></div>' : ''}`;
    this.msgEl = this.panel.querySelector('.fl-msg');
    this.panel.querySelector('[data-a=cancel]')?.addEventListener('click', () => onCancel?.());
  }

  // ---- 방 목록 ----

  showBrowse(name: string, h: BrowseHandlers): void {
    this.panel.innerHTML = `
      <div class="fl-title">온라인 대전 <span class="fl-sub">방을 고르거나 새로 만드세요</span></div>
      <div class="fl-row">
        <input class="fl-input" data-f="name" maxlength="${NET.NAME_MAX}" placeholder="닉네임" />
        <input class="fl-input" data-f="title" maxlength="${NET.TITLE_MAX}" placeholder="방 제목 (만들 때)" />
      </div>
      <div class="fl-list" data-f="list"><div class="fl-empty">방 목록을 불러오는 중…</div></div>
      <div class="fl-msg"></div>
      <div class="fl-row">
        <button class="fl-btn gold" data-a="c1">1:1 방 만들기</button>
        <button class="fl-btn gold" data-a="c2">2:2 방 만들기</button>
        <span style="flex:1"></span>
        <button class="fl-btn" data-a="back">타이틀로</button>
      </div>`;
    const nameEl = this.panel.querySelector<HTMLInputElement>('[data-f=name]')!;
    const titleEl = this.panel.querySelector<HTMLInputElement>('[data-f=title]')!;
    nameEl.value = name;
    this.msgEl = this.panel.querySelector('.fl-msg');
    this.listEl = this.panel.querySelector('[data-f=list]');
    this.browse = { name: nameEl, h };
    const create = (size: 1 | 2) => h.onCreate(nameEl.value.trim(), titleEl.value.trim(), size);
    this.panel.querySelector('[data-a=c1]')!.addEventListener('click', () => create(1));
    this.panel.querySelector('[data-a=c2]')!.addEventListener('click', () => create(2));
    this.panel.querySelector('[data-a=back]')!.addEventListener('click', () => h.onBack());
    if (!name) nameEl.focus();
  }

  setRooms(rooms: RoomListing[]): void {
    const list = this.listEl;
    const b = this.browse;
    if (!list || !b) return;
    if (!rooms.length) {
      list.innerHTML = '<div class="fl-empty">열린 방이 없어요. 새로 만들어 보세요!</div>';
      return;
    }
    list.innerHTML = '';
    for (const r of rooms) {
      const playing = r.metadata.phase !== 'lobby';
      const full = r.clients >= r.maxClients;
      const off = playing || full || r.locked;
      const el = document.createElement('div');
      el.className = `fl-item${off ? ' off' : ''}`;
      el.innerHTML = `<span class="fl-tag">${r.metadata.teamSize === 2 ? '2:2' : '1:1'}</span>
        <span style="flex:1">${esc(r.metadata.title)}</span>
        <span class="fl-sub">${r.clients}/${r.maxClients}</span>
        <span class="fl-tag">${playing ? '게임 중' : full ? '가득 참' : '대기 중'}</span>`;
      if (!off) el.addEventListener('click', () => b.h.onJoin(b.name.value.trim(), r.roomId));
      list.appendChild(el);
    }
  }

  // ---- 대기실 ----

  showRoom(m: RoomViewModel, h: RoomHandlers): void {
    this.browse = null;
    this.listEl = null;
    const team = (key: string, label: string, color: string) => {
      const members = m.players.filter((p) => p.team === key);
      const rows = members.map((p) => `<div class="fl-player${p.me ? ' me' : ''}">
          ${esc(p.name)}${p.host ? ' <span class="fl-tag">방장</span>' : ''}${p.me ? ' <span class="fl-sub">(나)</span>' : ''}
          ${!p.connected ? '<span class="fl-wait">재접속 대기</span>'
            : p.host ? '' : p.ready ? '<span class="fl-ready">준비 완료</span>' : '<span class="fl-wait">대기</span>'}
        </div>`).join('');
      const empty = Array.from({ length: Math.max(0, m.teamSize - members.length) },
        () => '<div class="fl-player fl-sub">빈 자리</div>').join('');
      return `<div class="fl-team" style="--c:${color}"><h3>${label}</h3>${rows}${empty}</div>`;
    };
    const ended = m.phase === 'ended';
    this.panel.innerHTML = `
      <div class="fl-title">${esc(m.title)} <span class="fl-sub">${m.teamSize === 2 ? '2:2 팀전' : '1:1'}</span></div>
      <div class="fl-teams">${team('blue', '블루팀', '#3b82f6')}${team('red', '레드팀', '#ef4444')}</div>
      <div class="fl-msg ${ended ? 'info' : ''}">${ended ? '방장이 대기실로 돌아오면 다음 판을 준비할 수 있어요' : ''}</div>
      <div class="fl-row">
        <button class="fl-btn" data-a="team" ${ended ? 'disabled' : ''}>팀 바꾸기</button>
        ${m.amHost
          ? `<button class="fl-btn gold" data-a="start" ${ended ? 'disabled' : ''}>게임 시작</button>`
          : `<button class="fl-btn gold" data-a="ready" ${ended ? 'disabled' : ''}>${m.myReady ? '준비 취소' : '준비'}</button>`}
        <span style="flex:1"></span>
        <button class="fl-btn" data-a="leave">나가기</button>
      </div>`;
    this.msgEl = this.panel.querySelector('.fl-msg');
    this.panel.querySelector('[data-a=team]')!.addEventListener('click', () => h.onSwitchTeam());
    this.panel.querySelector('[data-a=start]')?.addEventListener('click', () => h.onStart());
    this.panel.querySelector('[data-a=ready]')?.addEventListener('click', () => h.onReady(!m.myReady));
    this.panel.querySelector('[data-a=leave]')!.addEventListener('click', () => h.onLeave());
  }
}
