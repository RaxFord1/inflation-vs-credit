/*
 * Reusable SVG chart primitives — extracted from app.js to eliminate
 * duplication across the seven chart renderers. Every chart shares the same
 * grid/axis/label/hover patterns; the differences live in the data prep and
 * tooltip content, which stay in app.js as callbacks.
 */

const $ = (id) => document.getElementById(id);

const SVG_NS = 'http://www.w3.org/2000/svg';
function el(name, attrs, parent) {
  const n = document.createElementNS(SVG_NS, name);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(n);
  return n;
}

function niceTicks(min, max, count = 5) {
  const span = max - min || 1;
  const step0 = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) || 10 * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(v);
  return { lo, hi, ticks };
}

/** Push apart overlapping labels (sorted by y). Mutates in place. */
function pushApartLabels(labels, minGap = 14, passes = 8) {
  for (let pass = 0; pass < passes; pass++) {
    for (let k = 1; k < labels.length; k++) {
      if (labels[k].y - labels[k - 1].y < minGap) {
        labels[k - 1].y -= 2;
        labels[k].y += 2;
      }
    }
  }
}

/** Position a tooltip near the cursor, flipping when it would overflow. */
function positionTooltip(tip, ev) {
  const tw = tip.offsetWidth, th = tip.offsetHeight;
  let tx = ev.clientX + 14, ty = ev.clientY + 14;
  if (tx + tw > window.innerWidth - 8) tx = ev.clientX - tw - 14;
  if (ty + th > window.innerHeight - 8) ty = ev.clientY - th - 14;
  tip.style.left = tx + 'px';
  tip.style.top = ty + 'px';
}

/** Draw horizontal gridlines with tick labels. */
function drawGrid(svg, ticks, m, iw, y, fmtTick) {
  for (const t of ticks) {
    el('line', { class: 'gridline', x1: m.l, x2: m.l + iw, y1: y(t), y2: y(t) }, svg);
    el('text', { x: m.l - 6, y: y(t) + 3, 'text-anchor': 'end' }, svg).textContent = fmtTick(t);
  }
}

/** Draw year labels along the x-axis. yPos overrides the default baseline
 * (H - 8) — charts with an x-axis title pass m.t + ih + 16 to leave room. */
function drawYearLabels(svg, months, x, H, startAt, yPos) {
  const years = months / 12;
  const yearStep = years > 20 ? 5 : years > 10 ? 2 : 1;
  for (let yr = startAt || 0; yr <= years; yr += yearStep) {
    el('text', { x: x(yr * 12), y: yPos || (H - 8), 'text-anchor': 'middle' }, svg).textContent = yr + 'y';
  }
}

/* Axis captions: the y-axis unit sits above the plot at the top-left, the
 * x-axis meaning is centered under the tick labels. Charts reserve room via
 * margins (~26px top, ~40px bottom). */
function axisTitles(svg, W, H, m, xTitle, yTitle) {
  if (yTitle) el('text', { class: 'axis-title', x: 6, y: 12 }, svg).textContent = yTitle;
  if (xTitle) {
    el('text', {
      class: 'axis-title', x: m.l + (W - m.l - m.r) / 2, y: H - 4, 'text-anchor': 'middle',
    }, svg).textContent = xTitle;
  }
}

/* Vertical dashed marker for a key event (loan paid off, break-even…).
 * slot staggers labels vertically so neighbouring markers don't overlap. */
function drawEventLine(svg, px, m, iw, ih, label, slot) {
  el('line', { class: 'nowline', x1: px, x2: px, y1: m.t, y2: m.t + ih }, svg);
  const flip = px > m.l + iw * 0.72; // near the right edge — label to the left
  el('text', {
    class: 'event-label', x: px + (flip ? -5 : 5), y: m.t + 11 + (slot % 3) * 12,
    'text-anchor': flip ? 'end' : 'start',
  }, svg).textContent = label;
}

/**
 * Draw series end-labels, pushed apart to avoid collisions.
 * items: [{ i, y, text }] — i indexes into colors.
 */
function drawEndLabels(svg, items, colors, m, iw) {
  items.sort((a, b) => a.y - b.y);
  pushApartLabels(items);
  for (const L of items) {
    const tEl = el('text', { x: m.l + iw + 6, y: L.y + 4, 'font-weight': 600 }, svg);
    tEl.style.fill = colors[L.i];
    tEl.textContent = L.text;
  }
}

/**
 * Add crosshair + dots + tooltip hover layer to an SVG chart.
 * onMove(px) returns { cx, dots:[{cx,cy}], html } or null to skip.
 */
function addChartHover({ svg, W, m, iw, ih, nDots, colors, onMove }) {
  const cross = el('line', { class: 'crosshair', y1: m.t, y2: m.t + ih, visibility: 'hidden' }, svg);
  const dots = Array.from({ length: nDots }, (_, i) =>
    el('circle', { class: 'hoverdot', r: 4, fill: colors[i], visibility: 'hidden' }, svg));
  const hit = el('rect', { x: m.l, y: m.t, width: iw, height: ih, fill: 'transparent' }, svg);
  const tip = $('tooltip');

  hit.addEventListener('mousemove', (ev) => {
    const box = svg.getBoundingClientRect();
    const px = ((ev.clientX - box.left) / box.width) * W;
    const result = onMove(px);
    if (!result) return;
    cross.setAttribute('x1', result.cx);
    cross.setAttribute('x2', result.cx);
    cross.setAttribute('visibility', 'visible');
    result.dots.forEach((pos, i) => {
      dots[i].setAttribute('cx', pos.cx);
      dots[i].setAttribute('cy', pos.cy);
      dots[i].setAttribute('visibility', 'visible');
    });
    tip.innerHTML = result.html;
    tip.hidden = false;
    positionTooltip(tip, ev);
  });
  hit.addEventListener('mouseleave', () => {
    tip.hidden = true;
    cross.setAttribute('visibility', 'hidden');
    dots.forEach((d) => d.setAttribute('visibility', 'hidden'));
  });
}

/** Debounce via requestAnimationFrame — batches rapid input events. */
function rafDebounce(fn) {
  let id;
  return function () { cancelAnimationFrame(id); id = requestAnimationFrame(fn); };
}
