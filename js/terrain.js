// 파괴 가능한 땅 레이어.
// stage1_ground.png를 월드 폭에 맞춰 확대해 하단 정렬로 깔고, 알파값으로 충돌 마스크를 만든다.
// 포탄이 파낸 자리는 투명해져 화면에 고정된 배경이 그대로 보인다.
class Terrain {
  constructor(scene) {
    const T = CONFIG.TERRAIN;
    this.scene = scene;
    this.w = CONFIG.WORLD_W;
    this.h = CONFIG.WORLD_H;
    this.version = 0; // 모양이 바뀔 때마다 증가 (미니맵·디버그 갱신용)

    // 조각을 떼어 낼 때 getImageData를 자주 쓰므로 CPU 쪽 캔버스로 만든다.
    // (GPU 가속 캔버스는 읽을 때마다 수백 ms씩 걸릴 수 있다)
    if (scene.textures.exists('terrain')) scene.textures.remove('terrain');
    const canvas = document.createElement('canvas');
    canvas.width = this.w;
    canvas.height = this.h;
    this.ctx = canvas.getContext('2d', { willReadFrequently: true });
    this.texture = scene.textures.addCanvas('terrain', canvas);

    const src = scene.textures.get('ground').getSourceImage();
    const drawH = Math.round((src.height * this.w) / src.width);
    this.ctx.drawImage(src, 0, this.h - drawH, this.w, drawH);

    const n = this.w * this.h;
    this.solid = new Uint8Array(n);
    this.mark = new Uint8Array(n);
    this.queue = new Int32Array(n);

    const img = this.ctx.getImageData(0, 0, this.w, this.h);
    const d = img.data;
    for (let i = 0; i < n; i++) this.solid[i] = d[i * 4 + 3] >= T.ALPHA_SOLID ? 1 : 0;
    this.removeSpecks(img);
    this.ctx.putImageData(img, 0, 0);
    this.anchors = this.findAnchors();
    this.texture.refresh();

    scene.add.image(0, 0, 'terrain').setOrigin(0).setDepth(CONFIG.DEPTH.TERRAIN);
  }

  // ---- 질의 ----

  isSolid(x, y) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (ix < 0 || ix >= this.w || iy < 0 || iy >= this.h) return false;
    return this.solid[iy * this.w + ix] === 1;
  }

  // fromY부터 아래로 내려가며 처음 만나는 땅의 y. 없으면 null.
  surfaceY(x, fromY) {
    const ix = Math.floor(x);
    if (ix < 0 || ix >= this.w) return null;
    for (let y = Math.max(0, Math.floor(fromY)); y < this.h; y++) {
      if (this.solid[y * this.w + ix] === 1) return y;
    }
    return null;
  }

  // ---- 연결 요소 탐색 (4방향) ----

  // queue[0..tail)에 시드가 들어 있고 mark가 이미 찍혀 있어야 한다. 새 tail을 돌려준다.
  flood(tail) {
    const { w, solid, mark, queue } = this;
    const last = solid.length - w;
    let head = 0;
    const visit = (j) => {
      if (solid[j] === 1 && mark[j] === 0) {
        mark[j] = 1;
        queue[tail++] = j;
      }
    };
    while (head < tail) {
      const i = queue[head++];
      const x = i % w;
      if (x > 0) visit(i - 1);
      if (x < w - 1) visit(i + 1);
      if (i >= w) visit(i - w);
      if (i < last) visit(i + w);
    }
    return tail;
  }

  // 아직 mark되지 않은 땅 덩어리마다 fn(count, bbox)를 호출한다. 픽셀 목록은 queue[0..count).
  eachComponent(fn) {
    const { w, solid, mark, queue } = this;
    for (let i = 0; i < solid.length; i++) {
      if (solid[i] !== 1 || mark[i] !== 0) continue;
      mark[i] = 1;
      queue[0] = i;
      const count = this.flood(1);
      let minX = w;
      let minY = this.h;
      let maxX = 0;
      let maxY = 0;
      for (let k = 0; k < count; k++) {
        const p = queue[k];
        const x = p % w;
        const y = (p - x) / w;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      fn(count, { minX, minY, maxX, maxY });
    }
  }

  // 맨 아래 행과 고정점에서 시작해 연결된 땅을 mark한다.
  markAnchored() {
    const { w, h, solid, mark, queue } = this;
    mark.fill(0);
    let tail = 0;
    const seed = (i) => {
      if (solid[i] === 1 && mark[i] === 0) {
        mark[i] = 1;
        queue[tail++] = i;
      }
    };
    for (let x = 0; x < w; x++) seed((h - 1) * w + x);
    for (const a of this.anchors || []) {
      for (let y = Math.max(0, a.y - a.r); y <= Math.min(h - 1, a.y + a.r); y++) {
        for (let x = Math.max(0, a.x - a.r); x <= Math.min(w - 1, a.x + a.r); x++) {
          if ((x - a.x) ** 2 + (y - a.y) ** 2 <= a.r * a.r) seed(y * w + x);
        }
      }
    }
    this.flood(tail);
  }

  // ---- 로드 시 정리 ----

  // 원본 풀 외곽의 반투명 번짐과 작은 잡티를 지운다.
  removeSpecks(img) {
    const T = CONFIG.TERRAIN;
    const { w, h, solid, queue } = this;
    this.mark.fill(0);
    this.eachComponent((count) => {
      if (count < T.SPECK_MIN) for (let k = 0; k < count; k++) solid[queue[k]] = 0;
    });

    // 땅에서 FRINGE px 안쪽만 남긴다 (가로·세로 분리 팽창).
    const r = T.FRINGE;
    const horiz = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        if (solid[row + x] !== 1) continue;
        for (let dx = -r; dx <= r; dx++) {
          const nx = x + dx;
          if (nx >= 0 && nx < w) horiz[row + nx] = 1;
        }
      }
    }
    const d = img.data;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let near = 0;
        for (let dy = -r; dy <= r && !near; dy++) {
          const ny = y + dy;
          if (ny >= 0 && ny < h) near = horiz[ny * w + x];
        }
        if (!near) d[(y * w + x) * 4 + 3] = 0;
      }
    }
  }

  // 처음부터 떠 있는 섬마다 중심에 가장 가까운 픽셀에 고정점을 둔다.
  findAnchors() {
    const { w, queue } = this;
    const anchors = [];
    this.anchors = [];
    this.markAnchored();
    this.eachComponent((count, b) => {
      const cx = (b.minX + b.maxX) / 2;
      const cy = (b.minY + b.maxY) / 2;
      let best = queue[0];
      let bestD = Infinity;
      for (let k = 0; k < count; k++) {
        const p = queue[k];
        const x = p % w;
        const dd = (x - cx) ** 2 + ((p - x) / w - cy) ** 2;
        if (dd < bestD) { bestD = dd; best = p; }
      }
      anchors.push({ x: best % w, y: Math.floor(best / w), r: CONFIG.TERRAIN.ANCHOR_RADIUS });
    });
    return anchors;
  }

  // ---- 변형 ----

  carve(cx, cy, r) {
    const r2 = r * r;
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(this.w - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(this.h - 1, Math.ceil(cy + r));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r2) this.solid[y * this.w + x] = 0;
      }
    }

    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    // 남은 흙 가장자리에만 그을음을 입힌다.
    ctx.globalCompositeOperation = 'source-atop';
    const rim = r + 14;
    const grad = ctx.createRadialGradient(cx, cy, r, cx, cy, rim);
    grad.addColorStop(0, 'rgba(18, 9, 5, 0.85)');
    grad.addColorStop(1, 'rgba(18, 9, 5, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, rim, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    this.texture.refresh();
    this.version++;
  }
}
