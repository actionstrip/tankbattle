// 고정점과 끊겨 떨어지는 땅 조각. 회전 없이 떨어지다가 아래 땅에 닿으면 지형에 다시 합쳐진다.
let chunkSeq = 0;

class FallingChunk {
  constructor(scene, terrain, piece) {
    this.scene = scene;
    this.terrain = terrain;
    this.x = piece.x;
    this.y = piece.y;
    this.w = piece.w;
    this.h = piece.h;
    this.mask = piece.mask;
    this.vy = 0;
    this.done = false;
    this.crushed = new Set();

    this.canvas = document.createElement('canvas');
    this.canvas.width = this.w;
    this.canvas.height = this.h;
    this.canvas.getContext('2d').putImageData(piece.imageData, 0, 0);
    this.key = `chunk_${chunkSeq++}`;
    scene.textures.addCanvas(this.key, this.canvas);
    this.image = scene.add.image(this.x, this.y, this.key).setOrigin(0).setDepth(CONFIG.DEPTH.TERRAIN);

    // 아래쪽 가장자리 픽셀만 착지 검사에 쓴다.
    this.edges = [];
    for (let r = 0; r < this.h; r++) {
      for (let c = 0; c < this.w; c++) {
        if (this.mask[r * this.w + c] && (r === this.h - 1 || !this.mask[(r + 1) * this.w + c])) {
          this.edges.push(c, r);
        }
      }
    }
  }

  blockedBelow() {
    for (let k = 0; k < this.edges.length; k += 2) {
      if (this.terrain.isSolid(this.x + this.edges[k], this.y + this.edges[k + 1] + 1)) return true;
    }
    return false;
  }

  covers(wx, wy) {
    const lx = Math.floor(wx - this.x);
    const ly = Math.floor(wy - this.y);
    if (lx < 0 || lx >= this.w || ly < 0 || ly >= this.h) return false;
    return this.mask[ly * this.w + lx] === 1;
  }

  update(dt, tanks) {
    if (this.done) return;
    this.vy += CONFIG.PHYSICS.GRAVITY * dt;
    let px = Math.max(1, Math.round(this.vy * dt));
    while (px-- > 0) {
      if (this.blockedBelow()) {
        this.land(tanks);
        return;
      }
      this.y += 1;
      if (this.y >= CONFIG.WORLD_H) {
        this.destroy();
        return;
      }
    }
    this.image.y = this.y;
    this.checkCrush(tanks);
  }

  checkCrush(tanks) {
    const T = CONFIG.TERRAIN;
    for (const t of tanks) {
      if (t.dead || this.crushed.has(t)) continue;
      if (this.covers(t.x, t.y - 8) || this.covers(t.x, t.y - CONFIG.TANK.HIT_CENTER_Y)) {
        this.crushed.add(t);
        t.damage(Math.min(T.CRUSH_MAX, Math.max(5, Math.round(this.vy * T.CRUSH_FACTOR))));
      }
    }
  }

  land(tanks) {
    this.terrain.stamp(this);
    for (const t of tanks) if (!t.dead) t.unstick();
    this.destroy();
  }

  destroy() {
    this.done = true;
    this.image.destroy();
    this.scene.textures.remove(this.key);
  }
}
