import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import SimplexNoise from 'simplex-noise';

// Nav, FAQ, contact form and the other shared page behaviour.
import './ui.js';

gsap.registerPlugin(ScrollTrigger);

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* -------------------------------------------------------------------------
 * Loader
 *
 * The overlay covers the whole page, so anything that can stop it from being
 * dismissed takes the site down with it. Hide it on the first of: models
 * ready, window load, or a hard timeout.
 * ---------------------------------------------------------------------- */
let loaderHidden = false;

function hideLoader() {
  if (loaderHidden) return;
  loaderHidden = true;

  const overlay = document.getElementById('loader-overlay');
  if (!overlay) return;

  overlay.style.opacity = '0';
  overlay.style.visibility = 'hidden';
  setTimeout(() => overlay.remove(), 800);
}

// Grace period so the models usually win the race, then a hard ceiling.
window.addEventListener('load', () => setTimeout(hideLoader, 1200));
setTimeout(hideLoader, 8000);

/* -------------------------------------------------------------------------
 * Reduced motion: skip the WebGL work entirely.
 * The stylesheet lays the hero out as a normal stacked section in this mode.
 * ---------------------------------------------------------------------- */
if (prefersReducedMotion) {
  hideLoader();
} else {
  initHeroScene();

  const initSceneWidgets = () => {
    initProjectsSphere();
    initAboutBlob();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSceneWidgets, { once: true });
  } else {
    /*
     * A module script is deferred, so readyState is already "interactive"
     * here and this branch is the one that actually runs. Calling straight
     * through would execute these functions while module evaluation is still
     * on the stack — and the `const` config they read is declared further
     * down this file, so it is still in its temporal dead zone. Deferring by
     * a microtask lets evaluation finish first.
     */
    queueMicrotask(initSceneWidgets);
  }
}

function initHeroScene() {
  // 1. Scene Setup
  const canvas = document.querySelector('#webgl-container');
  if (!canvas) return;

  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.z = 5;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  } catch {
    // No WebGL (old device, blocked driver) — the page still reads fine without it.
    canvas.style.display = 'none';
    hideLoader();
    return;
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  // Environment map for metallic reflections
  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;

  // 2. Lighting
  scene.add(new THREE.AmbientLight(0xffffff, 1.5));

  const dirLight1 = new THREE.DirectionalLight(0xffffff, 4);
  dirLight1.position.set(5, 5, 5);
  scene.add(dirLight1);

  const dirLight2 = new THREE.DirectionalLight(0x8a2be2, 8); // purple tint for the metal
  dirLight2.position.set(-5, 3, -5);
  scene.add(dirLight2);

  const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 2);
  hemiLight.position.set(0, 10, 0);
  scene.add(hemiLight);

  // 3. Load Models
  const loader = new GLTFLoader();
  // The .glb files are meshopt-compressed (110MB -> 8.5MB); without this the
  // loader cannot read their buffer views.
  loader.setMeshoptDecoder(MeshoptDecoder);
  let model;
  let model3;

  loader.load(
    './assets/model.glb',
    (gltf) => {
      model = gltf.scene;

      centerObject(model);

      // Ultra-polished liquid chrome
      model.traverse((child) => {
        if (!child.isMesh) return;
        ensureNormals(child.geometry);
        child.material = new THREE.MeshPhysicalMaterial({
          color: 0xffffff,
          metalness: 1.0,
          roughness: 0.08,
          clearcoat: 1.0,
          clearcoatRoughness: 0.03,
          envMapIntensity: 3.5,
          flatShading: false,
        });
      });

      scene.add(model);

      // Initial state
      model.scale.set(3.5, 3.5, 3.5);
      model.position.z = -2;
      model.position.y = -2;
      model.rotation.x = 0.1;
      model.rotation.y = 0;

      // Load the world model used for the background zoom section
      loader.load(
        './assets/model4.glb',
        (gltf3) => {
          model3 = gltf3.scene;

          centerObject(model3);

          model3.traverse((child) => {
            if (!child.isMesh || !child.material) return;
            ensureNormals(child.geometry);
            child.material.color.setHex(0xffffff);
            child.material.metalness = 1.0;
            child.material.roughness = 0.12;
            child.material.transparent = true;
            child.material.opacity = 0; // fades in during the scroll
            child.material.envMapIntensity = 4.0;
            child.material.needsUpdate = true;
          });

          model3.scale.set(0.01, 0.01, 0.01);
          model3.position.set(0, 0, -5);
          model3.rotation.set(0.15, 0, 0);

          scene.add(model3);

          setupScrollAnimations(model, model3);
          hideLoader();
        },
        undefined,
        (error) => {
          console.error('Error loading model4.glb:', error);
          setupScrollAnimations(model, null);
          hideLoader();
        }
      );
    },
    undefined,
    (error) => {
      console.error('Error loading model.glb:', error);
      hideLoader();
    }
  );

  // 4. Mouse parallax + render loop
  const mouse = { x: 0, y: 0 };
  const targetMouse = { x: 0, y: 0 };

  window.addEventListener(
    'mousemove',
    (event) => {
      targetMouse.x = (event.clientX / window.innerWidth) * 2 - 1;
      targetMouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    },
    { passive: true }
  );

  let frameId = null;
  const start = performance.now();

  function tick() {
    frameId = window.requestAnimationFrame(tick);
    const elapsed = (performance.now() - start) / 1000;

    mouse.x += (targetMouse.x - mouse.x) * 0.05;
    mouse.y += (targetMouse.y - mouse.y) * 0.05;

    camera.position.x = mouse.x * 0.6;
    camera.position.y = mouse.y * 0.4;
    camera.lookAt(0, 0, 0);

    if (model && model.visible) {
      model.rotation.y = mouse.x * 0.15;
      model.rotation.x = -mouse.y * 0.15;
    }

    if (model3) {
      model3.rotation.y = Math.sin(elapsed * 0.4) * 0.3 + mouse.x * 0.15;
      model3.rotation.x = 0.15 - mouse.y * 0.1;
    }

    renderer.render(scene, camera);
  }

  // Don't burn battery rendering to a tab nobody is looking at.
  function play() {
    if (frameId === null) tick();
  }
  function pause() {
    if (frameId !== null) {
      window.cancelAnimationFrame(frameId);
      frameId = null;
    }
  }

  /*
   * Render only while the hero is actually on screen. It used to run a
   * full-viewport 3D scene every frame for the entire page, which starved
   * the particle sphere further down.
   */
  let heroOnScreen = true;
  const sync = () => (heroOnScreen && !document.hidden ? play() : pause());

  new IntersectionObserver(
    ([entry]) => {
      heroOnScreen = entry.isIntersecting;
      sync();
    },
    { rootMargin: '100px' }
  ).observe(canvas.parentElement?.querySelector('#hero') || document.querySelector('#hero') || canvas);

  document.addEventListener('visibilitychange', sync);
  play();

  // 5. Resize
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    ScrollTrigger.refresh();
  });
}

/**
 * The GLBs are meshopt-quantized, so their normal attribute arrives as a
 * normalized Int8Array. computeVertexNormals() zeroes that attribute and then
 * accumulates float face-normal sums back through setXYZ — which truncates to
 * int8 steps, so every partial sum rounds to zero. The result is (0,0,0)
 * normals and a pure-metal material shading solid black.
 *
 * The exported normals are already correct, so only compute when missing.
 */
function ensureNormals(geometry) {
  if (!geometry) return;
  if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
}

function centerObject(object) {
  const box = new THREE.Box3().setFromObject(object);
  const center = box.getCenter(new THREE.Vector3());
  object.position.x -= center.x;
  object.position.y -= center.y;
  object.position.z -= center.z;
}

/* -------------------------------------------------------------------------
 * GSAP ScrollTrigger animations
 * ---------------------------------------------------------------------- */
function setupScrollAnimations(model, model3) {
  if (!model) return;

  const tl = gsap.timeline({
    scrollTrigger: {
      trigger: '#hero',
      start: 'top top',
      // A shorter pin on phones: 2500px of scroll is a long time to be stuck.
      end: () => `+=${window.innerWidth < 768 ? 1500 : 2500}`,
      scrub: 1.5,
      pin: true,
      anticipatePin: 1,
      // No invalidateOnRefresh here: on a pinned + scrubbed timeline it
      // re-records from-values out of whatever state the scrub is mid-way
      // through, which leaves the whole sequence stuck at progress 0.
    },
  });

  // --- Hero fade ---
  tl.to('.hero-content', { y: -100, opacity: 0, duration: 1.5 }, 0);
  // The wordmark sits behind the model, so it lifts away with the copy.
  tl.to('.hero-title', { y: -140, opacity: 0, duration: 1.5 }, 0);
  tl.to('.scroll-indicator', { opacity: 0, duration: 1 }, 0);
  // (the canvas now starts at full opacity, so there is nothing to ramp up)

  // --- Zoom through the hole ---
  tl.to(model.scale, { x: 150, y: 150, z: 150, duration: 6 }, 0);
  tl.to(model.position, { z: 15, y: -80, x: 0, duration: 6 }, 0);
  tl.to(model.rotation, { x: 0, y: 0, z: 0, duration: 6 }, 0);
  tl.set(model, { visible: false }, 6);

  // --- Background world model ---
  if (model3) {
    model3.traverse((child) => {
      if (child.isMesh && child.material) {
        tl.to(child.material, { opacity: 0.9, duration: 2 }, 2);
      }
    });
    tl.to(model3.scale, { x: 6.5, y: 6.5, z: 6.5, duration: 5 }, 2);
    tl.to(model3.position, { x: 0, y: 0, z: -0.5, duration: 5 }, 2);
  }

  // --- "See For Yourself" reveal, scrubbed with the zoom ---
  gsap.set('.hole-text', { scale: 0.5 });
  tl.to('.hole-text', { opacity: 0.3, duration: 1 }, 1.5);
  tl.to('.hole-text', { opacity: 1, scale: 1, duration: 3.5 }, 2.5);

  /*
   * Reveal the testimonial by growing its grid row from 0fr to 1fr. The whole
   * stage is centre-anchored, so the heading rises on its own as the row
   * expands. This replaces a fixed `top: 35%` nudge on the heading, which was
   * far less than the card's height and left the two overlapping.
   */
  tl.to('.hole-stage', { gridTemplateRows: 'auto 1fr', duration: 2 }, 6.5);
  tl.to('.cards-container', { opacity: 1, pointerEvents: 'auto', duration: 2 }, 7);

  // --- World model drifts up and out once the testimonial has landed ---
  if (model3) {
    tl.to(model3.position, { y: 14, duration: 2.5, ease: 'power2.in' }, 9);
    tl.to(model3.scale, { x: 2.5, y: 2.5, z: 2.5, duration: 2.5, ease: 'power2.in' }, 9);
    model3.traverse((child) => {
      if (child.isMesh && child.material) {
        tl.to(child.material, { opacity: 0, duration: 2, ease: 'power2.in' }, 9.3);
      }
    });
  }

  tl.to({}, { duration: 0.6 }); // hold before unpinning

  // Everything below replays when scrolled back through.
  ScrollTrigger.defaults({
    toggleActions: 'play none none reverse',
    refreshPriority: -1,
  });

  // 1. PROJECTS — pinned page, one project at a time
  setupProjectsSequence();

  // 2. CAPABILITIES
  reveal('#concepts h2', { trigger: '#concepts', start: 'top 70%' },
    { y: 50, rotateX: 15, blur: 10 }, { duration: 1.2, ease: 'power4.out' });
  reveal('#concepts .section-subtext', { trigger: '#concepts', start: 'top 70%' },
    { y: 25, blur: 5 }, { duration: 0.8, delay: 0.2 });

  const conceptCards = document.querySelectorAll('.concept-card');
  if (conceptCards.length) {
    const at = { trigger: '.concepts-grid', start: 'top 80%' };
    // Six cards, so a tighter step — 0.18 made the last one arrive a second late.
    const step = 0.09;

    gsap.fromTo(conceptCards,
      { opacity: 0, y: 60, scale: 0.9, filter: 'blur(10px)' },
      { scrollTrigger: at, opacity: 1, y: 0, scale: 1, filter: 'blur(0px)', duration: 1.1, ease: 'power3.out', stagger: step }
    );

    conceptCards.forEach((card, index) => {
      reveal(card.querySelector('h4'), at, { y: 20, blur: 4 }, { duration: 0.7, delay: index * step + 0.2 });
    });

    const tailDelay = conceptCards.length * step + 0.2;
    reveal('.concepts-action-text', at, { y: 20, blur: 4 }, { duration: 0.6, delay: tailDelay });
    reveal('.concepts-action .btn-outline', at, { y: 25, scale: 0.9 },
      { duration: 0.7, ease: 'back.out(1.4)', delay: tailDelay + 0.15 });
  }

  // 3. ABOUT
  const aboutHeader = { trigger: '.about-header', start: 'top 65%' };
  reveal('.about-title-top', aboutHeader, { y: 55, skewY: 4, blur: 10 }, { duration: 1.1, ease: 'power4.out' });
  reveal('.about-title-bottom', aboutHeader, { y: 55, skewY: 4, blur: 10 }, { duration: 1.1, ease: 'power4.out', delay: 0.2 });

  const aboutBody = { trigger: '.about-image', start: 'top 70%' };
  reveal('.about-image', aboutBody, { scale: 0.9, x: -40, blur: 10 }, { duration: 1.2, ease: 'power3.out' });
  reveal('.about-content h3', aboutBody, { y: 35, skewY: 2, blur: 6 }, { duration: 0.8, delay: 0.25 });

  const aboutParagraphs = document.querySelectorAll('.about-content p');
  gsap.fromTo(aboutParagraphs,
    { opacity: 0, y: 25, filter: 'blur(5px)' },
    { scrollTrigger: aboutBody, opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.8, stagger: 0.18, delay: 0.45 }
  );

  reveal('.about-content .project-link', aboutBody, { x: -20, blur: 4 },
    { duration: 0.6, delay: 0.45 + aboutParagraphs.length * 0.18 + 0.2 });

  // 4. CONTACT
  reveal('#contact h2', { trigger: '#contact', start: 'top 70%' },
    { y: 50, rotateX: 15, blur: 10 }, { duration: 1.1, ease: 'power4.out' });
  reveal('#contact .contact-subtext', { trigger: '#contact', start: 'top 70%' },
    { y: 25, blur: 5 }, { duration: 0.7, delay: 0.2 });

  gsap.fromTo('.contact-detail-link',
    { opacity: 0, x: -35, filter: 'blur(6px)' },
    { scrollTrigger: { trigger: '.contact-grid', start: 'top 65%' }, opacity: 1, x: 0, filter: 'blur(0px)', duration: 0.7, stagger: 0.12 }
  );

  // NOTE: this used to point at `.contact-form-container`, which has never
  // existed in the markup — the ScrollTrigger never fired and the whole form
  // sat at opacity 0 forever.
  const formTrigger = { trigger: '.contact-form', start: 'top 85%' };
  const inputGroups = document.querySelectorAll('.input-group');

  gsap.fromTo(inputGroups,
    { opacity: 0, y: 25, filter: 'blur(4px)' },
    { scrollTrigger: formTrigger, opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.6, stagger: 0.1, delay: 0.2 }
  );

  reveal('.contact-form .btn', formTrigger, { y: 25, scale: 0.94 },
    { duration: 0.7, ease: 'power3.out', delay: 0.2 + inputGroups.length * 0.1 + 0.4 });

  // 5. FAQ
  reveal('#faq h2', { trigger: '#faq', start: 'top 70%' },
    { y: 50, rotateX: 15, blur: 10 }, { duration: 1.1, ease: 'power4.out' });

  gsap.fromTo('.faq-item',
    { opacity: 0, y: 35, filter: 'blur(6px)' },
    { scrollTrigger: { trigger: '.faq-list', start: 'top 75%' }, opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.7, stagger: 0.15 }
  );

  // 6. FOOTER
  const footerCols = document.querySelectorAll('.footer-col');
  const footerAt = { trigger: 'footer', start: 'top 80%' };

  gsap.fromTo(footerCols,
    { opacity: 0, y: 45, filter: 'blur(6px)' },
    { scrollTrigger: footerAt, opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.8, stagger: 0.18 }
  );

  footerCols.forEach((col, index) => {
    gsap.fromTo(col.querySelectorAll('a'),
      { opacity: 0, y: 15, filter: 'blur(3px)' },
      { scrollTrigger: footerAt, opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.5, stagger: 0.06, delay: 0.1 + index * 0.18 }
    );
  });

  reveal('.footer-bottom', footerAt, { blur: 4 }, { duration: 0.6, delay: 0.3 + footerCols.length * 0.18 });
  reveal('.scroll-to-top', footerAt, { scale: 0.5 }, { duration: 0.7, ease: 'back.out(1.6)', delay: 0.5 });

  ScrollTrigger.refresh();

  // Section heights shift when Moonwalk swaps in, so recalculate the triggers
  // once the fonts have actually settled.
  document.fonts?.ready.then(() => ScrollTrigger.refresh());
}

/**
 * Projects as a single pinned page.
 *
 * The stage is pinned for `HOLD` units of scroll per project; the chrome
 * figure stays fixed dead centre while each project cross-fades through in
 * front of it. Slides share one grid cell (see .project-slide) so only
 * opacity and a small y offset animate — no layout work per frame.
 */
function setupProjectsSequence() {
  const stage = document.querySelector('.projects-stage');
  const slides = gsap.utils.toArray('.project-slide');
  if (!stage || slides.length === 0) return;

  const counter = document.querySelector('.projects-current');
  const barFill = document.querySelector('.projects-bar-fill');

  const HOLD = 1; // timeline units each project stays on screen
  const FADE = 0.5;
  // Scroll distance per project. Shorter on phones so the pin isn't a slog.
  const perSlide = () => (window.innerWidth < 768 ? 620 : 900);

  gsap.set(slides, { opacity: 0, y: 60 });
  gsap.set(slides[0], { opacity: 1, y: 0 });

  let active = -1;
  const setActive = (index) => {
    if (index === active) return;
    active = index;
    if (counter) counter.textContent = String(index + 1);
    slides.forEach((slide, i) => slide.classList.toggle('is-active', i === index));
    // Background sphere slides to a different spot for each project.
    setProjectsSpherePose(index);
  };
  setActive(0);

  const tl = gsap.timeline({
    scrollTrigger: {
      trigger: '#projects',
      start: 'top top',
      end: () => `+=${slides.length * perSlide()}`,
      scrub: 1,
      pin: stage,
      anticipatePin: 1,
      onUpdate: (self) => {
        setActive(Math.min(slides.length - 1, Math.floor(self.progress * slides.length)));
        if (barFill) barFill.style.transform = `scaleX(${self.progress})`;
      },
    },
  });

  slides.forEach((slide, i) => {
    if (i === 0) return;
    const at = i * HOLD - FADE / 2;
    tl.to(slides[i - 1], { opacity: 0, y: -60, duration: FADE, ease: 'power2.in' }, at);
    tl.to(slide, { opacity: 1, y: 0, duration: FADE, ease: 'power2.out' }, at);
  });

  // Hold the last project on screen before unpinning.
  tl.to({}, { duration: HOLD }, (slides.length - 1) * HOLD);
}

/**
 * Scroll-triggered fade-in. `from` takes plain transform values plus an
 * optional `blur` in pixels; everything animates back to its natural state.
 */
function reveal(target, scrollTrigger, from = {}, to = {}) {
  if (!target || (typeof target === 'string' && !document.querySelector(target))) return;

  const { blur, ...transforms } = from;
  const fromVars = { opacity: 0, ...transforms };
  const toVars = { scrollTrigger, opacity: 1, ...to };

  Object.keys(transforms).forEach((key) => {
    toVars[key] = key === 'scale' ? 1 : 0;
  });

  if (blur) {
    fromVars.filter = `blur(${blur}px)`;
    toVars.filter = 'blur(0px)';
  }

  gsap.fromTo(target, fromVars, toVars);
}

/* -------------------------------------------------------------------------
 * Projects background — animated particle sphere
 *
 * The supplied sketch, kept as-is: IcosahedronGeometry point cloud,
 * simplex noise4D displacement, per-vertex three-stop colour ramp, spring
 * physics for the cursor push, PointsMaterial with additive blending.
 *
 * Only two things differ from the original, both forced by running inside a
 * page rather than a standalone demo:
 *   - scratch Vector3/Color objects are hoisted out of the loop instead of
 *     being allocated per vertex per frame (identical maths, no garbage)
 *   - SPHERE_PARAMS.segments is 50 rather than 80; see the note on it below
 * ---------------------------------------------------------------------- */
const SPHERE_PARAMS = {
  radius: 10,
  /*
   * The sketch used 80. IcosahedronGeometry detail d emits 20 * (d+1)^2
   * triangles, so 80 is ~394,000 points, and this loop recomputes every one
   * of them — a noise4D call each — on the main thread every frame.
   * Benchmarked warm: 50 costs ~46ms/frame (~22fps), 30 costs ~13ms (~75fps).
   * The colour ramp also moved to the GPU (see onBeforeCompile below), which
   * removes a Color lerp per point and halves the per-frame buffer upload.
   * Raise this if you would rather have density than frames.
   */
  segments: 30,
  noiseScale: 2.0,
  noiseSpeed: 0.4,
  colorTop: 0xe0e0e0,    // Silver
  colorMiddle: 0x500090, // Dark Purple
  colorBottom: 0x150030, // Very Dark Purple
  mouseRadius: 4.0,
  mouseForce: 3.0,
};

// Where the sphere sits for project 1, 2 and 3 respectively.
const SPHERE_SLIDE_POSITIONS = [
  { x: 7.5, y: -1.5 },
  { x: -7.5, y: 1.5 },
  { x: 0.5, y: -7 },
];

let projectsSphereGroup = null;

/** Slides the sphere to the pose for the given project index. */
function setProjectsSpherePose(index) {
  if (!projectsSphereGroup) return;
  const pose = SPHERE_SLIDE_POSITIONS[index % SPHERE_SLIDE_POSITIONS.length];
  gsap.to(projectsSphereGroup.position, {
    x: pose.x,
    y: pose.y,
    duration: 1.4,
    ease: 'power3.inOut',
    overwrite: true,
  });
}

function initProjectsSphere() {
  const container = document.querySelector('#projects-sphere');
  if (!container) return;

  const params = SPHERE_PARAMS;
  const width = container.clientWidth || window.innerWidth;
  const height = container.clientHeight || window.innerHeight;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x000000, 0.03);

  const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
  camera.position.z = 35;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch (error) {
    console.error('Projects sphere: no WebGL context', error);
    return;
  }

  // 1.5 rather than 2: ~44% fewer fragments on a retina display, and this is
  // a soft additive point cloud where the extra density is invisible.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(width, height);
  container.appendChild(renderer.domElement);

  const geometry = new THREE.IcosahedronGeometry(params.radius, params.segments);
  const count = geometry.attributes.position.count;

  const originalPositions = geometry.attributes.position.array.slice();
  const velocities = new Float32Array(count).fill(0);

  const material = new THREE.PointsMaterial({
    size: 0.12,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  /*
   * The three-stop height gradient is a pure function of the deformed y, so
   * it belongs on the GPU. Doing it per point in JS cost a Color copy+lerp
   * each frame and a second 1.8MB buffer upload; this is the same maths in
   * the vertex shader with neither.
   */
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uColorTop = { value: new THREE.Color(params.colorTop) };
    shader.uniforms.uColorMiddle = { value: new THREE.Color(params.colorMiddle) };
    shader.uniforms.uColorBottom = { value: new THREE.Color(params.colorBottom) };
    shader.uniforms.uMaxHeight = { value: params.radius + params.noiseScale };

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform vec3 uColorTop;
        uniform vec3 uColorMiddle;
        uniform vec3 uColorBottom;
        uniform float uMaxHeight;
        varying vec3 vGradColor;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float gradH = clamp((position.y + uMaxHeight) / (uMaxHeight * 2.0), 0.0, 1.0);
        vGradColor = gradH > 0.5
          ? mix(uColorMiddle, uColorTop, (gradH - 0.5) * 2.0)
          : mix(uColorBottom, uColorMiddle, gradH * 2.0);`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n varying vec3 vGradColor;')
      .replace(
        'vec4 diffuseColor = vec4( diffuse, opacity );',
        'vec4 diffuseColor = vec4( vGradColor, opacity );'
      );
  };

  const particles = new THREE.Points(geometry, material);

  // Wrapped so the pose tween can move the cloud without fighting its spin.
  const group = new THREE.Group();
  group.add(particles);
  scene.add(group);
  projectsSphereGroup = group;

  const simplex = new SimplexNoise();
  const clock = new THREE.Clock();

  // Mouse tracking
  const mouse = new THREE.Vector2(-9999, -9999);
  const raycaster = new THREE.Raycaster();
  raycaster.params.Points.threshold = 0.5;
  const targetPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const intersectPoint = new THREE.Vector3();

  // Scratch objects, reused every vertex.
  const originalVector = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const vertexWorldPos = new THREE.Vector3();

  window.addEventListener(
    'mousemove',
    (event) => {
      const rect = container.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    },
    { passive: true }
  );

  let onScreen = false;
  let frameId = null;

  function animate() {
    frameId = requestAnimationFrame(animate);

    const time = clock.getElapsedTime() * params.noiseSpeed;

    const positions = geometry.attributes.position.array;

    raycaster.setFromCamera(mouse, camera);
    raycaster.ray.intersectPlane(targetPlane, intersectPoint);
    if (mouse.x === -9999) intersectPoint.set(0, 0, 9999);

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      const ox = originalPositions[i3];
      const oy = originalPositions[i3 + 1];
      const oz = originalPositions[i3 + 2];

      originalVector.set(ox, oy, oz);
      direction.copy(originalVector).normalize();

      // 1. Base noise displacement
      const noiseFactor = simplex.noise4D(ox * 0.1, oy * 0.1, oz * 0.1, time);
      const baseDisplacement = params.noiseScale * (noiseFactor + 0.5);

      // 2. Mouse interaction
      vertexWorldPos.copy(originalVector).applyMatrix4(particles.matrixWorld);
      const dx = vertexWorldPos.x - intersectPoint.x;
      const dy = vertexWorldPos.y - intersectPoint.y;
      const distToMouse = Math.sqrt(dx * dx + dy * dy);

      if (distToMouse < params.mouseRadius) {
        const pushStrength = (params.mouseRadius - distToMouse) / params.mouseRadius;
        velocities[i] += pushStrength * 0.2;
      }

      velocities[i] += (0 - velocities[i]) * 0.1; // spring back
      velocities[i] *= 0.85; // damping

      const mouseDisplacement = velocities[i] * params.mouseForce;

      // 3. Combine, pushing inwards where the cursor is
      const totalDisplacement = baseDisplacement - mouseDisplacement;

      const nx = ox + direction.x * totalDisplacement;
      const ny = oy + direction.y * totalDisplacement;
      const nz = oz + direction.z * totalDisplacement;

      positions[i3] = nx;
      positions[i3 + 1] = ny;
      positions[i3 + 2] = nz;
    }

    geometry.attributes.position.needsUpdate = true;

    particles.rotation.y += 0.002;
    particles.rotation.x += 0.001;

    renderer.render(scene, camera);
  }

  function sync() {
    const shouldRun = onScreen && !document.hidden;
    if (shouldRun && frameId === null) animate();
    else if (!shouldRun && frameId !== null) {
      cancelAnimationFrame(frameId);
      frameId = null;
    }
  }

  // Head start so it is already running by the time the section arrives.
  new IntersectionObserver(
    ([entry]) => {
      onScreen = entry.isIntersecting;
      sync();
    },
    { rootMargin: '300px' }
  ).observe(container);

  document.addEventListener('visibilitychange', sync);

  const startPose = SPHERE_SLIDE_POSITIONS[0];
  group.position.set(startPose.x, startPose.y, 0);

  window.addEventListener('resize', () => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (!w || !h) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h);
  });
}

/* -------------------------------------------------------------------------
 * About section — iridescent organic blob
 *
 * The supplied sketch, kept as-is: a 128×128 sphere deformed every frame by
 * two octaves of simplex noise, normals recomputed so the lighting follows
 * the shape, and a fresnel shader ramping dark → blue → hot pink with a
 * specular highlight and film grain.
 *
 * Differences from the original, both forced by running inside a page:
 *   - the per-vertex Vector3 clone is hoisted out of the loop (same maths,
 *     no ~17k allocations per frame)
 *   - it renders only while on screen and the tab is visible
 * ---------------------------------------------------------------------- */
const BLOB_VERTEX_SHADER = `
  varying vec3 vNormal;
  varying vec3 vViewPosition;

  void main() {
    vNormal = normalize(normalMatrix * normal);

    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vViewPosition = -mvPosition.xyz;

    gl_Position = projectionMatrix * mvPosition;
  }
`;

const BLOB_FRAGMENT_SHADER = `
  uniform float uTime;
  varying vec3 vNormal;
  varying vec3 vViewPosition;

  float random(vec2 st) {
    return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
  }

  void main() {
    vec3 normal = normalize(vNormal);
    vec3 viewDir = normalize(vViewPosition);

    // Fresnel: 1.0 at the silhouette, 0.0 facing the camera.
    float dotProduct = max(dot(viewDir, normal), 0.0);
    float fresnel = clamp(1.0 - dotProduct, 0.0, 1.0);
    fresnel = pow(fresnel, 1.8);

    vec3 colDark = vec3(0.02, 0.02, 0.05);
    vec3 colBlue = vec3(0.1, 0.1, 1.0);
    vec3 colPink = vec3(1.0, 0.0, 0.6);

    float t1 = smoothstep(0.0, 0.45, fresnel);
    float t2 = smoothstep(0.45, 0.85, fresnel);

    vec3 finalColor = mix(colDark, colBlue, t1);
    finalColor = mix(finalColor, colPink, t2);

    // Glossy highlight
    vec3 lightDir = normalize(vec3(1.0, 1.0, 0.5));
    vec3 halfVector = normalize(lightDir + viewDir);
    float NdotH = max(0.0, dot(normal, halfVector));
    finalColor += pow(NdotH, 64.0) * 0.3 * vec3(0.6, 0.4, 0.8);

    // Film grain
    finalColor += (random(gl_FragCoord.xy) - 0.5) * 0.06;

    gl_FragColor = vec4(finalColor, 1.0);
  }
`;

function initAboutBlob() {
  const container = document.querySelector('#about-blob');
  if (!container) return;

  const width = container.clientWidth || 450;
  const height = container.clientHeight || 540;

  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
  camera.position.z = 6;
  camera.position.y = 0.5; // look slightly down at it

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch (error) {
    console.error('About blob: no WebGL context', error);
    return;
  }

  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  container.appendChild(renderer.domElement);

  // High segment count so the smooth shader has enough vertex data.
  /*
   * 128x128 was 16,641 vertices deformed and re-normalled every frame (~9ms).
   * 72x72 is 5,329 — a third of the cost, and indistinguishable on a shape
   * this smooth at this size.
   */
  const geometry = new THREE.SphereGeometry(2, 72, 72);

  const positionAttribute = geometry.attributes.position;
  const count = positionAttribute.count;

  const originalPositions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    originalPositions[i * 3] = positionAttribute.getX(i);
    originalPositions[i * 3 + 1] = positionAttribute.getY(i);
    originalPositions[i * 3 + 2] = positionAttribute.getZ(i);
  }

  const material = new THREE.ShaderMaterial({
    vertexShader: BLOB_VERTEX_SHADER,
    fragmentShader: BLOB_FRAGMENT_SHADER,
    uniforms: { uTime: { value: 0.0 } },
    wireframe: false,
  });

  const blob = new THREE.Mesh(geometry, material);
  scene.add(blob);

  const simplex = new SimplexNoise();
  const clock = new THREE.Clock();

  // Subtle parallax rotation
  let targetX = 0;
  let targetY = 0;
  let windowHalfX = window.innerWidth / 2;
  let windowHalfY = window.innerHeight / 2;

  document.addEventListener(
    'mousemove',
    (event) => {
      targetX = (event.clientX - windowHalfX) * 0.001;
      targetY = (event.clientY - windowHalfY) * 0.001;
    },
    { passive: true }
  );

  // Scratch vectors, reused every vertex.
  const vertex = new THREE.Vector3();
  const dir = new THREE.Vector3();

  let onScreen = false;
  let frameId = null;

  function animate() {
    frameId = requestAnimationFrame(animate);

    const time = clock.getElapsedTime() * 0.15; // sluggish, liquid feel
    material.uniforms.uTime.value = clock.getElapsedTime();

    // 1. Deform the sphere with multi-octave noise
    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      const ox = originalPositions[i3];
      const oy = originalPositions[i3 + 1];
      const oz = originalPositions[i3 + 2];

      vertex.set(ox, oy, oz);
      dir.copy(vertex).normalize();

      // Large, slow structural waves
      let noise = simplex.noise3D(dir.x * 0.4 + time, dir.y * 0.4, dir.z * 0.4 + time);

      // Smaller, faster secondary ripples
      noise += 0.3 * simplex.noise3D(dir.x * 1.0 - time * 1.5, dir.y * 1.0 + time * 1.5, dir.z * 1.0);

      const displacement = noise * 0.6;

      positionAttribute.setXYZ(
        i,
        ox + dir.x * displacement,
        oy + dir.y * displacement,
        oz + dir.z * displacement
      );
    }

    // 2. Without recomputed normals the shader lighting ignores the new shape.
    positionAttribute.needsUpdate = true;
    geometry.computeVertexNormals();

    // 3. Ease toward the cursor
    blob.rotation.y += 0.05 * (targetX - blob.rotation.y);
    blob.rotation.x += 0.05 * (targetY - blob.rotation.x);

    renderer.render(scene, camera);
  }

  function sync() {
    const shouldRun = onScreen && !document.hidden;
    if (shouldRun && frameId === null) animate();
    else if (!shouldRun && frameId !== null) {
      cancelAnimationFrame(frameId);
      frameId = null;
    }
  }

  new IntersectionObserver(
    ([entry]) => {
      onScreen = entry.isIntersecting;
      sync();
    },
    { rootMargin: '200px' }
  ).observe(container);

  document.addEventListener('visibilitychange', sync);

  window.addEventListener('resize', () => {
    windowHalfX = window.innerWidth / 2;
    windowHalfY = window.innerHeight / 2;

    const w = container.clientWidth;
    const h = container.clientHeight;
    if (!w || !h) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  });
}
