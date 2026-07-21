/* PATRICKS WELT — GSAP orchestration (loader, cursor, hero, shatter→video journey, reveals). */
gsap.registerPlugin(ScrollTrigger, ScrollSmoother, SplitText);
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

const smoother = ScrollSmoother.create({
  wrapper: '#smooth-wrapper', content: '#smooth-content',
  smooth: 1.15, effects: true, normalizeScroll: true
});

/* ---------- custom cursor ---------- */
let cursorShow = () => {}, cursorHide = () => {};
(function cursor() {
  const c = document.getElementById('cursor'), label = document.getElementById('cursorLabel');
  if (!c) return;
  const qx = gsap.quickTo(c, 'x', { duration: 0.16, ease: 'power3' });
  const qy = gsap.quickTo(c, 'y', { duration: 0.16, ease: 'power3' });
  window.addEventListener('mousemove', (e) => { qx(e.clientX); qy(e.clientY); });
  cursorShow = (t) => { label.textContent = t || ''; c.classList.add('is-hover'); };
  cursorHide = () => c.classList.remove('is-hover');
  document.querySelectorAll('[data-cursor]').forEach((el) => {
    el.addEventListener('mouseenter', () => cursorShow(el.dataset.cursor));
    el.addEventListener('mouseleave', cursorHide);
  });
})();

/* ---------- progress bar ---------- */
gsap.to('#progress', { scaleX: 1, ease: 'none',
  scrollTrigger: { trigger: '#smooth-content', start: 'top top', end: 'bottom bottom', scrub: 0.3 } });

/* ---------- nav light over dark sections ---------- */
let darkN = 0;
['.journey', '.footer'].forEach((sel) => ScrollTrigger.create({
  trigger: sel, start: 'top 4rem', end: 'bottom 4rem',
  onToggle: (s) => { darkN += s.isActive ? 1 : -1; document.getElementById('nav').classList.toggle('nav--light', darkN > 0); }
}));

/* ---------- loader: gate on hero images + first videos ---------- */
(function loader() {
  const fill = document.getElementById('loaderFill'), pct = document.getElementById('loaderPct');
  const heroImgs = [...document.querySelectorAll('.liquid-reveal img')];
  const waits = [];
  heroImgs.forEach((im) => waits.push((im.decode ? im.decode() : Promise.resolve()).catch(() => {})));
  // preload the whole frame sequence so scrubbing never stutters
  // (deferred a tick because FILM is defined further down this module)
  waits.push(new Promise((r) => setTimeout(() => FILM.load().then(r), 0)));
  const ready = Promise.all(waits);
  const state = { v: 0 };
  gsap.to(state, { v: 100, duration: 2.2, ease: 'power1.inOut',
    onUpdate: () => { fill.style.width = state.v + '%'; pct.textContent = Math.round(state.v); } });
  Promise.race([ready, new Promise((r) => setTimeout(r, 5000))]).then(() => {
    gsap.to(state, { v: 100, duration: 0.3, onUpdate: () => { fill.style.width = state.v + '%'; pct.textContent = Math.round(state.v); },
      onComplete: () => {
        gsap.timeline()
          .to('#loader', { yPercent: -100, duration: 0.9, ease: 'power4.inOut' })
          .set('#loader', { display: 'none' })
          .from('.nav', { yPercent: -120, opacity: 0, duration: 0.7, ease: 'power3.out' }, '-=0.5')
          .from('.hero__portrait-wrap', { scale: 1.08, duration: 1.3, ease: 'power3.out' }, '-=0.6')
          .from('.hero__ghost', { opacity: 0, scale: 0.95, duration: 1.2, ease: 'power3.out' }, '<0.1')
          .from('.hero__meta span, .hero__scroll', { yPercent: 60, opacity: 0, stagger: 0.06, duration: 0.7, ease: 'power3.out' }, '<0.2');
      } });
  });
})();

/* ghost drifts with cursor */
gsap.set('.hero__ghost', { xPercent: -50, yPercent: -50 });
(function ghostParallax() {
  const gx = gsap.quickTo('.hero__ghost', 'x', { duration: 1.1, ease: 'power2' });
  const gy = gsap.quickTo('.hero__ghost', 'y', { duration: 1.1, ease: 'power2' });
  window.addEventListener('mousemove', (e) => {
    gx(-(e.clientX / innerWidth - 0.5) * 40);
    gy(-(e.clientY / innerHeight - 0.5) * 24);
  });
})();
gsap.to('.hero__scroll span', { scaleX: 1.8, opacity: 0.4, transformOrigin: 'left', repeat: -1, yoyo: true, duration: 1, ease: 'power1.inOut' });
/* living portrait — a barely-perceptible breath on the image (not the wrap, which the scroll-out drives) */
if (!REDUCED) gsap.to('.hero__portrait', { scale: 1.016, duration: 6, ease: 'sine.inOut', repeat: -1, yoyo: true, delay: 3 });

/* dynamic hero background — slow drifting light (transform only = GPU cheap, no particles) */
if (!REDUCED) {
  gsap.to('.hero__glow--a', { xPercent: 12, yPercent: 9, scale: 1.12, duration: 18, ease: 'sine.inOut', repeat: -1, yoyo: true });
  gsap.to('.hero__glow--b', { xPercent: -14, yPercent: -8, scale: 1.16, duration: 23, ease: 'sine.inOut', repeat: -1, yoyo: true });
  gsap.to('.hero__glow--c', { xPercent: -9, yPercent: 12, scale: 0.9, duration: 15, ease: 'sine.inOut', repeat: -1, yoyo: true });
}
/* the light also reacts to the cursor — subtle parallax depth */
(function heroLightParallax() {
  const layers = gsap.utils.toArray('.hero__glow');
  if (!layers.length) return;
  const q = layers.map((el, i) => ({
    x: gsap.quickTo(el, 'x', { duration: 1.4, ease: 'power2.out' }),
    y: gsap.quickTo(el, 'y', { duration: 1.4, ease: 'power2.out' }),
    d: (i + 1) * 18
  }));
  addEventListener('mousemove', (e) => {
    const nx = e.clientX / innerWidth - 0.5, ny = e.clientY / innerHeight - 0.5;
    q.forEach((l) => { l.x(-nx * l.d); l.y(-ny * l.d); });
  });
})();


/* ================= FILM — six looping clips; scroll only dissolves + writes =================
   The footage is never scrubbed. Each clip runs on its own loop, so standing still
   still looks alive. Scroll does exactly two things: cross-dissolve clip i into
   clip i+1, and carry each clip's two copy beats in from the left, then the right. */
const FILM = (function film() {
  const el = document.getElementById('film');
  const stack = document.getElementById('filmStack');
  if (!el || !stack) return { load: () => Promise.resolve(), apply() {}, setVisible() {}, size() {} };

  const vids = [...stack.querySelectorAll('.film__v')];
  const N = vids.length;
  const panels = [...document.querySelectorAll('.fpanel')].map((p) => ({
    el: p, v: +p.dataset.v, slot: +p.dataset.s,
    side: p.classList.contains('fpanel--r') ? 1 : -1
  }));

  const cl = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const ease = (t) => t * t * (3 - 2 * t);
  const seg = (x, a, b) => ease(cl((x - a) / (b - a)));

  /* Inside one clip's slice (local 0..1): beat A rides in from the left and HOLDS,
     beat B does the same from the right, and the tail is left clear for the
     dissolve. The slice is 300vh, so each hold below is ~100vh of scrolling —
     several swipes before anything moves, never a flick-and-it's-gone. */
  const BEAT = [
    { in: [0.02, 0.08], out: [0.40, 0.46] },   // holds 0.08–0.40 ≈ 1150px
    { in: [0.53, 0.59], out: [0.88, 0.93] }    // holds 0.59–0.88 ≈ 1040px
  ];
  const FADE = 0.07;                            // dissolve = the last 7% of the slice
  function apply(p) {
    const x = cl(p) * N;                    // continuous clip position across the section

    for (let i = 0; i < N; i++) {
      /* clip i ramps up over the tail of clip i-1 and then just stays opaque.
         Stacked, the upper one covers the lower — a true dissolve with no dip
         to black, which two half-opacity layers would give you. */
      const o = cl((x - (i - FADE)) / FADE);
      const v = vids[i];
      if (v._o !== o) { v.style.opacity = o; v._o = o; }

      /* Fetch the next clip up. Once you're actually into the film, quietly pull the
         rest too — waiting until each one is needed made the scroll stall for a
         second while a clip decoded. First paint still only waits on clip 0. */
      if (i <= Math.floor(x) + 1 || x > 0.15) ensure(i);

      // only what's actually on screen needs to decode
      const covered = i < N - 1 && cl((x - (i + 1 - FADE)) / FADE) >= 1;
      const live = o > 0.001 && !covered;
      if (live && v.paused) v.play().catch(() => {});
      else if (!live && !v.paused) v.pause();
    }

    for (const q of panels) {
      const local = cl(x - q.v);            // position inside this clip's own slice
      const b = BEAT[q.slot];
      const i0 = seg(local, b.in[0], b.in[1]);
      const o0 = seg(local, b.out[0], b.out[1]);
      const a = Math.min(i0, 1 - o0);
      if (q._a === a) continue;
      q._a = a;
      q.el.style.opacity = a;
      const dx = (1 - i0) * 70 * q.side + o0 * 45 * q.side;   // in from its side, out the same way
      q.el.style.transform = `translate(${dx}px, calc(-50% + ${(1 - i0) * 18}px))`;
    }
  }

  /* Wait only until the first clip can paint a frame — the other five keep
     buffering behind the curtain. Never hold the site hostage to 24MB of video. */
  /* Pull a clip in only once you're approaching it. Loading all six up front cost
     ~14MB before the curtain could lift — brutal on a phone. */
  function ensure(i) {
    const v = vids[i];
    if (!v || v._req) return;
    v._req = 1;
    v.preload = 'auto';
    v.load();
  }

  function load() {
    ensure(0);
    vids[0].play().catch(() => {});
    const first = vids[0];
    if (first.readyState >= 2) return Promise.resolve();
    return new Promise((res) => {
      let done = false;
      const go = () => { if (!done) { done = true; res(); } };
      first.addEventListener('loadeddata', go, { once: true });
      first.addEventListener('error', go, { once: true });
      setTimeout(go, 6000);                 // a slow network must not stall the curtain
    });
  }

  return { load, apply, size() {}, setVisible: (o) => { el.style.opacity = cl(o); } };
})();

/* ---- HERO → FILM: one clean dissolve, no travel -----------------------------
   The hero is pinned, so nothing slides. Patrick simply fades and eases toward
   the camera while the video fades up over him, and #film (fixed, full-bleed) is
   fully opaque before the pin releases — so the section change underneath is
   never on screen. Short pin: the whole handover is done inside ~80vh. */
(function heroToFilm() {
  const film = document.getElementById('film');
  if (!document.querySelector('.hero') || !film) return;
  film.style.clipPath = 'none';

  const cl = (v) => gsap.utils.clamp(0, 1, v);

  /* ORDER MATTERS: the video comes UP before the hero background goes DOWN.
     It used to be the other way round — at p=0.4 the background was already half
     gone while the film was still at 0, so the cream dissolved toward the dark
     .journey ink underneath with no video over it yet, and you scrolled through a
     washed-out empty frame before the footage arrived.
     The invariant now: at every p, either .hero__bg is fully opaque or .film is.
     The film is solid by p=0.40 and the background only starts leaving at 0.42,
     by which point it is completely hidden behind the film anyway. */
  function paint(p) {
    /* The crossfade is kept SHORT on purpose. Dissolving a bright cream hero into
       dark footage has to pass through a low-contrast middle, and the longer that
       middle lasts the more the page looks washed out rather than intentional. */
    gsap.set('.hero__portrait-wrap', { opacity: 1 - cl(p / 0.30), scale: 1 + cl(p / 0.7) * 0.16 });
    gsap.set('.hero-props', { opacity: 1 - cl(p / 0.22) });
    gsap.set('.hero__ghost', { opacity: 1 - cl(p / 0.18) });
    gsap.set('.hero__meta, .hero__scroll', { opacity: 1 - cl(p / 0.14) });
    gsap.set('.hero__bg', { opacity: 1 - cl((p - 0.32) / 0.18) });  // only once film is solid
    FILM.setVisible(cl((p - 0.03) / 0.27));                          // solid by p = 0.30
  }

  /* onUpdate does NOT fire on refresh, so after a reload (or any layout refresh)
     the hero would keep the inline styles from wherever the last scroll left it —
     e.g. scale(1.16) and a faded portrait while sitting at the top of the page.
     Repainting on refresh too keeps the visual state honest. */
  const st = ScrollTrigger.create({
    trigger: '.hero', start: 'top top', end: '+=80%', pin: true, anticipatePin: 1, scrub: 0.4,
    onUpdate: (self) => paint(self.progress),
    onRefresh: (self) => paint(self.progress)
  });
  paint(st.progress);
})();

/* ---- HERO PROPS: two real product photographs that behave like objects ------
   Plain <img> cut-outs, not WebGL — the realism comes from the photograph itself,
   and this costs a fraction of a second renderer. Each one breathes on its own and
   leans/parallaxes toward the cursor, the far one moving less than the near one. */
(function heroProps() {
  const props = [
    { el: document.getElementById('propRope'), depth: 1.0, rot: -7, bob: 4.2, dur: 6.5 },
    { el: document.getElementById('propBand'), depth: 0.62, rot: 6, bob: -3.4, dur: 8.0 }
  ].filter((p) => p.el);
  if (!props.length || matchMedia('(hover: none)').matches) return;

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  for (const p of props) {
    gsap.set(p.el, { rotate: p.rot, transformPerspective: 900 });
    if (!reduced) {
      // slow idle drift so they feel suspended rather than pasted on
      gsap.to(p.el, { y: p.bob, rotate: p.rot + p.bob * 0.35, duration: p.dur,
        ease: 'sine.inOut', yoyo: true, repeat: -1 });
    }
    p.qx = gsap.quickTo(p.el, 'x', { duration: 0.9, ease: 'power3.out' });
    p.qry = gsap.quickTo(p.el, 'rotationY', { duration: 1.1, ease: 'power3.out' });
    p.qrx = gsap.quickTo(p.el, 'rotationX', { duration: 1.1, ease: 'power3.out' });
  }

  if (reduced) return;
  let ticking = false;
  addEventListener('pointermove', (e) => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      const nx = (e.clientX / innerWidth - 0.5) * 2;
      const ny = (e.clientY / innerHeight - 0.5) * 2;
      for (const p of props) {
        p.qx(nx * 34 * p.depth);
        p.qry(nx * 13 * p.depth);
        p.qrx(-ny * 9 * p.depth);
      }
    });
  }, { passive: true });
})();

/* ---- FILM SECTION: scroll only dissolves clips and moves the copy ---- */
ScrollTrigger.create({
  trigger: '.journey', start: 'top top', end: 'bottom bottom', scrub: 0.4,
  onUpdate: (self) => {
    const p = self.progress;
    FILM.apply(Math.min(1, p / 0.96));
    /* Do NOT claim visibility at p === 0. ScrollTrigger fires onUpdate once on
       refresh even when the section is far below, and an unguarded setVisible(1)
       there pins the film opaque over the hero from the very top of the page.
       The hero owns the fade up; this trigger only owns the fade back out. */
    if (p > 0.96) FILM.setVisible(1 - (p - 0.96) / 0.04);
    else if (p > 0.02) FILM.setVisible(1);
  }
});

/* ================= WORLD intro choreography (fade intro out, labels/hint in) ================= */
(function worldIntro() {
  if (!document.querySelector('.world')) return;
  /* PIN the 3D stage — CSS sticky does not work under ScrollSmoother */
  ScrollTrigger.create({
    trigger: '.world', start: 'top top', end: 'bottom bottom',
    pin: '.world__stage', anticipatePin: 1
  });
  gsap.from('.world__intro > *', { yPercent: 40, opacity: 0, stagger: 0.1, duration: 0.9, ease: 'power3.out',
    scrollTrigger: { trigger: '.world', start: 'top 60%' } });
  /* labels + hint are driven purely by the scrub below — a one-shot tween on them
     re-fires on re-entry and overwrites the scrubbed value, leaving them stuck on. */
  gsap.set('.world__label', { y: 0 });

  /* The DOM side of the act choreography. Same segment maths as scene.js, driven off
     the same scroll range, so each panel arrives exactly as its object dives away. */
  const cl01 = (v) => Math.min(1, Math.max(0, v));
  const ease = (t) => t * t * (3 - 2 * t);
  const seg = (p, a, b) => ease(cl01((p - a) / (b - a)));

  const intro = document.querySelector('.world__intro');
  const labels = document.querySelector('.world__labels');
  const hint = document.querySelector('.world__hint');
  const food = document.getElementById('actFood');
  const sport = document.getElementById('actSport');
  if (!food || !sport) return;

  /* enter as the object leaves, hold, then leave upward */
  function panel(el, p, inA, inB, outA, outB, dir) {
    const i = seg(p, inA, inB), o = seg(p, outA, outB);
    const a = Math.min(i, 1 - o);
    el.style.opacity = a;
    const slide = (1 - i) * 90 * dir;                       // in from the side
    const lift = -o * 60;                                   // out through the top
    el.style.transform = `translate(${slide}px, calc(-50% + ${lift}px))`;
  }

  const w = { p: 0 };
  gsap.to(w, { p: 1, ease: 'none',
    scrollTrigger: { trigger: '.world', start: 'top top', end: 'bottom bottom', scrub: 0.6 },
    onUpdate: () => {
      const p = w.p;
      const out = seg(p, 0.04, 0.16);
      intro.style.opacity = 1 - out;
      intro.style.transform = `translateY(${-out * 40}px)`;
      const lab = seg(p, 0.01, 0.07) * (1 - seg(p, 0.14, 0.24));   // fade in, then out for act 01
      labels.style.opacity = lab;
      hint.style.opacity = lab;
      /* each panel shares the frame with its object: copy one side, object the other */
      panel(food, p, 0.34, 0.46, 0.60, 0.68, -1);           // LEFT, while the bowl holds right
      panel(sport, p, 0.80, 0.90, 1.06, 1.12, 1);           // RIGHT, while the kettlebell holds left
    }
  });
})();

/* ================= magnetic buttons ================= */
function magnet(el, s) {
  const qx = gsap.quickTo(el, 'x', { duration: 0.4, ease: 'elastic.out(1,0.4)' });
  const qy = gsap.quickTo(el, 'y', { duration: 0.4, ease: 'elastic.out(1,0.4)' });
  el.addEventListener('mousemove', (e) => { const r = el.getBoundingClientRect();
    qx((e.clientX - (r.left + r.width / 2)) * s); qy((e.clientY - (r.top + r.height / 2)) * s); });
  el.addEventListener('mouseleave', () => { qx(0); qy(0); });
}
document.querySelectorAll('.nav__cta, .pdf__btn').forEach((el) => magnet(el, 0.4));

/* ================= MANIFEST word reveal ================= */
(function manifest() {
  const words = document.querySelectorAll('.manifest__text .w');
  gsap.set(words, { opacity: 0.12, yPercent: 30 });
  gsap.to(words, {
    opacity: 1, yPercent: 0, stagger: 0.08, ease: 'power2.out',
    scrollTrigger: { trigger: '.manifest', start: 'top 70%', end: 'center center', scrub: 0.6 }
  });
})();

/* ================= ANGEBOTE cards ================= */
gsap.fromTo('.offer',
  { clipPath: 'inset(0 0 100% 0)', y: 40 },
  { clipPath: 'inset(0 0 0% 0)', y: 0, duration: 1.05, stagger: 0.12, ease: 'power3.out',
    scrollTrigger: { trigger: '.angebote__grid', start: 'top 82%' } });
(function headingReveals() {
  ['.angebote .section-title', '.warum .section-title'].forEach((sel) => {
    const el = document.querySelector(sel); if (!el) return;
    const st = new SplitText(el, { type: 'lines' });
    gsap.from(st.lines, { yPercent: 110, opacity: 0, stagger: 0.12, ease: 'power4.out',
      scrollTrigger: { trigger: el, start: 'top 82%', end: 'top 50%', scrub: 0.6 } });
  });
})();
document.querySelectorAll('.offer').forEach((card) => {
  const qx = gsap.quickTo(card, 'rotationY', { duration: 0.5, ease: 'power2' });
  const qy = gsap.quickTo(card, 'rotationX', { duration: 0.5, ease: 'power2' });
  gsap.set(card, { transformPerspective: 900 });
  card.addEventListener('mousemove', (e) => {
    const r = card.getBoundingClientRect();
    qx(((e.clientX - r.left) / r.width - 0.5) * 8);
    qy(-((e.clientY - r.top) / r.height - 0.5) * 8);
  });
  card.addEventListener('mouseleave', () => { qx(0); qy(0); });
});
gsap.from('.angebote__head > *', { yPercent: 40, opacity: 0, stagger: 0.1, duration: 0.8, ease: 'power3.out',
  scrollTrigger: { trigger: '.angebote', start: 'top 75%' } });

/* ================= WARUM ================= */
gsap.from('.warum__portrait', { scale: 0.9, opacity: 0, duration: 1, ease: 'power3.out',
  scrollTrigger: { trigger: '.warum', start: 'top 70%' } });
gsap.from('.warum__text > *', { yPercent: 40, opacity: 0, stagger: 0.08, duration: 0.8, ease: 'power3.out',
  scrollTrigger: { trigger: '.warum__text', start: 'top 78%' } });

/* ================= PDF ================= */
gsap.from('.pdf__card', { yPercent: 12, opacity: 0, duration: 1, ease: 'power3.out',
  scrollTrigger: { trigger: '.pdf', start: 'top 78%' } });
gsap.to('.pdf__deco', { yPercent: -12, ease: 'none',
  scrollTrigger: { trigger: '.pdf', start: 'top bottom', end: 'bottom top', scrub: 1 } });

/* ================= FOOTER ================= */
(function footer() {
  const split = new SplitText('.footer__big', { type: 'chars' });
  gsap.from(split.chars, { yPercent: 110, opacity: 0, stagger: 0.03, duration: 0.7, ease: 'power4.out',
    scrollTrigger: { trigger: '.footer', start: 'top 65%' } });
  gsap.from('.footer__lead, .footer__contact, .footer__legal', { yPercent: 40, opacity: 0, stagger: 0.08, duration: 0.8, ease: 'power3.out',
    scrollTrigger: { trigger: '.footer__inner', start: 'top 70%' } });
})();

/* smooth-scroll anchors */
document.querySelectorAll('a[href^="#"]').forEach((a) => a.addEventListener('click', (e) => {
  e.preventDefault(); const t = a.getAttribute('href');
  if (t && t !== '#') smoother.scrollTo(t, true, 'top top');
}));

window.addEventListener('load', () => ScrollTrigger.refresh());
