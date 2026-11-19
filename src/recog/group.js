// 符圈：墨笔落下，周围浮出一个淡淡的圈，圈里的笔画算同一个符。
//   - 停笔约 0.45 秒就收笔去认；会按你自己的落笔节奏放宽，最多 0.9 秒。
//   - 在圈上或圈外点一下：立刻收笔（这一点不算笔画）。圈里点一下是「点」（比如日中间那一点）。
//   - 在圈外起笔：旧圈立刻收笔，新笔开一个新圈。
//   - 圈按已写笔画外接框的半对角线放大 grow 倍（默认 2）再加 pad：先写树干、紧接着写树冠时，
//     树冠的起笔还在圈里（按 1 倍算，快写时 280 像素大的符有 23% 被切成两半；2 倍约 1%）。
// 只管分组和计时，不画、不认；时间 t 由调用方给（毫秒），测试里可以用假时钟。

export class InkGrouper {
  constructor({ pause = 450, maxPause = 900, pad = 26, minRadius = 42, tapLen = 7, tapMs = 260, grow = 2 } = {}) {
    Object.assign(this, { basePause: pause, maxPause, pad, minRadius, tapLen, tapMs, grow });
    this.gaps = [];
    this.group = null;
    this.cur = null;
  }

  // 停笔多久算写完：0.45 秒起，若你笔画间常停得久，放宽到你中位间隔的 2.2 倍（不超过 0.9 秒）
  get pause() {
    if (this.gaps.length < 4) return this.basePause;
    const g = [...this.gaps].sort((a, b) => a - b), med = g[g.length >> 1];
    return Math.max(this.basePause, Math.min(this.maxPause, med * 2.2));
  }

  get drawing() { return !!this.cur; }

  ring() {
    const g = this.group;
    if (!g) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const s of g.strokes) for (const p of s) {
      if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
      if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
    }
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    return { cx, cy, r: Math.max(this.minRadius, Math.hypot(x1 - x0, y1 - y0) / 2 * this.grow + this.pad) };
  }

  inside(p) {
    const r = this.ring();
    return !!r && Math.hypot(p.x - r.cx, p.y - r.cy) <= r.r - 6;
  }

  // 落笔。在圈外（含圈线上）落笔，旧圈立刻收笔并返回
  down(p, t) {
    let closed = null;
    if (this.group) {
      if (this.inside(p)) {
        this.gaps.push(t - this.group.lastUp);
        if (this.gaps.length > 20) this.gaps.shift();
      } else closed = this.close();
    }
    if (!this.group) this.group = { strokes: [], t0: t, lastUp: t, opener: !!closed };
    this.cur = [{ x: p.x, y: p.y, t }];
    this.group.strokes.push(this.cur);
    this.downAt = t;
    return closed;
  }

  move(p, t) {
    if (this.cur) this.cur.push({ x: p.x, y: p.y, t });
  }

  // 抬笔。圈外点一下只为收笔：这一点丢掉，返回 { tapped: true }
  up(t) {
    const g = this.group, s = this.cur;
    this.cur = null;
    if (!g || !s) return {};
    g.lastUp = t;
    let len = 0;
    for (let i = 1; i < s.length; i++) len += Math.hypot(s[i].x - s[i - 1].x, s[i].y - s[i - 1].y);
    const isTap = len < this.tapLen && t - this.downAt < this.tapMs;
    if (isTap && g.strokes.length === 1 && g.opener) {
      this.group = null;
      return { tapped: true };
    }
    return {};
  }

  // 每帧调用：停笔够久就收笔，返回收好的圈
  tick(t) {
    if (!this.group || this.cur) return null;
    return t - this.group.lastUp >= this.pause ? this.close() : null;
  }

  // 收笔进度 0..1（给符圈画倒计时用）
  progress(t) {
    if (!this.group || this.cur) return 0;
    return Math.min(1, (t - this.group.lastUp) / this.pause);
  }

  close() {
    const g = this.group;
    this.group = null;
    this.cur = null;
    if (!g) return null;
    const strokes = g.strokes.filter(s => s.length);
    return strokes.length ? { strokes, t0: g.t0, t1: g.lastUp } : null;
  }

  cancel() { this.group = null; this.cur = null; }
}
