// 효과음 (howler.js). 목록과 재생 위치는 docs/sound-effects.md 참고.
//   Sfx.play(id, { volume, rate, pan })  — 한 번 재생. 같은 ID는 동시에 최대 MAX_SAME개.
//   Sfx.loop(id, on, { volume, rate, fade }) — 루프 소리를 켜고 끈다. 매 프레임 불러도 된다. fade = 페이드 ms
//   Sfx.stopLoops()                      — 모든 루프 정지 (씬 종료 시)
//   Bgm.start(fade) / Bgm.stop(fade)      — 게임 화면 배경음악 (sounds/bgm/*.mp3 를 무작위 순서로 이어 재생)
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

const bgmHowls: Record<string, Howl> = {};
let bgmQueue: string[] = [];
let bgmLast: string | null = null;
let bgmCur: Howl | null = null;

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
    onend: () => { if (bgmCur === bgmHowls[file]) bgmNext(0); },
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
  bgmCur = h;
  h.stop();
  h.volume(fade > 0 ? 0 : BGM_VOLUME);
  h.play();
  if (fade > 0) h.fade(0, BGM_VOLUME, fade);
}

function bgmStart(fade = 800): void {
  if (bgmCur) return; // 이미 재생 중
  bgmQueue = []; // 게임마다 새로 섞어 무작위 곡부터
  bgmNext(fade);
}

function bgmStop(fade = 600): void {
  const h = bgmCur;
  if (!h) return;
  bgmCur = null;
  h.fade(h.volume() as number, 0, fade);
  setTimeout(() => { if (bgmCur !== h) h.stop(); }, fade + 20);
}

export const Bgm = { start: bgmStart, stop: bgmStop };
