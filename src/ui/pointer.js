// 把画布上的指针事件变成带时间的点。toWorld 把画布坐标（CSS 像素）换成纸面坐标。
// 一次只跟一支笔（第二根手指不算）；用合并事件取满采样点，笔迹更顺。
export function attachPen(canvas, { toWorld = p => p, onDown, onMove, onUp, onHover } = {}) {
  let active = null;
  const pos = e => {
    const r = canvas.getBoundingClientRect();
    return toWorld({ x: e.clientX - r.left, y: e.clientY - r.top });
  };
  canvas.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (active !== null) return;
    active = e.pointerId;
    try { canvas.setPointerCapture(e.pointerId); } catch {}
    e.preventDefault();
    onDown?.(pos(e), performance.now(), e);
  });
  canvas.addEventListener('pointermove', e => {
    if (e.pointerId !== active) { onHover?.(pos(e), e); return; }
    const list = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
    for (const ce of list.length ? list : [e]) onMove?.(pos(ce), performance.now(), ce);
  });
  const end = e => {
    if (e.pointerId !== active) return;
    active = null;
    onUp?.(pos(e), performance.now(), e);
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('contextmenu', e => e.preventDefault());
}
