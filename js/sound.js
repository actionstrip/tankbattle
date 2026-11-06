// 효과음 (howler.js). 목록과 재생 위치는 docs/sound-effects.md 참고.
//   Sfx.play(id, { volume, rate, pan })  — 한 번 재생. 같은 ID는 동시에 최대 MAX_SAME개.
//   Sfx.loop(id, on, { volume, rate })   — 루프 소리를 켜고 끈다. 매 프레임 불러도 된다.
//   Sfx.stopLoops()                      — 모든 루프 정지 (씬 종료 시)
// 브라우저는 첫 클릭/키 입력 전까지 소리를 막는데, howler가 그때 자동으로 오디오를 연다.
const Sfx = (() => {
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
  };
  const MAX_SAME = 3;
  const FADE_MS = 120;

  const howls = {};
  const playing = {}; // id -> 재생 중인 sound id 목록 (오래된 순)
  const loops = {};   // id -> { sid, vol }

  for (const [id, [volume, loop]] of Object.entries(LIST)) {
    howls[id] = new Howl({ src: [`sounds/${id}.wav`], volume, loop: !!loop, preload: true });
    playing[id] = [];
  }

  function play(id, { volume = 1, rate = 1, pan = 0 } = {}) {
    const h = howls[id];
    if (!h) return null;
    const list = (playing[id] = playing[id].filter((s) => h.playing(s)));
    if (list.length >= MAX_SAME) h.stop(list.shift());
    const sid = h.play();
    h.volume(LIST[id][0] * volume, sid);
    if (rate !== 1) h.rate(rate, sid);
    if (pan) h.stereo(pan, sid);
    list.push(sid);
    return sid;
  }

  function loop(id, on, { volume = 1, rate } = {}) {
    const h = howls[id];
    if (!h) return;
    const L = loops[id];
    if (on) {
      const vol = LIST[id][0] * volume;
      if (!L) {
        const sid = h.play();
        h.fade(0, vol, FADE_MS, sid);
        loops[id] = { sid, vol };
      } else if (Math.abs(L.vol - vol) > 0.01) {
        h.volume(vol, L.sid);
        L.vol = vol;
      }
      if (rate !== undefined) h.rate(rate, loops[id].sid);
    } else if (L) {
      // 짧게 페이드아웃 후 정지 (뚝 끊기지 않게)
      delete loops[id];
      h.fade(h.volume(L.sid), 0, FADE_MS, L.sid);
      setTimeout(() => h.stop(L.sid), FADE_MS + 20);
    }
  }

  function stopLoops() {
    for (const id of Object.keys(loops)) loop(id, false);
  }

  // 한 번 재생한 소리를 끝나기 전에 끊는다 (예: 결과 음악이 나오는 중에 다시 하기).
  function stop(id) {
    howls[id]?.stop();
    if (playing[id]) playing[id] = [];
  }

  return { play, loop, stop, stopLoops };
})();
