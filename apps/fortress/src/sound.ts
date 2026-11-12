// 효과음 (howler.js). 목록과 재생 위치는 docs/sound-effects.md 참고.
//   Sfx.play(id, { volume, rate, pan })  — 한 번 재생. 같은 ID는 동시에 최대 MAX_SAME개.
//   Sfx.loop(id, on, { volume, rate, fade }) — 루프 소리를 켜고 끈다. 매 프레임 불러도 된다. fade = 페이드 ms
//   Sfx.stopLoops()                      — 모든 루프 정지 (씬 종료 시)
//   Bgm.start(fade) / Bgm.stop(fade)      — 게임 화면 배경음악 (sounds/bgm/*.mp3 를 무작위 순서로 이어 재생)
//   Bgm.toggle() / Bgm.isEnabled()        — 음악 켜기·끄기 (타이틀 배경음도 이 설정을 따른다)
// 브라우저는 첫 클릭/키 입력 전까지 소리를 막는데, howler가 그때 자동으로 오디오를 연다.
import { Howl, Howler } from 'howler';

// id: [기본 볼륨, 루프 여부]
const LIST = {
  fire_normal: [0.8], fire_heavy: [0.9], fire_triple: [0.8],
  shell_whistle: [0.35, true], charge_loop: [0.45, true],
  explode_small: [0.7], explode_normal: [0.85], explode_big: [1],
  dirt_debris: [0.45],
  tank_move: [0.5, true], tank_move_blocked: [0.6], barrel_aim: [0.4, true],
  tank_hit: [0.8], tank_destroyed: [1],
  game_win: [0.8], game_lose: [0.8],
  ui_click: [0.7], weapon_select: [0.7],
  loop1: [0.5, true], // 타이틀 화면 배경음 (게임 화면 배경음악은 아래 Bgm)
} satisfies Record<string, [number, boolean?]>;

export type SfxId = keyof typeof LIST;

export interface PlayOptions { volume?: number; rate?: number; pan?: number }
export interface LoopOptions { volume?: number; rate?: number; fade?: number }

const MAX_SAME = 3;
const FADE_MS = 120;

const ids = Object.keys(LIST) as SfxId[];
const baseVolume = (id: SfxId): number => LIST[id][0];
const howls = {} as Record<SfxId, Howl>;
const playing = {} as Record<SfxId, number[]>; // id -> 재생 중인 sound id 목록 (오래된 순)
const loops: Partial<Record<SfxId, { sid: number; vol: number }>> = {};

for (const id of ids) {
  const [volume, loop] = LIST[id] as [number, boolean?];
  howls[id] = new Howl({ src: [`sounds/${id}.wav`], volume, loop: !!loop, preload: true });
  playing[id] = [];
}

function play(id: SfxId, { volume = 1, rate = 1, pan = 0 }: PlayOptions = {}): number | null {
  const h = howls[id];
  if (!h) return null;
  const list = (playing[id] = playing[id].filter((s) => h.playing(s)));
  if (list.length >= MAX_SAME) h.stop(list.shift());
  const sid = h.play();
  h.volume(baseVolume(id) * volume, sid);
  if (rate !== 1) h.rate(rate, sid);
  if (pan) h.stereo(pan, sid);
  list.push(sid);
  return sid;
}

function loop(id: SfxId, on: boolean, { volume = 1, rate, fade = FADE_MS }: LoopOptions = {}): void {
  const h = howls[id];
  if (!h) return;
  const L = loops[id];
  if (on) {
    const vol = baseVolume(id) * volume;
    if (!L) {
      const sid = h.play();
      h.fade(0, vol, fade, sid);
      loops[id] = { sid, vol };
    } else if (Math.abs(L.vol - vol) > 0.01) {
      h.volume(vol, L.sid);
      L.vol = vol;
    }
    if (rate !== undefined) h.rate(rate, loops[id]!.sid);
  } else if (L) {
    // 짧게 페이드아웃 후 정지 (뚝 끊기지 않게)
    delete loops[id];
    h.fade(h.volume(L.sid) as number, 0, fade, L.sid);
    setTimeout(() => h.stop(L.sid), fade + 20);
  }
}

function stopLoops(): void {
  for (const id of Object.keys(loops) as SfxId[]) loop(id, false);
}

// 한 번 재생한 소리를 끝나기 전에 끊는다 (예: 결과 음악이 나오는 중에 다시 하기).
function stop(id: SfxId): void {
  howls[id]?.stop();
  if (playing[id]) playing[id] = [];
}

// 첫 사용자 입력 시 오디오 컨텍스트를 확실히 연다 (howler도 자동으로 열지만 한 번 더).
function unlock(): void {
  if (Howler.ctx?.state === 'suspended') void Howler.ctx.resume();
}

export const Sfx = { play, loop, stop, stopLoops, unlock };

// ── 게임 화면 배경음악 ─────────────────────────────────────────
// 시작할 때 무작위 곡부터 틀고, 곡이 끝나면 아직 안 들은 곡 중에서 다음 곡을 고른다.
// 모든 곡을 다 들으면 다시 섞는다 (방금 들은 곡이 바로 또 나오지 않게).
// 파일이 커서 html5 스트리밍으로, 처음 틀 때 불러온다.
const BGM_FILES = ['Ballade_No_1.mp3','Cool_Girls.mp3'];
const BGM_VOLUME = 0.1;

// 켜기/끄기 설정 (게임 화면 버튼·M 키). 브라우저에 저장해 새로고침해도 유지한다.
const BGM_PREF_KEY = 'fortress.bgm';
let bgmEnabled = ((): boolean => {
  try { return localStorage.getItem(BGM_PREF_KEY) !== 'off'; } catch { return true; }
})();
let bgmWanted = false; // 게임 화면이 음악을 원하는 동안 (start ~ stop)

const bgmHowls: Record<string, Howl> = {};
let bgmQueue: string[] = [];
let bgmLast: string | null = null;
// 지금 곡. id가 있어야 일시정지한 곡을 같은 자리에서 이어 틀 수 있다.
let bgmCur: { h: Howl; id: number } | null = null;

function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function bgmHowl(file: string): Howl {
  return (bgmHowls[file] ??= new Howl({
    src: [`sounds/bgm/${file}`], html5: true, volume: BGM_VOLUME,
    onend: (id) => { if (bgmCur?.id === id) bgmNext(0); },
  }));
}

function bgmNext(fade: number): void {
  if (bgmQueue.length === 0) {
    bgmQueue = shuffle([...BGM_FILES]);
    if (bgmQueue.length > 1 && bgmQueue[0] === bgmLast) bgmQueue.push(bgmQueue.shift()!);
  }
  const file = bgmQueue.shift()!;
  bgmLast = file;
  const h = bgmHowl(file);
  h.stop();
  const id = h.play();
  bgmCur = { h, id };
  h.volume(fade > 0 ? 0 : BGM_VOLUME, id);
  if (fade > 0) h.fade(0, BGM_VOLUME, fade, id);
}

function bgmStart(fade = 800): void {
  bgmWanted = true;
  if (!bgmEnabled || bgmCur) return; // 꺼져 있거나 이미 재생 중
  bgmQueue = []; // 게임마다 새로 섞어 무작위 곡부터
  bgmNext(fade);
}

function bgmStop(fade = 600): void {
  bgmWanted = false;
  const c = bgmCur;
  if (!c) return;
  bgmCur = null;
  c.h.fade(c.h.volume(c.id) as number, 0, fade, c.id);
  setTimeout(() => c.h.stop(c.id), fade + 20);
}

function bgmSetEnabled(on: boolean): void {
  if (on === bgmEnabled) return;
  bgmEnabled = on;
  try { localStorage.setItem(BGM_PREF_KEY, on ? 'on' : 'off'); } catch { /* 저장 못 해도 이번 접속 동안은 유지 */ }
  const c = bgmCur;
  if (!on) {
    // 페이드아웃 뒤 일시정지 (다시 켜면 같은 곡 같은 자리부터)
    if (c) {
      c.h.fade(c.h.volume(c.id) as number, 0, 400, c.id);
      setTimeout(() => { if (!bgmEnabled && bgmCur === c) c.h.pause(c.id); }, 420);
    }
    return;
  }
  if (!bgmWanted) return;
  if (c) {
    const fadeIn = () => { if (bgmEnabled && bgmCur === c) c.h.fade(c.h.volume(c.id) as number, BGM_VOLUME, 600, c.id); };
    if (c.h.playing(c.id)) {
      fadeIn(); // 꺼지는 페이드 도중에 다시 켠 경우
    } else {
      // 일시정지한 html5 오디오는 재생이 비동기로 시작되어, 바로 건 페이드가 먹지 않는다 → 재생이 시작된 뒤에 페이드
      c.h.once('play', fadeIn, c.id);
      c.h.play(c.id);
    }
  } else {
    bgmQueue = [];
    bgmNext(800);
  }
}

export const Bgm = {
  start: bgmStart,
  stop: bgmStop,
  isEnabled: (): boolean => bgmEnabled,
  setEnabled: bgmSetEnabled,
  toggle: (): boolean => { bgmSetEnabled(!bgmEnabled); return bgmEnabled; },
};
