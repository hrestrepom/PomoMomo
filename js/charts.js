/* ==========================================================================
   PomoMomo — Gráficas en canvas
   Minimalistas, retina-aware y con la paleta del sistema.
   ========================================================================== */

const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif';

const C = {
  ink:    '#1D1D1F',
  label:  '#6E6E73',
  faint:  '#8E8E93',
  grid:   'rgba(60,60,67,.10)',
  gridStrong: 'rgba(60,60,67,.20)',
  surface:'#FFFFFF',
  blue:   '#007AFF',
  green:  '#34C759',
  orange: '#FF9500',
  red:    '#FF3B30',
  purple: '#AF52DE',
  gray:   '#C7C7CC',
  teal:   '#30B0C7'
};

/* ---------- Preparación del lienzo ---------- */
function setup(canvas, height) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const W = canvas.parentElement.clientWidth || 600;
  const H = height;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  return { ctx, W, H };
}

/* Ticks "bonitos" para el eje Y */
function niceTicks(max, count = 4) {
  if (max <= 0) return [0, 1];
  const raw = max / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  const top = Math.ceil(max / step) * step;
  const out = [];
  for (let v = 0; v <= top + 1e-9; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/* ==========================================================================
   Burndown
   data = { labels[], ideal[], actual[] (puede tener null tras hoy), todayIdx }
   ========================================================================== */
export function burndown(canvas, { labels, ideal, actual, todayIdx = -1 }, height = 300) {
  const { ctx, W, H } = setup(canvas, height);
  const pad = { t: 16, r: 14, b: 30, l: 38 };
  const w = W - pad.l - pad.r;
  const h = H - pad.t - pad.b;
  const n = labels.length;
  if (n < 2 || w <= 0) return;

  const maxV = Math.max(...ideal, ...actual.filter(v => v != null), 1);
  const ticks = niceTicks(maxV, 4);
  const top = ticks[ticks.length - 1];

  const X = (i) => pad.l + (i / (n - 1)) * w;
  const Y = (v) => pad.t + h - (v / top) * h;

  /* Rejilla horizontal + etiquetas Y */
  ctx.font = `500 10.5px ${FONT}`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ticks.forEach(v => {
    const y = Y(v);
    ctx.strokeStyle = v === 0 ? C.gridStrong : C.grid;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pad.l, y + .5); ctx.lineTo(pad.l + w, y + .5); ctx.stroke();
    ctx.fillStyle = C.faint;
    ctx.fillText(String(v), pad.l - 8, y);
  });

  /* Etiquetas X */
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const step = Math.max(1, Math.ceil(n / 7));
  labels.forEach((lb, i) => {
    if (i % step === 0 || i === n - 1) {
      ctx.fillStyle = C.faint;
      ctx.fillText(lb, X(i), pad.t + h + 9);
    }
  });

  /* Marca de hoy */
  if (todayIdx >= 0 && todayIdx < n) {
    ctx.save();
    ctx.strokeStyle = 'rgba(60,60,67,.22)';
    ctx.setLineDash([3, 4]);
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(X(todayIdx), pad.t); ctx.lineTo(X(todayIdx), pad.t + h); ctx.stroke();
    ctx.restore();
  }

  /* Línea ideal (punteada) */
  ctx.save();
  ctx.strokeStyle = C.gray;
  ctx.lineWidth = 1.8;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ideal.forEach((v, i) => i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v)));
  ctx.stroke();
  ctx.restore();

  /* Serie real */
  const pts = actual.map((v, i) => (v == null ? null : [X(i), Y(v)])).filter(Boolean);
  if (pts.length) {
    // Relleno degradado
    const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + h);
    grad.addColorStop(0, 'rgba(0,122,255,.16)');
    grad.addColorStop(1, 'rgba(0,122,255,.01)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    ctx.lineTo(pts[pts.length - 1][0], pad.t + h);
    ctx.lineTo(pts[0][0], pad.t + h);
    ctx.closePath(); ctx.fill();

    // Línea
    ctx.strokeStyle = C.blue;
    ctx.lineWidth = 2.4;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.beginPath();
    pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    ctx.stroke();

    // Punto final destacado
    const [lx, ly] = pts[pts.length - 1];
    ctx.fillStyle = C.surface;
    ctx.beginPath(); ctx.arc(lx, ly, 5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = C.blue; ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.arc(lx, ly, 5, 0, Math.PI * 2); ctx.stroke();
  }
}

/* ==========================================================================
   Donut
   segments = [{ label, value, color }]
   ========================================================================== */
export function donut(canvas, segments, height = 200, centerLabel = '', centerSub = '') {
  const { ctx, W, H } = setup(canvas, height);
  const total = segments.reduce((s, x) => s + x.value, 0);
  const cx = W / 2, cy = H / 2;
  const R = Math.min(W, H) / 2 - 6;
  const thick = Math.max(14, R * 0.34);

  if (total <= 0) {
    ctx.strokeStyle = 'rgba(60,60,67,.10)';
    ctx.lineWidth = thick;
    ctx.beginPath(); ctx.arc(cx, cy, R - thick / 2, 0, Math.PI * 2); ctx.stroke();
  } else {
    let a0 = -Math.PI / 2;
    segments.forEach(s => {
      if (s.value <= 0) return;
      const a1 = a0 + (s.value / total) * Math.PI * 2;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = thick;
      ctx.lineCap = 'butt';
      ctx.beginPath();
      ctx.arc(cx, cy, R - thick / 2, a0, a1);
      ctx.stroke();
      a0 = a1;
    });
  }

  if (centerLabel) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = C.ink;
    ctx.font = `680 ${Math.round(R * 0.42)}px ${FONT}`;
    ctx.fillText(centerLabel, cx, cy + (centerSub ? 2 : R * 0.14));
    if (centerSub) {
      ctx.fillStyle = C.faint;
      ctx.font = `500 11px ${FONT}`;
      ctx.fillText(centerSub, cx, cy + 17);
    }
  }
}

/* ==========================================================================
   Barras verticales
   data = { labels[], values[], color?, colors?[] }
   ========================================================================== */
export function bars(canvas, { labels, values, color = C.blue, colors = null, suffix = '' }, height = 220) {
  const { ctx, W, H } = setup(canvas, height);
  const pad = { t: 18, r: 10, b: 28, l: 32 };
  const w = W - pad.l - pad.r;
  const h = H - pad.t - pad.b;
  const n = values.length;
  if (!n || w <= 0) return;

  const maxV = Math.max(...values, 1);
  const ticks = niceTicks(maxV, 3);
  const top = ticks[ticks.length - 1];

  ctx.font = `500 10.5px ${FONT}`;
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  ticks.forEach(v => {
    const y = pad.t + h - (v / top) * h;
    ctx.strokeStyle = v === 0 ? C.gridStrong : C.grid;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pad.l, y + .5); ctx.lineTo(pad.l + w, y + .5); ctx.stroke();
    ctx.fillStyle = C.faint;
    ctx.fillText(String(v), pad.l - 7, y);
  });

  const slot = w / n;
  const bw = Math.min(30, Math.max(6, slot * 0.56));

  values.forEach((v, i) => {
    const x = pad.l + slot * i + (slot - bw) / 2;
    const bh = Math.max(v > 0 ? 3 : 0, (v / top) * h);
    const y = pad.t + h - bh;
    ctx.fillStyle = colors ? colors[i] : color;
    roundRect(ctx, x, y, bw, bh, Math.min(4, bw / 2));
    ctx.fill();

    if (n <= 12 && v > 0) {
      ctx.fillStyle = C.label;
      ctx.font = `600 10px ${FONT}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText(v + suffix, x + bw / 2, y - 3);
    }
  });

  ctx.fillStyle = C.faint;
  ctx.font = `500 10.5px ${FONT}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  const step = Math.max(1, Math.ceil(n / 10));
  labels.forEach((lb, i) => {
    if (i % step === 0 || i === n - 1) ctx.fillText(lb, pad.l + slot * i + slot / 2, pad.t + h + 8);
  });
}

/* ==========================================================================
   Área acumulada (throughput / trabajo completado)
   ========================================================================== */
export function area(canvas, { labels, values, color = C.green }, height = 180) {
  const { ctx, W, H } = setup(canvas, height);
  const pad = { t: 14, r: 12, b: 26, l: 32 };
  const w = W - pad.l - pad.r;
  const h = H - pad.t - pad.b;
  const n = values.length;
  if (n < 2 || w <= 0) return;

  const maxV = Math.max(...values, 1);
  const ticks = niceTicks(maxV, 3);
  const top = ticks[ticks.length - 1];
  const X = (i) => pad.l + (i / (n - 1)) * w;
  const Y = (v) => pad.t + h - (v / top) * h;

  ctx.font = `500 10.5px ${FONT}`;
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  ticks.forEach(v => {
    const y = Y(v);
    ctx.strokeStyle = v === 0 ? C.gridStrong : C.grid;
    ctx.beginPath(); ctx.moveTo(pad.l, y + .5); ctx.lineTo(pad.l + w, y + .5); ctx.stroke();
    ctx.fillStyle = C.faint; ctx.fillText(String(v), pad.l - 7, y);
  });

  const rgb = hexToRgb(color);
  const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + h);
  grad.addColorStop(0, `rgba(${rgb},.22)`);
  grad.addColorStop(1, `rgba(${rgb},.01)`);
  ctx.fillStyle = grad;
  ctx.beginPath();
  values.forEach((v, i) => i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v)));
  ctx.lineTo(X(n - 1), pad.t + h); ctx.lineTo(X(0), pad.t + h);
  ctx.closePath(); ctx.fill();

  ctx.strokeStyle = color;
  ctx.lineWidth = 2.2; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.beginPath();
  values.forEach((v, i) => i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v)));
  ctx.stroke();

  ctx.fillStyle = C.faint;
  ctx.font = `500 10.5px ${FONT}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  const step = Math.max(1, Math.ceil(n / 7));
  labels.forEach((lb, i) => {
    if (i % step === 0 || i === n - 1) ctx.fillText(lb, X(i), pad.t + h + 8);
  });
}

function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return m ? `${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)}` : '0,122,255';
}

export const CHART_COLORS = C;
