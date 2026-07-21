/* PATRICKS WELT — hero props that actually behave like objects.
   The photographs stay photographs: each cut-out is mapped onto a finely subdivided
   plane and deformed in the VERTEX SHADER, so we keep the real lens/lighting detail
   but gain motion a flat <img> can never have.

   Springseil — the middle of the rope revolves around the line between its handles.
   Driving y with sin() and z with cos() traces a circle, which IS the jump-rope
   motion: the rope sweeps down, under, up and over while the handles stay put.
   Widerstandsband — stretches and snaps back along its own length, elastically.

   Both idle constantly (slow drift, slow turn, a travelling ripple) so they read as
   floating in space, and both react to cursor proximity rather than a hover event —
   the canvas is pointer-transparent, so proximity is measured in screen space. */
import * as THREE from 'three';

const canvas = document.getElementById('heroProps');
const hero = document.querySelector('.hero');
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
if (canvas && hero && innerWidth > 900) init();

function init() {
  THREE.ColorManagement.enabled = true;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  /* 1.25, not 2. The hero stacks THREE full-viewport canvases — this one, the
     ellipse field, and the liquid reveal — and at 2x this one alone is 2880x1800 =
     5.2M px every frame. Together they pushed a Retina screen well below 60fps,
     which is what read as the hero being glitchy. These are two soft-focus props:
     the extra resolution is not visible, the dropped frames are. */
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.25));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearAlpha(0);

  const scene = new THREE.Scene();
  // orthographic in CSS pixels — lets the props be placed against the layout exactly
  let camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -2000, 2000);

  const loader = new THREE.TextureLoader();

  /* mode 0 = rope (revolves), mode 1 = band (stretches) */
  function makeProp({ url, seg, mode, spin, bobAmp, bobDur }) {
    const tex = loader.load(url);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();

    const uni = {
      uTime: { value: 0 },
      uHover: { value: 0 },
      uW: { value: 360 },
      uMode: { value: mode }
    };

    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uni);
      sh.vertexShader = `
        uniform float uTime; uniform float uHover; uniform float uW; uniform float uMode;
      ` + sh.vertexShader.replace('#include <begin_vertex>', `
        #include <begin_vertex>
        /* NOTE: the camera is orthographic, so displacing z is invisible.
           All deformation has to happen in x/y to actually be seen. */
        float u = transformed.x / uW + 0.5;          // 0..1 across the prop
        float v = transformed.y / uW + 0.5;
        float arc = sin(u * 3.14159265);             // 0 at the edges, 1 mid-span
        if (uMode < 0.5) {
          /* Springseil: a wave travels down the cable and the whole span sweeps
             up and down — the shape a rope makes while someone skips it. */
          float sp = uTime * 4.4;
          transformed.y += arc * (7.0 + uHover * 78.0) * sin(sp + u * 2.4);
          transformed.x += arc * uHover * 20.0 * cos(sp * 0.85);
        } else {
          /* Widerstandsband: elastic snap along its length, squashing across it */
          float s = sin(uTime * 5.2);
          transformed.x *= 1.0 + uHover * 0.24 * s;
          transformed.y *= 1.0 - uHover * 0.13 * s;
          transformed.y += sin(u * 6.0 + uTime * 1.2) * (4.0 + uHover * 12.0);
        }
      `);
    };

    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(360, 360, seg, Math.round(seg * 0.5)), mat);
    scene.add(mesh);
    return { mesh, uni, spin, bobAmp, bobDur, hoverTarget: 0, cx: 0, cy: 0, size: 360 };
  }

  const props = [
    makeProp({ url: 'img/prop-rope.webp', seg: 72, mode: 0, spin: -0.10, bobAmp: 14, bobDur: 7.5 }),
    makeProp({ url: 'img/prop-band.webp', seg: 56, mode: 1, spin: 0.08, bobAmp: 11, bobDur: 9.0 })
  ];

  /* Layout. The resting size is NOT what has to fit on screen: the pendulum rotation
     swings the corners out, the band's stretch widens it, and the wave throws the
     rope up and down. Position against that worst-case footprint, then clamp to the
     viewport, or the props clip against the edges once they animate. */
  function place() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    camera = new THREE.OrthographicCamera(-w / 2, w / 2, h / 2, -h / 2, -2000, 2000);

    const size = Math.min(w * 0.17, 250);
    const halfX = size * 0.79 + 30;    // rotation + stretch + x-wave + drift
    const halfY = size * 0.64 + 100;   // rotation + the rope's big vertical sweep + bob
    const M = 12;                      // breathing room from the edge
    const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

    /* Patrick is centred, so the props flank him: Springseil left, Band right.
       Their heights sit where his silhouette is narrowest, so neither disappears
       behind him. */
    props[0].cx = clamp(w * 0.135, halfX + M, w - halfX - M);
    props[1].cx = clamp(w * 0.865, halfX + M, w - halfX - M);
    props[0].cy = clamp(h * 0.38, halfY + M, h - halfY - M);
    props[1].cy = clamp(h * 0.56, halfY + M, h - halfY - M);

    for (const p of props) {
      p.size = size;
      p.uni.uW.value = 360;             // shader works in the mesh's own units
      p.mesh.scale.setScalar(size / 360);
      p.mesh.position.set(p.cx - w / 2, h / 2 - p.cy, 0);
    }
    renderer.setSize(w, h, false);
  }

  // cursor proximity — the canvas ignores pointer events, so measure distance instead
  const pointer = { x: -9999, y: -9999 };
  addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect();
    pointer.x = e.clientX - r.left;
    pointer.y = e.clientY - r.top;
  }, { passive: true });
  addEventListener('pointerleave', () => { pointer.x = pointer.y = -9999; }, { passive: true });

  let raf = 0, running = false;
  const t0 = performance.now();
  function frame() {
    raf = 0;
    const t = (performance.now() - t0) / 1000;
    const h = canvas.clientHeight;

    for (const p of props) {
      // proximity → hover, eased so it swells and settles instead of snapping on
      const d = Math.hypot(pointer.x - p.cx, pointer.y - p.cy);
      p.hoverTarget = d < p.size * 0.85 ? 1 : 0;
      p.uni.uHover.value += (p.hoverTarget - p.uni.uHover.value) * (p.hoverTarget ? 0.075 : 0.035);
      p.uni.uTime.value = REDUCED ? 0 : t;

      if (!REDUCED) {
        // constant slow life: drift + turn, like it's suspended in space
        const hv = p.uni.uHover.value;
        p.mesh.position.y = (h / 2 - p.cy) + Math.sin(t * (6.283 / p.bobDur)) * p.bobAmp;
        p.mesh.position.x = (p.cx - canvas.clientWidth / 2) + Math.cos(t * (6.283 / (p.bobDur * 1.6))) * p.bobAmp * 0.5;
        // on approach the rope also swings bodily, like it's being turned
        p.mesh.rotation.z = Math.sin(t * 0.22 + p.cx * 0.01) * 0.06 + Math.sin(t * 3.1) * 0.2 * hv;
        p.mesh.scale.setScalar((p.size / 360) * (1 + hv * 0.05));
      }
    }

    renderer.render(scene, camera);
    if (running) raf = requestAnimationFrame(frame);
  }
  function request() { if (!raf && running) raf = requestAnimationFrame(frame); }

  const io = new IntersectionObserver((es) => {
    running = es[0].isIntersecting;
    if (running) request(); else if (raf) { cancelAnimationFrame(raf); raf = 0; }
  }, { threshold: 0 });
  io.observe(hero);

  addEventListener('resize', place);
  place();
}
