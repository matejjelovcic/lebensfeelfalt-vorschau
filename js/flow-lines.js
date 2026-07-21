/* PATRICKS WELT — drifting ellipse field behind the hero.
   Not fixed contour lines: a set of ellipse outlines that wander across the whole
   frame, continuously morph their own shape, and — the part that sells it — visibly
   DEFORM TOWARD EACH OTHER when two of them come close, then relax again once they
   separate. They drift off one edge and re-enter from the other, so the field never
   settles and never repeats.

   Stroke only, no fills. It parks the moment the hero leaves the screen. */
(function flowLines() {
  const canvas = document.getElementById('flowLines');
  const hero = document.querySelector('.hero');
  if (!canvas || !hero) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const ctx = canvas.getContext('2d');
  let w = 0, h = 0, dpr = 1;

  const rnd = (a, b) => a + Math.random() * (b - a);
  const TAU = Math.PI * 2;

  // ellipses in normalised space; radii are fractions of the short edge
  /* Weather-map dynamics: these travel with real pace, spin, and keep changing
     shape — they are not a slow ambient drift. Speeds are ~6x the earlier pass. */
  const N = 11;
  const E = Array.from({ length: N }, (_, i) => ({
    x: rnd(-0.15, 1.15), y: rnd(-0.15, 1.15),
    vx: (rnd(0.06, 0.15)) * (Math.random() < 0.5 ? -1 : 1),
    vy: (rnd(0.04, 0.11)) * (Math.random() < 0.5 ? -1 : 1),
    rx: rnd(0.18, 0.46), ry: rnd(0.10, 0.30),      // properly elliptical, not circles
    rot: rnd(0, TAU), vrot: rnd(-0.5, 0.5),        // they visibly rotate
    px: rnd(1.1, 2.6), py: rnd(1.1, 2.6), ph: rnd(0, TAU),
    // each one also changes pace, speeding up and easing off again
    pace: rnd(0.5, 1.6), pacePh: rnd(0, TAU),
    warp: 0, ax: 0, ay: 0,
    seed: i * 2.7
  }));

  function size() {
    const r = hero.getBoundingClientRect();
    w = Math.max(1, Math.round(r.width));
    h = Math.max(1, Math.round(r.height));
    dpr = Math.min(devicePixelRatio || 1, 1.75);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  const STEPS = 72;

  function step(dt, t) {
    const unit = Math.min(w, h);

    for (const e of E) {
      // pace surges and eases, so nothing moves at a constant machine speed
      const pace = 0.55 + 0.9 * (0.5 + 0.5 * Math.sin(t * e.pace + e.pacePh));
      e.x += e.vx * dt * pace;
      e.y += e.vy * dt * pace;
      e.rot += e.vrot * dt * pace;
      // leave the frame on one side, re-enter from the other
      if (e.x < -0.45) e.x = 1.45;
      if (e.x > 1.45) e.x = -0.45;
      if (e.y < -0.45) e.y = 1.45;
      if (e.y > 1.45) e.y = -0.45;
      e.warp *= 0.93;                          // relax back toward its own shape
    }

    // proximity: the closer two ellipses are, the more both of them deform
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        const a = E[i], b = E[j];
        const dx = (a.x - b.x) * w, dy = (a.y - b.y) * h;
        const d = Math.hypot(dx, dy);
        const reach = (a.rx + b.rx) * unit * 0.75;
        if (d < reach) {
          const f = 1 - d / reach;
          a.warp = Math.min(1, a.warp + f * 0.055);
          b.warp = Math.min(1, b.warp + f * 0.055);
          // and they lean toward one another, like surface tension
          const nx = dx / (d || 1), ny = dy / (d || 1);
          a.ax = -nx * f; a.ay = -ny * f;
          b.ax = nx * f;  b.ay = ny * f;
        }
      }
    }

    ctx.clearRect(0, 0, w, h);
    ctx.lineWidth = 1;

    for (let k = 0; k < N; k++) {
      const e = E[k];
      const cx = e.x * w, cy = e.y * h;
      // the axes swell and shrink hard, so each one keeps changing shape
      const rx = e.rx * unit * (1 + Math.sin(t * e.px + e.ph) * 0.32);
      const ry = e.ry * unit * (1 + Math.cos(t * e.py + e.ph) * 0.32);
      const cos = Math.cos(e.rot), sin = Math.sin(e.rot);

      ctx.beginPath();
      for (let s = 0; s <= STEPS; s++) {
        const a = (s / STEPS) * TAU;
        // deformation grows with warp and pulls along the neighbour direction
        const bulge = 1
          + e.warp * 0.26 * Math.sin(a * 2 + t * 0.9 + e.seed)
          + e.warp * 0.14 * Math.sin(a * 3 - t * 0.7 + e.seed);
        let ux = Math.cos(a) * rx * bulge;
        let uy = Math.sin(a) * ry * bulge;
        if (e.ax || e.ay) {
          const lean = e.warp * 26;
          ux += e.ax * lean * (0.5 + 0.5 * Math.cos(a));
          uy += e.ay * lean * (0.5 + 0.5 * Math.sin(a));
        }
        const x = cx + ux * cos - uy * sin;
        const y = cy + ux * sin + uy * cos;
        if (s === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      // they read slightly stronger exactly where they are being deformed
      const al = 0.13 + e.warp * 0.16;
      ctx.strokeStyle = k % 2
        ? `rgba(63,80,100,${al.toFixed(3)})`
        : `rgba(78,144,121,${(al * 1.25).toFixed(3)})`;
      ctx.stroke();
      e.ax = 0; e.ay = 0;
    }
  }

  let raf = 0, running = false, last = 0;
  const t0 = performance.now();
  function frame(now) {
    raf = 0;
    const dt = Math.min(0.05, (now - (last || now)) / 1000);
    last = now;
    step(dt, (now - t0) / 1000);
    if (running) raf = requestAnimationFrame(frame);
  }
  function start() { if (!raf && running) { last = 0; raf = requestAnimationFrame(frame); } }

  const io = new IntersectionObserver((es) => {
    running = es[0].isIntersecting;
    if (running) start(); else if (raf) { cancelAnimationFrame(raf); raf = 0; }
  }, { threshold: 0 });
  io.observe(hero);

  addEventListener('resize', size);
  size();
})();
