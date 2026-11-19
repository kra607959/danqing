// 铅笔图纸：蓝底白线，照提示一部分一部分画，每步量一次，最后照图建造。
import { BlueprintSession, BLUEPRINTS } from '../recog/blueprint.js';
import { fitCanvas, pencilStroke } from '../ui/ink.js';
import { attachPen } from '../ui/pointer.js';

export function openSheet(root, { onBuilt, onClose, start = 'shack', ids = ['shack', 'pad'], buildLabel = '照图建造' } = {}) {
  root.hidden = false;
  root.innerHTML = `<div class="box" role="dialog" aria-label="图纸">
    <div><div class="row" style="margin-bottom:8px"><b style="font-family:var(--serif);font-size:16px">图纸</b>
      ${ids.map(id => `<button data-bp="${id}">${BLUEPRINTS[id].name}${BLUEPRINTS[id].demo ? ` · ${BLUEPRINTS[id].era}` : ''}</button>`).join('')}</div>
      <canvas id="bpc"></canvas></div>
    <div class="steps"><div id="bpSteps"></div><div id="bpMsg" class="small"></div><div id="bpStats" class="statbar"></div>
      <div class="row"><button id="bpRedo">重画这一步</button><button id="bpSkip" hidden>跳过</button><button id="bpNext" class="primary">这一步画好了 <kbd>Enter</kbd></button></div>
      <div class="row"><button id="bpBuild" class="primary" hidden>${buildLabel}</button><button id="bpClose">收起 <kbd>Esc</kbd></button></div>
      <p class="small muted">不做分类：目标已知，只量这一部分画得多高、多直、接没接上。画歪了不会废，画得好数值更高。</p></div></div>`;
  const cv = root.querySelector('#bpc');
  let S, cur = [], drawing = null, msg = '', ok = null, alive = true, cw = 1;
  const pick = id => { S = new BlueprintSession(id); cur = []; msg = ''; ok = null; render(); };

  const next = () => {
    if (!S.step) return;
    const res = S.submit(cur);
    msg = res.msg; ok = res.ok;
    if (res.ok) cur = [];
    render();
  };
  root.querySelectorAll('[data-bp]').forEach(b => (b.onclick = () => pick(b.dataset.bp)));
  root.querySelector('#bpNext').onclick = next;
  root.querySelector('#bpRedo').onclick = () => { cur = []; msg = ''; ok = null; render(); };
  root.querySelector('#bpSkip').onclick = () => { S.skip(); cur = []; render(); };
  root.querySelector('#bpBuild').onclick = () => { onBuilt?.(S); close(); };
  root.querySelector('#bpClose').onclick = () => close();
  const key = e => {
    if (e.key === 'Enter') { e.preventDefault(); next(); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Backspace') { e.preventDefault(); cur.pop(); }
    e.stopPropagation();
  };
  addEventListener('keydown', key, true);
  function close() { alive = false; root.hidden = true; root.innerHTML = ''; removeEventListener('keydown', key, true); onClose?.(); }

  attachPen(cv, {
    toWorld: p => ({ x: p.x / cw, y: p.y / cw }),
    onDown(p, t) { drawing = [{ ...p, t }]; cur.push(drawing); },
    onMove(p, t) { drawing?.push({ ...p, t }); },
    onUp() { drawing = null; },
  });

  function render() {
    const st = S.step;
    root.querySelector('#bpSteps').innerHTML = `<div style="font-family:var(--serif);font-size:16px">${S.bp.name} <span class="muted small">${S.bp.era} · 耗 ${S.bp.cost}</span></div>${S.bp.blurb ? `<div class="small muted">${S.bp.blurb}</div>` : ''}<ol>${S.bp.steps.map((x, i) =>
      `<li class="${i < S.i ? 'done' : i === S.i ? 'now' : ''}">${x.prompt}${i < S.i ? ` — ${S.parts[x.id].msg}` : ''}</li>`).join('')}</ol>`;
    root.querySelector('#bpMsg').innerHTML = msg ? `<span class="${ok ? 'pass' : 'fail'}">${ok ? '量好了：' : '没过：'}${msg}</span>` : (st ? '照淡影画，画好点「这一步画好了」。' : '图纸画完了。');
    const stats = S.stats();
    root.querySelector('#bpStats').innerHTML = stats.map(x => `<span>${x.k}</span>${x.x == null ? '<span></span>' : `<div class="meter" title="${x.why}"><i style="width:${Math.round(x.x * 100)}%"></i></div>`}<span>${x.v || (x.x == null ? '' : Math.round(x.x * 100) + '%')}</span>`).join('');
    root.querySelector('#bpSkip').hidden = !st?.optional;
    root.querySelector('#bpNext').disabled = !st;
    root.querySelector('#bpBuild').hidden = !!st;
    root.querySelector('#bpBuild').textContent = S.bp.place === 'line' ? '照图修：回地图用铅笔画走向' : buildLabel;
    root.querySelectorAll('[data-bp]').forEach(b => b.classList.toggle('primary', b.dataset.bp === S.bp.id));
  }

  function frame() {
    if (!alive) return;
    const { ctx, w, h } = fitCanvas(cv);
    cw = w;
    ctx.fillStyle = '#1d4c8a';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(160,190,235,0.22)';
    ctx.lineWidth = 0.6;
    for (let x = 0; x <= w; x += w / 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    for (let y = 0; y <= h; y += w / 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    const px = s => s.map(p => ({ x: p.x * w, y: p.y * w }));
    // 已量好的部分：白线；当前这一步：提示淡影 + 正在画的
    for (const [id, strokes] of Object.entries(S.strokes)) for (const s of strokes) pencilStroke(ctx, px(s), { color: '#eef4ff', width: 2, alpha: 0.95 });
    if (S.step) {
      ctx.save();
      for (const s of S.step.ghost) pencilStroke(ctx, px(s), { color: '#9cc0ee', width: 1.4, alpha: 0.55, dash: [5, 6] });
      ctx.restore();
    }
    for (const s of cur) pencilStroke(ctx, px(s), { color: '#ffffff', width: 2.2 });
    ctx.fillStyle = 'rgba(220,235,255,0.75)';
    ctx.font = '13px system-ui, "Microsoft YaHei", sans-serif';
    ctx.fillText(S.step ? `第 ${S.i + 1} 步：${S.step.prompt}` : `${S.bp.name}：图纸画完了`, 12, 22);
    requestAnimationFrame(frame);
  }
  pick(start);
  requestAnimationFrame(frame);
  return { close };
}
