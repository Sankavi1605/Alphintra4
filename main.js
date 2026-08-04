import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

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
