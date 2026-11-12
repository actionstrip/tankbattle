// 온라인 채팅 (모든 게임, 대기실·게임 화면 공통). 서버 쪽은 apps/server/src/common/chat.ts.
// ChatLog: 방에 들어가 있는 동안 메시지를 모아 둔다 (대기실 ↔ 게임 화면을 오가도 그대로).
// ChatBox: 화면 표시 (HTML). 한글 입력(IME) 때문에 캔버스 대신 DOM으로 그린다.
//   docked   — 대기실 패널 안에 목록 + 입력칸 상시 표시
//   floating — 게임 화면 위에 떠 있다가 몇 초 뒤 흐려진다. Enter로 입력칸을 연다.
import type { Room } from '@colyseus/sdk';
import { CHAT } from '@games/common';
import type { ChatMessage } from '@games/common';

/** 채팅을 쓰는 방 (서버 방이 RoomChat 의 chat·chatHistory 를 가진 어떤 게임 방이든) */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ChatRoom = Room<any>;

interface ChatEntry extends ChatMessage {
  /** 받은 시각 (ms). 지난 기록은 0 → 떠 있는 창에는 새로 받은 것만 잠깐 보인다 */
  at: number;
}

type Listener = (added: ChatEntry | null) => void;

const KEEP = 50;

export class ChatLog {
  entries: ChatEntry[] = [];
  private readonly listeners = new Set<Listener>();

  constructor(private readonly room: ChatRoom) {
    room.onMessage('chat', (m: ChatMessage) => {
      const e: ChatEntry = { ...m, at: Date.now() };
      this.entries.push(e);
      if (this.entries.length > KEEP) this.entries.shift();
      this.emit(e);
    });
    void this.load();
    room.onReconnect(() => { void this.load(); });
  }

  /** 서버에 보관된 최근 채팅으로 채운다 (입장·재접속 직후) */
  private async load(): Promise<void> {
    const list = await (this.room.request('chatHistory') as Promise<ChatMessage[]>).catch(() => null);
    if (!list) return;
    this.entries = list.map((m) => ({ ...m, at: 0 }));
    this.emit(null);
  }

  send(text: string): void {
    const t = text.trim().slice(0, CHAT.MAX);
    if (t) this.room.send('chat', { text: t });
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  private emit(added: ChatEntry | null): void {
    for (const fn of this.listeners) fn(added);
  }
}

const CSS = `
.fc-box { font-family: "Malgun Gothic", "Apple SD Gothic Neo", sans-serif; color: #e5edf7; box-sizing: border-box; }
.fc-list { overflow-y: auto; overflow-x: hidden; word-break: break-all; }
.fc-line { padding: 2px 0; line-height: 1.35; }
.fc-name { font-weight: 700; margin-right: 6px; }
.fc-row { display: flex; gap: 8px; margin-top: 8px; }
.fc-input { flex: 1; min-width: 0; background: #0b1a2b; border: 1px solid #334155; color: #e5edf7; border-radius: 8px;
  padding: 7px 10px; font-size: 14px; font-family: inherit; }
.fc-input:focus { outline: none; border-color: #fbbf24; }
.fc-send { background: #13263a; color: #e5edf7; border: 1.5px solid rgba(255,255,255,0.15); border-radius: 8px;
  padding: 0 14px; font-size: 14px; font-weight: 700; font-family: inherit; cursor: pointer; }
.fc-send:hover { border-color: #fbbf24; background: #23405f; }
.fc-empty { color: #64748b; font-size: 13px; }
.fc-hint { color: #cbd5e1; font-size: 0.8em; margin-top: 4px; text-shadow: 0 1px 2px #000, 0 0 3px #000; }

/* 대기실: 패널 안 */
.fc-box.docked { border-top: 1px solid #1e3348; margin-top: 14px; padding-top: 12px; }
.fc-box.docked .fc-list { height: 120px; font-size: 14px; }

/* 게임 화면: 왼쪽 위에 떠 있음. 평소에는 클릭이 게임으로 통과 */
.fc-box.floating { position: fixed; z-index: 5; pointer-events: none; }
.fc-box.floating .fc-list { max-height: 9.5em; padding: 6px 10px; border-radius: 10px; scrollbar-width: none; }
.fc-box.floating .fc-list::-webkit-scrollbar { display: none; }
.fc-box.floating .fc-line { text-shadow: 0 1px 2px #000, 0 0 3px #000; transition: opacity 1s; }
.fc-box.floating .fc-line.old { opacity: 0; }
.fc-box.floating .fc-row, .fc-box.floating .fc-hint { display: none; }
.fc-box.floating.open { pointer-events: auto; }
.fc-box.floating.open .fc-list { background: rgba(11, 26, 43, 0.82); border: 1px solid rgba(255,255,255,0.14); }
.fc-box.floating.open .fc-line.old { opacity: 1; }
.fc-box.floating.open .fc-row { display: flex; }
.fc-box.floating.open .fc-hint { display: block; }
.fc-box.floating .fc-input { font-size: 1em; padding: 0.4em 0.7em; }
`;

const FADE_MS = 8000;
let styleRefs = 0;
let styleEl: HTMLStyleElement | null = null;

export interface FloatingPlace {
  canvas: HTMLCanvasElement;
  /** 게임 좌표계 폭 (캔버스 확대 비율 계산용) */
  gameW: number;
  x: number;
  y: number;
  w: number;
}

export class ChatBox {
  readonly el: HTMLDivElement;
  private readonly list: HTMLDivElement;
  private readonly input: HTMLInputElement;
  private readonly off: () => void;
  private readonly timers = new Set<number>();
  private readonly cleanup: (() => void)[] = [];
  private opened = false;
  /** 떠 있는 창에서 입력칸이 닫힐 때 (게임 키 입력 되살리기 등) */
  onClose: (() => void) | null = null;

  constructor(private readonly log: ChatLog, private readonly mode: 'docked' | 'floating', place?: FloatingPlace) {
    if (styleRefs++ === 0) {
      styleEl = document.createElement('style');
      styleEl.textContent = CSS;
      document.head.appendChild(styleEl);
    }
    this.el = document.createElement('div');
    this.el.className = `fc-box ${mode}`;
    this.el.innerHTML = `<div class="fc-list"></div>
      <div class="fc-row"><input class="fc-input" maxlength="${CHAT.MAX}" placeholder="메시지 입력" />
      <button class="fc-send">보내기</button></div>
      ${mode === 'floating' ? '<div class="fc-hint">Enter 보내기 · Esc 닫기</div>' : ''}`;
    this.list = this.el.querySelector('.fc-list')!;
    this.input = this.el.querySelector('.fc-input')!;

    // 입력 중인 키가 게임(Phaser 키보드, window에서 받음)으로 새지 않게 여기서 멈춘다.
    // → 채팅 중 WASD·Space·방향키가 탱크를 움직이지 않고, 입력칸에 그대로 들어간다.
    for (const type of ['keydown', 'keyup', 'keypress'] as const) {
      this.el.addEventListener(type, (e) => e.stopPropagation());
    }
    this.input.addEventListener('keydown', (e) => {
      if (e.isComposing) return; // 한글 조합 중 Enter는 글자 확정용
      if (e.key === 'Enter') {
        e.preventDefault();
        this.submit();
        if (this.mode === 'floating') this.close();
      } else if (e.key === 'Escape' && this.mode === 'floating') {
        e.preventDefault();
        this.close();
      }
    });
    // 떠 있는 창: 게임 화면을 클릭하는 등 입력칸 밖으로 포커스가 나가면 닫는다 (키가 다시 게임으로 가도록)
    this.input.addEventListener('blur', (e) => {
      if (this.mode !== 'floating' || !this.opened) return;
      if (e.relatedTarget instanceof Node && this.el.contains(e.relatedTarget)) return; // 보내기 버튼
      this.close();
    });
    this.el.querySelector('.fc-send')!.addEventListener('click', () => {
      this.submit();
      if (this.mode === 'floating') this.close(); else this.input.focus();
    });

    this.off = log.subscribe((added) => this.render(added));
    this.render(null);

    if (place) {
      document.body.appendChild(this.el);
      const fit = () => {
        const rect = place.canvas.getBoundingClientRect();
        const s = rect.width / place.gameW;
        this.el.style.left = `${rect.left + place.x * s}px`;
        this.el.style.top = `${rect.top + place.y * s}px`;
        this.el.style.width = `${place.w * s}px`;
        this.el.style.fontSize = `${Math.max(11, 15 * s)}px`;
      };
      fit();
      const ro = new ResizeObserver(fit);
      ro.observe(place.canvas);
      window.addEventListener('resize', fit);
      this.cleanup.push(() => { ro.disconnect(); window.removeEventListener('resize', fit); });
    }
  }

  get isOpen(): boolean { return this.opened; }

  /** 떠 있는 창: 입력칸 열기 */
  open(): void {
    if (this.mode !== 'floating' || this.opened) return;
    this.opened = true;
    this.el.classList.add('open');
    this.list.scrollTop = this.list.scrollHeight;
    // Enter를 누른 그 키 입력이 끝난 뒤에 포커스 (같은 Enter가 입력칸에 들어가지 않게)
    setTimeout(() => this.input.focus(), 0);
  }

  close(): void {
    if (this.mode !== 'floating' || !this.opened) return;
    this.opened = false;
    this.el.classList.remove('open');
    this.input.value = '';
    this.input.blur();
    this.onClose?.();
  }

  destroy(): void {
    this.off();
    for (const t of this.timers) clearTimeout(t);
    for (const fn of this.cleanup) fn();
    this.el.remove();
    if (--styleRefs === 0) {
      styleEl?.remove();
      styleEl = null;
    }
  }

  private submit(): void {
    this.log.send(this.input.value);
    this.input.value = '';
  }

  private render(added: ChatEntry | null): void {
    const atBottom = this.list.scrollTop + this.list.clientHeight >= this.list.scrollHeight - 8;
    if (added === null) {
      this.list.innerHTML = '';
      const shown = this.mode === 'floating' ? this.log.entries.slice(-12) : this.log.entries;
      for (const e of shown) this.list.appendChild(this.line(e));
      if (!shown.length && this.mode === 'docked') {
        this.list.innerHTML = '<div class="fc-empty">같은 방 사람들과 이야기해 보세요.</div>';
      }
    } else {
      this.list.querySelector('.fc-empty')?.remove();
      this.list.appendChild(this.line(added));
      if (this.mode === 'floating') {
        while (this.list.childElementCount > 12) this.list.firstElementChild!.remove();
      }
    }
    if (atBottom || added) this.list.scrollTop = this.list.scrollHeight;
  }

  private line(e: ChatEntry): HTMLDivElement {
    const el = document.createElement('div');
    el.className = 'fc-line';
    const name = document.createElement('span');
    name.className = 'fc-name';
    name.style.color = `#${(e.color ?? 0xe5edf7).toString(16).padStart(6, '0')}`;
    name.textContent = e.name;
    el.append(name, document.createTextNode(e.text));
    if (this.mode === 'floating') {
      // 새 메시지만 잠깐 보였다가 흐려진다 (입력칸을 열면 다시 보임)
      const left = e.at ? FADE_MS - (Date.now() - e.at) : 0;
      if (left <= 0) {
        el.classList.add('old');
      } else {
        const t = window.setTimeout(() => { el.classList.add('old'); this.timers.delete(t); }, left);
        this.timers.add(t);
      }
    }
    return el;
  }
}
