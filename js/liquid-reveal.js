/**
 * liquid-reveal — vanilla port of the production engine from the
 * liquid-image-reveal skill (nordhunde-therapie.de). A liquid circular mask
 * follows the inertia-smoothed cursor and reveals the bottom image through
 * the top one: gooey metaball field from a fading trail of blobs, edges
 * displaced by animated value noise. WebGL per-pixel; Canvas2D fallback.
 * Draws ONLY while alive (pointer inside or trail healing) — idle cost zero.
 * Astro-specific lifecycle removed for this plain multi-page site.
 */
(function () {
  function initLiquidReveal() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    document.querySelectorAll('[data-liquid-reveal]').forEach((box) => {
      if (box.dataset.lrBound === '1') return;
      box.dataset.lrBound = '1';
      setupInstance(box);
    });
  }

  function setupInstance(box) {
    const topImg = box.querySelector('[data-lr-top]');
    const botImg = box.querySelector('[data-lr-bottom]');
    const canvas = box.querySelector('[data-lr-canvas]');
    if (!topImg || !botImg || !canvas) return;

    const cfg = {
      radius: parseFloat(box.dataset.radius || '130'),
      softness: parseFloat(box.dataset.softness || '0.38'),
      distortion: parseFloat(box.dataset.distortion || '0.55'),
      flowSpeed: parseFloat(box.dataset.flowSpeed || '0.6'),
      inertia: parseFloat(box.dataset.inertia || '0.14'),
      trailDuration: parseFloat(box.dataset.trailDuration || '1.15') * 1000,
      gooeyness: parseFloat(box.dataset.gooeyness || '0.55'),
      healOnLeave: box.dataset.healOnLeave !== '0',
    };

    /* ---------- auto sweeps ----------
       Narrow bands that shoot across the subject on their own, so the reveal is
       always in motion instead of waiting for a cursor. One crosses at head
       height, a second follows a beat later, lower, over the kettlebell. */
    const sw = {
      on: box.dataset.autoSweep === '1',
      period: parseFloat(box.dataset.sweepPeriod || '2400'),   // ms between rounds
      dur: parseFloat(box.dataset.sweepDuration || '1500'),    // ms to cross
      gap: parseFloat(box.dataset.sweepGap || '520'),          // 2nd band delay
      life: parseFloat(box.dataset.sweepLife || '700'),        // short tail = reads as a shot
      scale: parseFloat(box.dataset.sweepScale || '0.5'),      // band thickness vs cursor blob
      ys: (box.dataset.sweepYs || '0.30,0.60').split(',').map(Number),
      runs: [],
      next: 0,
      visible: true
    };

    let cw = 0, ch = 0, dpr = 1;
    const raw = { x: 0, y: 0 };
    const cur = { x: 0, y: 0 };
    let inside = false;
    /* Blob slots, split by class — must sum to the shader's MAX. Two bands need
       ~11 live blobs each to draw an unbroken sweep, so 24 leaves headroom while
       they overlap; the cursor gets the rest. See the trim in pump(). */
    const SWEEP_SLOTS = 40;
    const CURSOR_SLOTS = 24;
    let trail = [];
    let raf = 0;
    let renderer = null;
    let ready = false;

    const size = () => {
      const r = box.getBoundingClientRect();
      cw = Math.max(1, Math.round(r.width));
      ch = Math.max(1, Math.round(r.height));
      /* Render at the real device pixel ratio. Pinning the sweeps to 1x saved
         shading work but meant the mask edge was drawn at half resolution on a
         Retina screen and then upscaled — so the boundary was permanently soft and
         its noise CRAWLED as it animated. That stair-stepped, shimmering edge was
         most of what read as "glitchy". The per-blob cost is now trivial (one fbm
         sample per pixel, hoisted out of the loop), so the pixels are affordable. */
      /* 1.5, not 2. This shader is O(blobs) PER PIXEL, so the backing store is the
         single biggest cost: at 2x it is 1276x1700 = 2.17M px, and with a dense
         trail that measured 50.8fps idle and 35.3fps with the cursor moving on a
         Retina screen — dropped frames, which is exactly what looked glitchy. Every
         "60fps" reading before this was taken at 1x, a quarter of the work, which is
         why the tests disagreed with what was actually on screen.
         1.5 keeps the edge visibly sharper than 1x at roughly half the pixels of 2x. */
      dpr = Math.min(window.devicePixelRatio || 1, 1.35);
      canvas.width = Math.round(cw * dpr);
      canvas.height = Math.round(ch * dpr);
    };

    const ro = new ResizeObserver(() => { size(); if (glResize) glResize(); });
    ro.observe(box);

    // ---------- shared trail/pointer logic ----------
    const strengthOf = (p, now) => {
      if (p.hold) return 1;
      // sweep blobs carry their own (shorter) life and their own thickness
      const a = 1 - (now - p.born) / (p.life || cfg.trailDuration);
      if (a <= 0) return 0;
      const s = a * a * (p.k || 1);
      /* Cursor blobs fade by RANK as well as by age, and the weaker of the two wins.
         Age alone is not enough: a blob is also emitted every 16px of travel, so a
         fast flick can mint far more blobs than the cursor's slot budget holds, and
         the oldest then gets dropped while still near full strength — a visible pop.
         Ranking pins the oldest cursor blob at ~1/16 strength, so by the time it is
         dropped it has already faded to nothing and the eviction cannot be seen. */
      return p.rank === undefined ? s : Math.min(s, p.rank * p.rank);
    };

    /* schedule + advance the automatic bands */
    const pumpSweeps = (now) => {
      if (!sw.on || !sw.visible) return;
      if (now >= sw.next) {
        // 1st: right -> left across his head, face and neck
        sw.runs.push({ t0: now, dir: -1, y: sw.ys[0] || 0.2 });
        // 2nd, a beat later: left -> right across the chest, arms and kettlebell
        sw.runs.push({ t0: now + sw.gap, dir: 1, y: sw.ys[1] || 0.8 });
        sw.next = now + sw.period;
      }
      for (const r of sw.runs) {
        const t = (now - r.t0) / sw.dur;
        if (t < 0 || t > 1) continue;
        // travel a bit beyond both edges so the band enters and exits off-screen
        const span = cw * 1.34, from = -cw * 0.17;
        const x = r.dir > 0 ? from + t * span : from + span - t * span;
        const y = r.y * ch;
        /* Emit on the SAME 16px step the cursor uses. This is the whole difference
           between the two: the cursor lays a blob every 16px and looks liquid, while
           the bands used cw*0.075 — a 44px step — so their leading edge jumped
           forward 44px at a time and stuttered across his face. Matching the cursor
           makes the band advance the same way the cursor trail does.
           The tail is kept short (data-sweep-life) instead of coarse, so a denser
           trail still fits the sweep slot budget. */
        const last = r.last;
        if (!last || Math.hypot(x - last.x, y - last.y) > 10 || now - last.born > 55) {
          const p = { x, y, born: now, life: sw.life, k: sw.scale, sweep: true };
          trail.push(p);
          r.last = p;
        }
      }
      sw.runs = sw.runs.filter((r) => now - r.t0 < sw.dur + 60);
    };

    const pump = (now) => {
      cur.x += (raw.x - cur.x) * cfg.inertia;
      cur.y += (raw.y - cur.y) * cfg.inertia;
      if (inside) {
        /* Emit against the last CURSOR blob, not the last blob of any kind — a
           passing sweep blob used to satisfy this test and suppress the cursor's
           own trail, so the hover reveal dropped out whenever a band went by.
           The interval is also paced (was 10px / 55ms) so the trail spans its
           full life inside CURSOR_SLOTS and never has to evict a live blob. */
        let head = null;
        for (let i = trail.length - 1; i >= 0; i--) if (!trail[i].sweep) { head = trail[i]; break; }
        if (!head || Math.hypot(cur.x - head.x, cur.y - head.y) > 10 || now - head.born > 55) {
          trail.push({ x: cur.x, y: cur.y, born: now });
        }
        if (!cfg.healOnLeave) trail.forEach((p) => { p.hold = false; });
      }
      pumpSweeps(now);
      trail = trail.filter((p) => strengthOf(p, now) > 0.004);

      /* Budget the blob slots PER CLASS instead of from one shared pool.
         With a single pool the cursor (which emits continuously) simply outran the
         two sweep bands and evicted them, so moving the mouse truncated a sweep
         halfway across his face. Worse, eviction is instant: a blob still at full
         strength vanished between one frame and the next, which is what read as
         glitching. Trimming each class separately means the bands always own
         enough slots to draw end to end, and the cursor can only ever crowd out
         its own oldest blobs. */
      if (trail.length > SWEEP_SLOTS + CURSOR_SLOTS) {
        const keep = (cls, n) => {
          const of = trail.filter((p) => !!p.sweep === cls);
          return of.length > n ? of.slice(of.length - n) : of;
        };
        const kept = new Set([...keep(true, SWEEP_SLOTS), ...keep(false, CURSOR_SLOTS)]);
        trail = trail.filter((p) => kept.has(p));   // filter preserves chronology
      }

      // oldest cursor blob weakest, newest at full — see the rank note in strengthOf
      const cursors = trail.filter((p) => !p.sweep);
      cursors.forEach((p, i) => { p.rank = (i + 1) / cursors.length; });
    };

    /* Only alive while a band is actually crossing — NOT for the whole idle gap
       between rounds. Otherwise the shader renders every frame forever. */
    const sweeping = () => sw.on && sw.visible && sw.runs.length > 0;
    const alive = (now) => inside || sweeping() || trail.some((p) => strengthOf(p, now) > 0.004);

    function frame(now) {
      pump(now);
      if (!alive(now)) {
        /* Render ONE last blob-free frame and hold it, instead of hiding the canvas.
           Hiding it used to snap opacity 1 -> 0 in a single frame, and the canvas
           does NOT reproduce the <img> underneath exactly (measured: mean delta 4.2,
           max 66, 12.7% of pixels off by >10), so that snap flickered the whole
           portrait every 2.4s cycle — the single biggest source of the glitching.
           Leaving the canvas up permanently makes the mismatch constant, and a
           constant offset is invisible. Rendering still stops, so idle cost is nil. */
        if (renderer) renderer(now);
        raf = 0;
        /* Sleep until the next band is due, then restart — costs nothing in between.
           This MUST NOT be conditional on sw.visible. It used to be, and that made
           the whole effect a coin flip: the hero is pinned by ScrollTrigger, and a
           pin wrap or refresh can make the IntersectionObserver report
           not-intersecting for a moment. If that landed while the engine was going
           idle, no timer was scheduled at all and the sweeps never came back for the
           rest of the page's life — which is exactly why the reveal kept vanishing
           on some loads and not others. Always keep a heartbeat; when off-screen it
           is a bare timer that schedules no rendering, so it stays free. */
        if (sw.on) {
          const wait = sw.visible ? Math.max(30, sw.next - performance.now()) : 400;
          setTimeout(wake, wait);
        }
        return;
      }
      canvas.classList.add('is-live');     // sweeps need it live without a pointerenter
      if (renderer) renderer(now);
      raf = requestAnimationFrame(frame);
    }
    const wake = () => { if (!raf && ready) raf = requestAnimationFrame(frame); };

    /* never sweep off-screen — that would burn a shader pass per frame for nothing */
    if (sw.on && 'IntersectionObserver' in window) {
      new IntersectionObserver((es) => {
        sw.visible = es[0].isIntersecting;
        if (sw.visible) { sw.next = 0; wake(); }
      }, { threshold: 0 }).observe(box);
    }

    const toLocal = (e) => {
      const r = box.getBoundingClientRect();
      raw.x = e.clientX - r.left;
      raw.y = e.clientY - r.top;
    };
    box.addEventListener('pointerenter', (e) => {
      toLocal(e);
      cur.x = raw.x; cur.y = raw.y;
      inside = true;
      canvas.classList.add('is-live');
      wake();
    });
    box.addEventListener('pointermove', (e) => { toLocal(e); wake(); }, { passive: true });
    box.addEventListener('pointerleave', () => {
      inside = false;
      if (!cfg.healOnLeave && trail.length) {
        trail[trail.length - 1].hold = true;
      }
    });

    // ---------- boot once both images are decodable ----------
    Promise.all([topImg.decode().catch(() => {}), botImg.decode().catch(() => {})]).then(() => {
      size();
      renderer = makeWebGL() || make2D();
      ready = renderer !== null;
      /* Start the loop on sw.on/sw.visible — NOT on sweeping(). sweeping() also
         requires sw.runs to be non-empty, but runs are only ever scheduled inside
         frame(), so at boot it is always false and the automatic bands never
         started at all. They appeared to work only when the IntersectionObserver
         happened to fire AFTER the images decoded (wake() bails while !ready and
         nothing re-triggered it), which made the whole effect come and go
         depending on whether the images were cached. */
      /* Same reasoning as the sleep path: start on sw.on alone. If sw.visible
         happened to be false at boot the engine never started and, with no timer
         pending, nothing would ever start it. */
      if (sw.on) wake();
    });

    // ================= WebGL path =================
    let glResize = null;

    function makeWebGL() {
      const gl = canvas.getContext('webgl', { premultipliedAlpha: true, alpha: true }) ||
        canvas.getContext('experimental-webgl');
      if (!gl) return null;

      /* Raised from 26. The loop breaks at uCount, so a bigger ceiling costs only
         uniform space, not per-pixel work — and 26 was far too small: the cursor
         alone emitted ~18 blobs/sec with a 3.4s life (60+ concurrent), so blobs
         were being hard-evicted at full strength every frame. That eviction WAS
         the glitch — chunks of the reveal popping out of existence mid-sweep. */
      /* 64, because DENSITY is what makes this read as liquid. The engine on the
         other sites lays a blob every 10px / 55ms and never looked glitchy; the
         ceiling has to be high enough to hold a trail that fine for two bands plus
         the cursor at once. The loop breaks at uCount, so a higher ceiling costs
         uniform space, not per-pixel work. */
      const MAX = 64;
      const vs = `attribute vec2 aPos; varying vec2 vUv;
        void main(){ vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;
      const fs = `precision highp float;
        varying vec2 vUv;
        uniform sampler2D uTop; uniform sampler2D uBot;
        uniform vec2 uScaleTop; uniform vec2 uScaleBot;
        uniform vec2 uRes; uniform float uTime;
        uniform float uRadius; uniform float uSoft; uniform float uDist;
        uniform float uFlow; uniform float uGoo;
        uniform vec4 uPts[${MAX}]; uniform int uCount;

        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vnoise(vec2 p){
          vec2 i = floor(p); vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
                     mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
        }
        float fbm(vec2 p){
          return 0.6 * vnoise(p) + 0.3 * vnoise(p * 2.1 + 5.2) + 0.1 * vnoise(p * 4.3 + 9.1);
        }

        void main(){
          vec2 px = vUv * uRes;
          float f = 0.0;
          float t = uTime * uFlow;
          /* ONE noise sample per pixel, hoisted out of the blob loop. It used to be
             evaluated per blob (26 x 3 octaves per pixel) which pinned the hero at
             ~1fps once the automatic sweeps made this shader run continuously.
             A single shared field is visually indistinguishable here. */
          float n = fbm(px * 0.011 + t * 0.55);
          for (int i = 0; i < ${MAX}; i++){
            if (i >= uCount) break;
            vec4 pt = uPts[i];
            float d = distance(px, pt.xy);
            d += (n - 0.5) * uRadius * uDist * 1.35;
            float r = uRadius * (0.3 + 0.7 * pt.z);
            f += (1.0 - smoothstep(r * (1.0 - uSoft * 0.9), r, d)) * pt.z;
          }
          float th = mix(0.62, 0.26, uGoo);
          float m = smoothstep(th, th + 0.28 + uSoft * 0.35, f);
          vec2 uvT = 0.5 + (vUv - 0.5) * uScaleTop;
          vec2 uvB = 0.5 + (vUv - 0.5) * uScaleBot;
          /* Carry ALPHA through instead of hard-coding 1.0 — both layers are cut-outs
             of Patrick with transparent surroundings, and forcing opaque here paints
             the empty space back in as a solid rectangle.
             Mix in PREMULTIPLIED space: blending straight-alpha colours would pull in
             the (black) RGB of fully transparent texels and rim his hair with dark. */
          vec4 ct = texture2D(uTop, uvT);
          vec4 cb = texture2D(uBot, uvB);
          ct.rgb *= ct.a;
          cb.rgb *= cb.a;
          gl_FragColor = mix(ct, cb, clamp(m, 0.0, 1.0));
        }`;

      const compile = (type, src) => {
        const s = gl.createShader(type);
        if (!s) return null;
        gl.shaderSource(s, src);
        gl.compileShader(s);
        return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
      };
      const v = compile(gl.VERTEX_SHADER, vs);
      const f = compile(gl.FRAGMENT_SHADER, fs);
      if (!v || !f) return null;
      const prog = gl.createProgram();
      if (!prog) return null;
      gl.attachShader(prog, v);
      gl.attachShader(prog, f);
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
      gl.useProgram(prog);

      const quad = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const aPos = gl.getAttribLocation(prog, 'aPos');
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

      const mkTex = (img, unit) => {
        const tex = gl.createTexture();
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      };
      mkTex(topImg, 0);
      mkTex(botImg, 1);

      const U = (n) => gl.getUniformLocation(prog, n);
      gl.uniform1i(U('uTop'), 0);
      gl.uniform1i(U('uBot'), 1);
      gl.uniform1f(U('uRadius'), cfg.radius);
      gl.uniform1f(U('uSoft'), cfg.softness);
      gl.uniform1f(U('uDist'), cfg.distortion);
      gl.uniform1f(U('uFlow'), cfg.flowSpeed);
      gl.uniform1f(U('uGoo'), cfg.gooeyness);
      const uRes = U('uRes'), uTime = U('uTime'), uCount = U('uCount'), uPts = U('uPts');
      const uScaleTop = U('uScaleTop'), uScaleBot = U('uScaleBot');

      const cover = (img) => {
        const ia = img.naturalWidth / img.naturalHeight;
        const ca = cw / ch;
        return ca > ia ? [1, ia / ca] : [ca / ia, 1];
      };
      glResize = () => {
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.uniform2f(uRes, cw, ch);
        const st = cover(topImg);
        const sb = cover(botImg);
        gl.uniform2f(uScaleTop, st[0], st[1]);
        gl.uniform2f(uScaleBot, sb[0], sb[1]);
      };
      glResize();

      const pts = new Float32Array(MAX * 4);
      return (now) => {
        let n = 0;
        for (const p of trail) {
          if (n >= MAX) break;
          pts[n * 4] = p.x;
          pts[n * 4 + 1] = ch - p.y; // shader space is bottom-origin
          pts[n * 4 + 2] = strengthOf(p, now);
          n++;
        }
        gl.uniform4fv(uPts, pts);
        gl.uniform1i(uCount, n);
        gl.uniform1f(uTime, now / 1000);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      };
    }

    // ================= Canvas2D fallback =================
    function make2D() {
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      const mask = document.createElement('canvas');
      const mctx = mask.getContext('2d');
      const temp = document.createElement('canvas');
      const tctx = temp.getContext('2d');
      if (!mctx || !tctx) return null;

      const drawCover = (c, img) => {
        const ia = img.naturalWidth / img.naturalHeight;
        const ca = cw / ch;
        let dw, dh;
        if (ia > ca) { dh = ch; dw = ch * ia; } else { dw = cw; dh = cw / ia; }
        c.drawImage(img, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
      };

      return (now) => {
        if (mask.width !== cw || mask.height !== ch) {
          mask.width = temp.width = cw;
          mask.height = temp.height = ch;
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const t = (now / 1000) * cfg.flowSpeed;
        mctx.clearRect(0, 0, cw, ch);
        for (const p of trail) {
          const s = strengthOf(p, now);
          const r = cfg.radius * (0.35 + 0.65 * s);
          const wob = cfg.radius * cfg.distortion * 0.22;
          const wx = p.x + Math.sin(t * 2.1 + p.born) * wob;
          const wy = p.y + Math.cos(t * 1.7 + p.born * 0.7) * wob;
          const g = mctx.createRadialGradient(wx, wy, r * Math.max(0.05, 1 - cfg.softness), wx, wy, r);
          g.addColorStop(0, `rgba(255,255,255,${Math.min(1, s * (0.6 + cfg.gooeyness))})`);
          g.addColorStop(1, 'rgba(255,255,255,0)');
          mctx.fillStyle = g;
          mctx.beginPath();
          mctx.arc(wx, wy, r, 0, Math.PI * 2);
          mctx.fill();
        }
        tctx.clearRect(0, 0, cw, ch);
        drawCover(tctx, topImg);
        tctx.globalCompositeOperation = 'destination-out';
        tctx.drawImage(mask, 0, 0);
        tctx.globalCompositeOperation = 'source-over';
        ctx.clearRect(0, 0, cw, ch);
        drawCover(ctx, botImg);
        ctx.drawImage(temp, 0, 0);
      };
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initLiquidReveal);
  } else {
    initLiquidReveal();
  }
})();
