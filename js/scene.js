/* PATRICKS WELT — interactive 3D world (Sport & Ernährung).
   Photoreal fruit bowl + frosted-glass kettlebell, contact shadows, drag w/ inertia,
   soft motes, scroll camera. Tuned for ~60fps (transmission scale, DPR cap, on-demand). */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const { gsap, ScrollTrigger } = window;
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

const canvas = document.getElementById('worldCanvas');
const section = document.querySelector('.world');
if (canvas && section) init();

function init() {
  THREE.ColorManagement.enabled = true;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  if ('transmissionResolutionScale' in renderer) renderer.transmissionResolutionScale = 0.5;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  camera.position.set(0, 0.15, 7.6);

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  // soft backdrop so the glass has something to refract/glow through
  const backdrop = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 24),
    new THREE.MeshBasicMaterial({ color: 0xf0ead9 })
  );
  backdrop.position.set(0, 0, -6); scene.add(backdrop);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x6b8b7f, 0.75));
  const key = new THREE.DirectionalLight(0xfff3e0, 2.2); key.position.set(4, 7, 6); scene.add(key);
  const rim = new THREE.DirectionalLight(0x8fd0bd, 1.0); rim.position.set(-6, 2, -4); scene.add(rim);
  const foodFill = new THREE.PointLight(0xfff0dd, 14, 12, 2); foodFill.position.set(-2.0, 2.2, 3); scene.add(foodFill);

  const foodGroup = new THREE.Group();  foodGroup.position.set(-2.0, 0, 0);
  const sportGroup = new THREE.Group(); sportGroup.position.set(2.0, 0, 0);
  scene.add(foodGroup, sportGroup);

  const glass = new THREE.MeshPhysicalMaterial({
    color: 0xbfe0d4, roughness: 0.42, metalness: 0,
    transmission: 1.0, thickness: 1.2, ior: 1.4,
    envMapIntensity: 1.3, clearcoat: 0.5, clearcoatRoughness: 0.35,
    attenuationColor: new THREE.Color(0x8fc7b4), attenuationDistance: 6, transparent: true
  });

  // ---------- soft contact shadow (flat plane, invisible floor) ----------
  const shadowTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d'); const rg = g.createRadialGradient(64, 64, 4, 64, 64, 62);
    rg.addColorStop(0, 'rgba(31,44,39,0.5)'); rg.addColorStop(1, 'rgba(31,44,39,0)');
    g.fillStyle = rg; g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  })();
  function contactShadow(x) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 3.4),
      new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.position.set(x, -1.35, 0); m.scale.set(1, 0.6, 1);
    scene.add(m); return m;
  }
  const foodShadow = contactShadow(-2.0), sportShadow = contactShadow(2.0);

  const loader = new GLTFLoader();
  const fit = (obj, target) => {
    const box = new THREE.Box3().setFromObject(obj);
    const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
    obj.position.sub(center);
    obj.scale.setScalar(target / Math.max(size.x, size.y, size.z));
  };

  // pre-compile shaders + upload textures during LOAD (behind the loader) so the
  // expensive glass-transmission shader compile doesn't stall the first scroll into view
  let loaded = 0;
  function warmup() {
    if (++loaded < 2) return;
    try { renderer.compile(scene, camera); renderer.render(scene, camera); } catch (e) {}
    requestRender();
  }
  loader.load('models/bowl-fruit.glb', (g) => {
    const m = g.scene; fit(m, 2.7);
    m.traverse((o) => { if (o.isMesh) { o.material.envMapIntensity = 1.0; o.material.needsUpdate = true; } });
    foodGroup.add(m); foodGroup.rotation.x = 0.28; warmup();
  }, undefined, warmup);

  loader.load('models/kettlebell-opt.glb', (g) => {
    const m = g.scene; fit(m, 2.4);
    m.traverse((o) => { if (o.isMesh) o.material = glass; });
    sportGroup.add(m); warmup();
  }, undefined, warmup);

  // ---------- state ----------
  const drag = { rot: 0, tilt: 0, vel: 0 };
  let baseRotY = 0, camZ = 7.6, camX = 0, lastActive = performance.now();
  let foodSpin = 0, sportSpin = 0;   // per-object scroll spin, on top of baseRotY

  // ---------- render loop (on-demand; parks after idle unless ambient) ----------
  let raf = 0, running = false, t0 = performance.now();
  function renderOnce() {
    raf = 0;
    const t = (performance.now() - t0) / 1000;
    // drag inertia + tilt ease-back
    if (!dragging) { drag.rot += drag.vel; drag.vel *= 0.94; if (Math.abs(drag.vel) < 0.0002) drag.vel = 0;
      drag.tilt += (0 - drag.tilt) * 0.05; }
    foodGroup.rotation.y = baseRotY + foodSpin + drag.rot + (REDUCED ? 0 : Math.sin(t * 0.4) * 0.06);
    sportGroup.rotation.y = -baseRotY - sportSpin - drag.rot + (REDUCED ? 0 : Math.cos(t * 0.35) * 0.06);
    foodGroup.rotation.x = 0.28 + drag.tilt; sportGroup.rotation.x = drag.tilt;
    camera.position.set(camX, 0.15, camZ);
    camera.lookAt(0, -0.05, 0);
    renderer.render(scene, camera);
    // only keep the loop hot during interaction; scroll drives frames via requestRender.
    // when idle → park (no continuous glass double-render) = smooth.
    const active = dragging || Math.abs(drag.vel) > 0.0002 || Math.abs(drag.tilt) > 0.001;
    if (running && active) raf = requestAnimationFrame(renderOnce);
  }
  function requestRender() { if (!raf && running) raf = requestAnimationFrame(renderOnce); }

  const io = new IntersectionObserver((es) => {
    running = es[0].isIntersecting;
    if (running) requestRender();
  }, { threshold: 0 });
  io.observe(section);

  // ---------- interaction: drag to rotate (touch-safe) ----------
  let dragging = false, px = 0, py = 0, startX = 0, startY = 0, decided = false, isTouch = false;
  canvas.addEventListener('pointerdown', (e) => {
    px = startX = e.clientX; py = startY = e.clientY; decided = false; isTouch = e.pointerType === 'touch';
    if (!isTouch) { dragging = true; canvas.setPointerCapture(e.pointerId); }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (isTouch && !decided) {
      const dx = Math.abs(e.clientX - startX), dy = Math.abs(e.clientY - startY);
      if (dx < 6 && dy < 6) return;
      decided = true;
      if (dx > dy) { dragging = true; try { canvas.setPointerCapture(e.pointerId); } catch (x) {} } else return;
    }
    if (!dragging) return;
    const dxx = (e.clientX - px) * 0.006; drag.rot += dxx; drag.vel = dxx; px = e.clientX;
    if (!isTouch) { drag.tilt = gsap.utils.clamp(-0.4, 0.4, drag.tilt + (e.clientY - py) * 0.003); py = e.clientY; }
    requestRender();
  });
  const endDrag = () => { dragging = false; requestRender(); };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('pointerleave', endDrag);

  // ---------- scroll choreography ----------
  // One timeline in three beats:
  //   INTRO   both objects converge while the camera dollies in
  //   ACT 01  the fruit bowl slides centre, spins up, zooms into the lens, then dives
  //           down out of frame — handing the screen to the Ernährung panel
  //   ACT 02  the kettlebell does the same, handing over to the Training panel
  const cl01 = (v) => Math.min(1, Math.max(0, v));
  const ease = (t) => t * t * (3 - 2 * t);              // smoothstep — no snap at the edges
  const seg = (p, a, b) => ease(cl01((p - a) / (b - a)));

  const prox = { p: 0 };
  gsap.to(prox, { p: 1, ease: 'none',
    scrollTrigger: { trigger: section, start: 'top top', end: 'bottom bottom', scrub: 1 },
    onUpdate: () => {
      const p = prox.p;
      const intro = seg(p, 0.00, 0.16);

      // camera: dolly in over the intro, then hold — the objects do the travelling
      camZ = 8.4 - intro * 1.4;
      camX = Math.sin(intro * Math.PI * 0.5) * 0.35;
      baseRotY = intro * Math.PI * 0.3;

      /* --- ACT 01 · fruit bowl swings into the RIGHT half, spins up, zooms in and
             HOLDS there while the Ernährung copy fills the left. It only takes off
             downwards once that copy is gone, so the frame is never half empty. --- */
      const aIn = seg(p, 0.16, 0.32);        // travel to its side
      const aZoom = seg(p, 0.26, 0.44);      // grow into the hold
      const aDive = seg(p, 0.68, 0.78);      // exit downwards, after the copy leaves
      foodGroup.position.x = -2.0 + aIn * 4.3;             // -2.0 → +2.3 (right half)
      foodGroup.position.y = -aDive * 8.0;
      foodGroup.position.z = aZoom * 2.6;
      foodSpin = aIn * Math.PI * 1.1 + aZoom * Math.PI * 1.3 + aDive * Math.PI * 1.4;
      foodGroup.scale.setScalar(1 + aZoom * 0.34 - aDive * 0.15);

      /* --- ACT 02 · kettlebell sits off-stage right through act 01, then swings to the
             LEFT half and holds while the Training copy fills the right. --- */
      const bIn = seg(p, 0.62, 0.78), bZoom = seg(p, 0.70, 0.88), bDive = seg(p, 0.97, 1.0);
      sportGroup.position.x = 2.0 + aIn * 4.5 - bIn * 8.2;  // → -1.7 (left half, fully in frame)
      sportGroup.position.y = -bDive * 8.0;
      sportGroup.position.z = bZoom * 2.1;                  // the kettlebell reads bigger than the bowl
      sportSpin = bIn * Math.PI * 1.1 + bZoom * Math.PI * 1.3 + bDive * Math.PI * 1.4;
      sportGroup.scale.setScalar(1 + bZoom * 0.34 - bDive * 0.15);

      foodFill.position.x = foodGroup.position.x;   // the fill light follows the bowl

      // shadows track their object and dissolve as it leaves the ground
      foodShadow.position.x = foodGroup.position.x;
      foodShadow.material.opacity = 1 - Math.max(aDive, aZoom * 0.6);
      sportShadow.position.x = sportGroup.position.x;
      sportShadow.material.opacity = 1 - Math.max(bDive, bZoom * 0.6);
      requestRender();
    }
  });

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    camera.aspect = w / h; camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    renderer.setSize(w, h, false); requestRender();
  }
  addEventListener('resize', resize); resize();
  addEventListener('load', () => { ScrollTrigger.refresh(); requestRender(); });
}
