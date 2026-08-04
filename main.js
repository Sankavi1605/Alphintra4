import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

import { pixelRatioFor } from './render-quality.js';
// The hero's purple-horizon background; also used on the Careers page.
import { initHorizonField } from './horizon-field.js';

// Nav, FAQ, contact form and the other shared page behaviour.
import './ui.js';

gsap.registerPlugin(ScrollTrigger);

/*
 * Mobile browsers fire resize every time the URL bar slides in or out, which
 * happens *during* a scroll. Left alone, ScrollTrigger re-measures every pin
 * mid-gesture and the whole page stutters. This tells it to ignore height-only
 * changes on touch devices, which is exactly that case.
 */
ScrollTrigger.config({ ignoreMobileResize: true });

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* -------------------------------------------------------------------------
 * Loader
 *
 * The overlay covers the whole page, so anything that can stop it from being
 * dismissed takes the site down with it. It comes down on the first of: the
 * models being ready and their scroll animations wired, a load error, or a
 * hard timeout.
 *
 * There is deliberately no `window.load` dismissal. That event fires when the
 * markup, CSS and images are done, which is well before 8.5MB of .glb — so it
 * used to reveal a scrollable page whose hero animations did not exist yet.
 * ---------------------------------------------------------------------- */
let loaderHidden = false;

function hideLoader() {
  if (loaderHidden) return;
  loaderHidden = true;

  // Give the scrollbar back, and re-assert the top in case the browser
  // restored a position before the inline script could opt out of that.
  document.body.classList.remove('is-loading');
  window.scrollTo(0, 0);
  // The document was unscrollable until a moment ago; let every trigger
  // re-measure against the real page height before the first scroll.
  ScrollTrigger.refresh();

  const overlay = document.getElementById('loader-overlay');
  if (!overlay) return;

  overlay.style.opacity = '0';
  overlay.style.visibility = 'hidden';
  setTimeout(() => overlay.remove(), 800);
}

/*
 * Hard ceiling. On a slow connection this can still fire before the models
 * arrive, which is survivable now only because the page is pinned to the top:
 * the model's opening pose is the right one for the hero, so there is nothing
 * to snap away from when the triggers are finally created.
 */
setTimeout(hideLoader, 8000);

/* -------------------------------------------------------------------------
 * Reduced motion: skip the WebGL work entirely.
 * The stylesheet lays the hero out as a normal stacked section in this mode.
 * ---------------------------------------------------------------------- */
if (prefersReducedMotion) {
  hideLoader();
  /* Still paint one static frame so those sections are not empty. */
  queueMicrotask(initAboutField);
  queueMicrotask(initCapabilityField);
  queueMicrotask(initContactField);
} else {
  initHeroScene();

  /*
   * A module script is deferred, so readyState is already "interactive" here.
   * Calling straight through would run this while module evaluation is still
   * on the stack, and the shader consts it reads are declared further down the
   * file — still in their temporal dead zone. A microtask lets evaluation finish.
   */
  queueMicrotask(initHorizonField);
  queueMicrotask(initAboutField);
  queueMicrotask(initCapabilityField);
  queueMicrotask(initContactField);
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

  /*
   * Framing. The camera's 45deg FOV is vertical, so on a portrait phone the
   * horizontal extent collapses to aspect * that — and the model, posed for a
   * landscape frame, runs straight off both sides. Easing the camera back
   * shrinks it to fit without the barrel distortion a wider FOV would add.
   *
   * Only ~60% of the way: fully matching the desktop framing needs z≈15 at a
   * phone's aspect, which leaves the model a speck in a sea of empty hero.
   * The scroll timeline animates model.scale/position and never the camera, so
   * owning z here cannot fight it.
   */
  const BASE_CAMERA_Z = 5;
  const PORTRAIT_PULLBACK = 0.6;
  const MAX_CAMERA_Z = 9;

  function frameCamera() {
    const aspect = window.innerWidth / window.innerHeight;
    camera.aspect = aspect;
    camera.position.z =
      aspect >= 1
        ? BASE_CAMERA_Z
        : Math.min(MAX_CAMERA_Z, BASE_CAMERA_Z * (1 + (1 / aspect - 1) * PORTRAIT_PULLBACK));
    camera.updateProjectionMatrix();
  }
  frameCamera();

  renderer.setPixelRatio(pixelRatioFor(2, 1.5));
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
    frameCamera();
    renderer.setPixelRatio(pixelRatioFor(2, 1.5));
    renderer.setSize(window.innerWidth, window.innerHeight);
    /*
     * No ScrollTrigger.refresh() here. ScrollTrigger already listens for
     * resize itself, so this was doing the most expensive work on the page
     * twice — and on mobile, where the URL bar sliding in and out fires resize
     * continuously *during* a scroll, it re-measured every trigger mid-gesture.
     * ignoreMobileResize (set at the top of this file) handles that case.
     */
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

  /*
   * autoAlpha, not opacity: it pairs opacity with visibility, so an off-screen
   * slide is dropped from paint and compositing entirely instead of being
   * blended in at zero every frame — three full-bleed screenshots' worth of
   * texture per frame. It also takes the hidden slides' links out of the tab
   * order, which plain opacity:0 left reachable.
   */
  gsap.set(slides, { autoAlpha: 0, y: 60 });
  gsap.set(slides[0], { autoAlpha: 1, y: 0 });

  let active = -1;
  const setActive = (index) => {
    if (index === active) return;
    active = index;
    if (counter) counter.textContent = String(index + 1);
    slides.forEach((slide, i) => slide.classList.toggle('is-active', i === index));
  };
  setActive(0);

  /*
   * quickSetter resolves the target and property once, so the scrub writes a
   * cached transform instead of re-parsing a template string into style.cssText
   * on every scroll tick.
   */
  const setBar = barFill ? gsap.quickSetter(barFill, 'scaleX') : null;

  const tl = gsap.timeline({
    scrollTrigger: {
      trigger: '#projects',
      start: 'top top',
      end: () => `+=${slides.length * perSlide()}`,
      scrub: 1,
      pin: stage,
      anticipatePin: 1,
      // Re-measure on resize instead of keeping the first layout's numbers.
      invalidateOnRefresh: true,
      onUpdate: (self) => {
        setActive(Math.min(slides.length - 1, Math.floor(self.progress * slides.length)));
        if (setBar) setBar(self.progress);
      },
    },
  });

  slides.forEach((slide, i) => {
    if (i === 0) return;
    const at = i * HOLD - FADE / 2;
    // force3D keeps both slides on their own compositor layer for the whole
    // crossfade, so the browser cannot drop them back to CPU paint mid-tween.
    tl.to(slides[i - 1], { autoAlpha: 0, y: -60, duration: FADE, ease: 'power2.in', force3D: true }, at);
    tl.to(slide, { autoAlpha: 1, y: 0, duration: FADE, ease: 'power2.out', force3D: true }, at);
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
 * About background — raymarched liquid field with the ALPHINTRA column
 *
 * The supplied sketch, ported from three r128 to the r185 the site runs on.
 * Two passes share one renderer: an SDF blob field on a fullscreen quad, then
 * a perspective scene of canvas-textured letter planes at staggered depths so
 * the word genuinely sits inside the liquid rather than on top of it.
 * ---------------------------------------------------------------------- */
const FIELD_FRAGMENT_SHADER = `
  precision highp float;
  uniform float uTime, uReveal, uSpread;
  uniform vec2  uRes, uPtr;

  float smin(float a, float b, float k){
    float h = clamp(0.5 + 0.5*(b-a)/k, 0.0, 1.0);
    return mix(b, a, h) - k*h*(1.0-h);
  }

  vec3 drift(float seed, float amp){
    return amp * vec3(
      sin(uTime*0.22 + seed),
      cos(uTime*0.17 + seed*1.9),
      sin(uTime*0.13 + seed*2.7)
    );
  }

  float sph(vec3 p, vec3 c, float r){
    c.x *= uSpread;
    return length(p - c) - r;
  }

  /* Round shapes in graded sizes — huge / big / medium / small / tiny.
     Single spheres where the image shows a ball; two spheres with a
     large blend radius where it shows a smooth pear or droplet, so
     every silhouette stays rounded with no lumps.                     */
  float map(vec3 p){
    /* 1 — HUGE pear, top-left: two spheres, very soft blend */
    vec3 o1 = drift(1.0, 0.09);
    float d = sph(p, vec3(-1.50, 2.25, -0.4)+o1, 1.60);
    d = smin(d, sph(p, vec3(-1.10, 0.75, -0.3)+o1, 0.95), 1.10);

    /* 2 — TINY ball, top-right */
    float b2 = sph(p, vec3(0.88, 2.05, -0.2)+drift(2.0,0.06), 0.21);
    d = min(d, b2);

    /* 3 — SMALL ball, upper-centre */
    d = min(d, sph(p, vec3(0.28, 1.45, -0.25)+drift(3.0,0.07), 0.37));

    /* 4 — BIG rounded pod, right: two spheres, soft blend */
    vec3 o4 = drift(4.0, 0.08);
    float b4 = sph(p, vec3(0.75, 0.95, -0.5)+o4, 0.82);
    b4 = smin(b4, sph(p, vec3(1.65, 0.60, -0.6)+o4, 0.72), 0.90);
    d = min(d, b4);

    /* 5 — MEDIUM droplet, centre: round body + soft tip */
    vec3 o5 = drift(5.0, 0.09);
    float b5 = sph(p, vec3(-0.18, 0.12, 0.30)+o5, 0.34);
    b5 = smin(b5, sph(p, vec3(-0.42, 0.42, 0.30)+o5, 0.17), 0.42);
    d = min(d, b5);

    /* 6 — MEDIUM rounded bean, lower-left: two spheres, soft blend */
    vec3 o6 = drift(6.0, 0.08);
    float b6 = sph(p, vec3(-1.00, -0.68, 0.05)+o6, 0.36);
    b6 = smin(b6, sph(p, vec3(-0.74, -1.10, 0.05)+o6, 0.32), 0.52);
    d = min(d, b6);

    /* 7 — SMALL droplet, lower-centre */
    vec3 o7 = drift(7.0, 0.07);
    float b7 = sph(p, vec3(0.34, -0.95, 0.10)+o7, 0.29);
    b7 = smin(b7, sph(p, vec3(0.20, -0.70, 0.10)+o7, 0.13), 0.34);
    d = min(d, b7);

    /* 8 — HUGE ball, right edge: one clean sphere */
    d = min(d, sph(p, vec3(1.90, -0.50, -0.7)+drift(8.0,0.07), 1.10));

    /* 9 — HUGE dome, bottom: two spheres, very soft blend */
    vec3 o9 = drift(9.0, 0.08);
    float b9 = sph(p, vec3(0.35, -2.40, -0.2)+o9, 1.50);
    b9 = smin(b9, sph(p, vec3(-0.60, -2.25, -0.2)+o9, 1.00), 1.00);
    d = min(d, b9);

    return d;
  }

  vec3 normalAt(vec3 p){
    vec2 e = vec2(0.003, 0.0);
    return normalize(vec3(
      map(p+e.xyy)-map(p-e.xyy),
      map(p+e.yxy)-map(p-e.yxy),
      map(p+e.yyx)-map(p-e.yyx)));
  }

  vec3 background(vec2 uv){
    /* near-black plum, faintly warmer up-right, faint indigo low-left */
    float g = smoothstep(-1.2, 1.6, uv.y*0.8 + uv.x*0.35);
    vec3 c = mix(vec3(0.012,0.006,0.022), vec3(0.10,0.012,0.09), pow(g,2.2));
    c += vec3(0.015,0.02,0.07) * smoothstep(0.8,-1.4, uv.y + uv.x*0.5);
    return c;
  }

  void main(){
    vec2 uv = (gl_FragCoord.xy - 0.5*uRes) / min(uRes.x, uRes.y) * 2.0;
    /* frame roughly like the portrait reference */
    uv *= 1.55;

    vec3 ro = vec3(uPtr.x*0.45, uPtr.y*0.35, 5.2);
    vec3 rd = normalize(vec3(uv.x, uv.y, -3.4));
    /* tiny camera yaw with the pointer */
    float yaw = uPtr.x*0.06;
    rd.xz = mat2(cos(yaw),-sin(yaw),sin(yaw),cos(yaw)) * rd.xz;

    vec3 col = background(uv);

    float t = 0.0; float hit = 0.0;
    for(int i=0;i<72;i++){
      vec3 p = ro + rd*t;
      float d = map(p);
      if(d<0.0015){ hit=1.0; break; }
      t += d*0.9;
      if(t>14.0) break;
    }

    if(hit>0.5){
      vec3 p = ro + rd*t;
      vec3 n = normalAt(p);

      vec3 lMag = normalize(vec3( 0.35, 0.95, 0.30)); /* magenta key from above   */
      vec3 lInd = normalize(vec3(-0.45,-0.80, 0.55)); /* indigo fill from below   */

      float dM = pow(max(dot(n,lMag),0.0), 2.2);
      float dI = pow(max(dot(n,lInd),0.0), 2.6);
      float fr = pow(1.0-max(dot(n,-rd),0.0), 3.5);

      /* body is almost black — colour lives on the rims, like the image */
      vec3 s = vec3(0.006,0.003,0.014);
      s += vec3(0.80,0.06,0.52)*dM*0.95;
      s += vec3(0.20,0.24,0.95)*dI*0.85;
      s += mix(vec3(0.55,0.10,0.55), vec3(0.25,0.28,0.9), step(0.0,-n.y)) * fr*0.55;

      vec3 h = normalize(lMag-rd);
      s += vec3(1.0,0.75,0.95)*pow(max(dot(n,h),0.0),60.0)*0.35;

      s = mix(s, background(uv), smoothstep(5.0, 12.0, t));
      col = s;
    }

    /* vignette */
    col *= 1.0 - 0.45*pow(length(uv*vec2(0.55,0.42)), 2.4);
    col *= uReveal;
    col = pow(col, vec3(0.92));
    col += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898,78.233)))*43758.5453)-0.5)/255.0;
    gl_FragColor = vec4(col, 1.0);
  }
`;

function initAboutField() {
  const host = document.querySelector('#about-field');
  if (!host) return;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  } catch (error) {
    console.error('About field: no WebGL context', error);
    return;
  }

  /*
   * The sketch was written against r128, where both texture and output
   * encoding defaulted to linear. r155+ defaults output to sRGB, which would
   * double-brighten a shader that already applies its own pow(col, 0.92).
   * Forcing linear output reproduces the original grade exactly.
   */
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setPixelRatio(pixelRatioFor(1.5, 1));
  renderer.autoClear = false;
  host.appendChild(renderer.domElement);

  /* --- pass 1: the liquid ------------------------------------------------ */
  const bgScene = new THREE.Scene();
  const bgCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const uni = {
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uPtr: { value: new THREE.Vector2(0, 0) },
    uSpread: { value: 1 },
    uReveal: { value: 0 },
  };

  bgScene.add(
    new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        uniforms: uni,
        vertexShader: 'void main(){ gl_Position = vec4(position,1.0); }',
        fragmentShader: FIELD_FRAGMENT_SHADER,
      })
    )
  );

  /* --- pass 2: the word as 3D objects ------------------------------------ */
  const txScene = new THREE.Scene();
  const txCam = new THREE.PerspectiveCamera(38, 1, 0.1, 50);
  txCam.position.z = 6;

  const word = new THREE.Group();
  txScene.add(word);

  function letterTexture(ch, color, weight) {
    const S = 256;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    g.clearRect(0, 0, S, S);
    g.fillStyle = color;
    g.font = `${weight} 168px "Helvetica Neue", Helvetica, Arial, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(ch, S / 2, S / 2 + 8);
    const t = new THREE.CanvasTexture(c);
    t.minFilter = THREE.LinearFilter;
    return t;
  }

  function makeLetter(ch, color, size, x, y, z, additive) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshBasicMaterial({
        map: letterTexture(ch, color, additive ? 300 : 200),
        transparent: true,
        depthWrite: false,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        opacity: 0,
      })
    );
    m.position.set(x, y, z);
    word.add(m);
    return m;
  }

  /* Main column — thin, near-white, evenly spaced down the centre.
     ALPHINTRA is 9 letters where the sketch had 8, so the step is derived
     from the original 3.08 span rather than hard-coded, keeping the column
     the same height and leaving the tail placement below it valid. */
  const MAIN = 'ALPHINTRA';
  const top = 1.62;
  const step = 3.08 / (MAIN.length - 1);
  const mainLetters = [...MAIN].map((ch, i) =>
    makeLetter(ch, 'rgba(240,238,248,0.95)', 0.34, 0, top - i * step, 0.9 + Math.sin(i * 1.7) * 0.25, false)
  );

  /* echo ghosts — the coloured strays around the column */
  const IND = '#4653f0';
  const MAG = '#c9308f';
  const echoes = [
    makeLetter('A', IND, 0.44, 0.62, 1.18, 0.4, true),
    makeLetter('R', IND, 0.46, -0.5, 0.12, -0.6, true),
    makeLetter('A', MAG, 0.5, 1.42, -0.02, 0.2, true),
  ];

  /* tail — the bigger indigo letters descending onto the bottom pod */
  const tails = [
    ['N', -0.1, -1.42, 0.42, 1.1],
    ['T', -0.26, -1.66, 0.56, 1.2],
    ['R', -0.34, -1.94, 0.6, 1.3],
    ['A', -0.1, -2.18, 0.66, 1.4],
  ].map(function (def) {
    return makeLetter(def[0], IND, def[3], def[1], def[2], def[4], true);
  });

  /* --- resize / pointer / loop ------------------------------------------- */
  function resize() {
    const w = host.clientWidth;
    const h = host.clientHeight;
    if (!w || !h) return;

    renderer.setSize(w, h, false);
    uni.uRes.value.set(w * renderer.getPixelRatio(), h * renderer.getPixelRatio());
    uni.uSpread.value = Math.min(Math.max(w / h / 0.56, 1), 2.1);

    txCam.aspect = w / h;
    txCam.updateProjectionMatrix();
    word.scale.setScalar(Math.min(1, h / w + 0.38));

    /*
     * The copy occupies the right half of this section, so on desktop the
     * column shifts into the left half instead of running underneath it.
     */
    const visibleWidth = 2 * txCam.position.z * Math.tan((txCam.fov * Math.PI) / 360) * txCam.aspect;
    word.position.x = w / h > 1.1 ? -visibleWidth * 0.25 : 0;
  }
  /*
   * A one-shot resize() measured the host before layout had settled and left
   * the drawing buffer at 40x2099. Observing the element instead re-syncs on
   * every reflow — font swap, ScrollTrigger pinning, window resize alike.
   */
  resize();
  new ResizeObserver(resize).observe(host);

  const target = { x: 0, y: 0 };
  function fromEvent(e) {
    const r = host.getBoundingClientRect();
    const p = e.touches ? e.touches[0] : e;
    target.x = ((p.clientX - r.left) / r.width - 0.5) * 2;
    target.y = -((p.clientY - r.top) / r.height - 0.5) * 2;
  }
  host.addEventListener('pointermove', fromEvent);
  host.addEventListener('touchmove', fromEvent, { passive: true });
  host.addEventListener('pointerleave', () => {
    target.x = 0;
    target.y = 0;
  });

  const clock = new THREE.Clock();
  let frameId = null;
  let onScreen = false;

  function frame() {
    frameId = requestAnimationFrame(frame);

    const t = clock.getElapsedTime();
    uni.uTime.value = t;

    const p = uni.uPtr.value;
    p.x += (target.x - p.x) * 0.05;
    p.y += (target.y - p.y) * 0.05;

    /* letters parallax with the same pointer as the raymarch camera */
    txCam.position.x = p.x * 0.35;
    txCam.position.y = p.y * 0.28;
    txCam.lookAt(word.position.x, 0, 0);

    /* gentle per-letter float so the word feels suspended in the fluid */
    mainLetters.forEach((m, i) => {
      m.position.x = Math.sin(t * 0.5 + i * 0.9) * 0.015;
    });
    word.rotation.z = Math.sin(t * 0.18) * 0.01;

    renderer.clear();
    renderer.render(bgScene, bgCam);
    renderer.clearDepth();
    renderer.render(txScene, txCam);
  }

  /* One static frame so the section is never blank while paused. */
  function renderOnce() {
    renderer.clear();
    renderer.render(bgScene, bgCam);
    renderer.clearDepth();
    renderer.render(txScene, txCam);
  }

  const all = [...mainLetters, ...echoes, ...tails];
  let entrancePlayed = false;

  function playEntrance() {
    if (entrancePlayed) return;
    entrancePlayed = true;

    gsap.to(uni.uReveal, { value: 1, duration: 1.8, ease: 'power2.inOut' });

    mainLetters.forEach((m, i) => {
      gsap.from(m.position, { y: m.position.y - 0.25, duration: 1.0, delay: 0.4 + i * 0.08, ease: 'power3.out' });
      gsap.to(m.material, { opacity: 0.95, duration: 0.9, delay: 0.4 + i * 0.08 });
    });

    [...echoes, ...tails].forEach((m, i) => {
      gsap.from(m.scale, { x: 0.6, y: 0.6, duration: 1.1, delay: 1.0 + i * 0.1, ease: 'back.out(1.6)' });
      gsap.to(m.material, { opacity: 0.85, duration: 1.0, delay: 1.0 + i * 0.1 });
      gsap.to(m.position, {
        y: m.position.y + (i % 2 ? 0.06 : -0.06),
        x: m.position.x + (i % 3 ? -0.03 : 0.03),
        duration: 5.5 + i * 0.6,
        delay: 2.2,
        repeat: -1,
        yoyo: true,
        ease: 'sine.inOut',
      });
    });
  }

  function sync() {
    const shouldRun = onScreen && !document.hidden;
    if (shouldRun) {
      playEntrance();
      if (frameId === null) frame();
    } else if (frameId !== null) {
      cancelAnimationFrame(frameId);
      frameId = null;
    }
  }

  if (prefersReducedMotion) {
    uni.uReveal.value = 1;
    all.forEach((m) => {
      m.material.opacity = m.material.blending === THREE.AdditiveBlending ? 0.8 : 0.95;
    });
    renderOnce();
    return;
  }

  new IntersectionObserver(
    ([entry]) => {
      onScreen = entry.isIntersecting;
      sync();
    },
    { rootMargin: '200px' }
  ).observe(host);

  document.addEventListener('visibilitychange', sync);
}

/* -------------------------------------------------------------------------
 * Engineering Capabilities background — glass bubbles
 *
 * The supplied sketch, ported from three r128 to r185. Two passes share one
 * renderer: a navy-to-violet gradient quad, then real spheres wearing a
 * fresnel-rim shader. Each sphere is dark glass — near invisible face-on with
 * a razor-thin glowing rim at grazing angles — and additive blending makes the
 * crossings flare white-hot.
 * ---------------------------------------------------------------------- */
const BUBBLE_BG_FRAGMENT_SHADER = `
  precision highp float;
  uniform vec2 uRes; uniform float uReveal;
  void main(){
    vec2 uv = (gl_FragCoord.xy - 0.5*uRes)/min(uRes.x,uRes.y)*2.0;
    float g = smoothstep(-1.3, 1.5, uv.y*0.7 + uv.x*0.45);
    vec3 c = mix(vec3(0.012,0.010,0.045), vec3(0.085,0.030,0.16), pow(g,1.8));
    c = mix(c, vec3(0.005,0.006,0.02), smoothstep(0.2,-1.4, uv.x + uv.y*0.3)); /* darker low-left */
    c *= 1.0 - 0.35*pow(length(uv*vec2(0.5,0.55)),2.2);                         /* vignette      */
    c += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898,78.233)))*43758.5453)-0.5)/255.0;
    gl_FragColor = vec4(c*uReveal, 1.0);
  }
`;

const BUBBLE_VERTEX_SHADER = `
  varying vec3 vN, vW;
  void main(){
    vN = normalize(mat3(modelMatrix) * normal);
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const BUBBLE_RIM_FRAGMENT_SHADER = `
  precision highp float;
  uniform vec3  uColA, uColB, uGlow;
  uniform vec2  uAxis;
  uniform float uIntensity, uReveal, uHaze;
  varying vec3 vN, vW;
  void main(){
    vec3 v = normalize(cameraPosition - vW);
    vec3 n = normalize(vN);
    float fres = clamp(1.0 - dot(n, v), 0.0, 1.0);

    float line = pow(fres, 10.0) * 2.8;   /* the razor rim          */
    float halo = pow(fres,  3.5) * 0.45;  /* soft bloom around it   */

    float t = smoothstep(-0.85, 0.85, dot(normalize(n.xy + vec2(1e-4)), normalize(uAxis)));
    vec3 rimCol = mix(uColA, uColB, t);

    vec3 col = rimCol * (line + halo);
    col += vec3(1.0, 0.96, 0.90) * pow(fres, 22.0) * 1.1; /* white-hot core  */
    col += uGlow * pow(fres, 2.1) * uHaze;                /* interior haze   */

    gl_FragColor = vec4(col * uIntensity * uReveal, 1.0);
  }
`;

function initCapabilityField() {
  const host = document.querySelector('#capability-field');
  if (!host) return;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  } catch (error) {
    console.error('Capability field: no WebGL context', error);
    return;
  }

  /*
   * Same r128 grade as the About field: the rim shader is tuned for linear
   * output, and r155+ would push its additive highlights through an sRGB
   * transfer on top of that and blow the crossings out to flat white.
   */
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setPixelRatio(pixelRatioFor(2, 1.25));
  renderer.autoClear = false;
  host.appendChild(renderer.domElement);

  /* --- pass 1: deep navy to violet gradient + vignette -------------------- */
  const bgScene = new THREE.Scene();
  const bgCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const bgUni = { uRes: { value: new THREE.Vector2(1, 1) }, uReveal: { value: 0 } };

  bgScene.add(
    new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        uniforms: bgUni,
        vertexShader: 'void main(){ gl_Position = vec4(position,1.0); }',
        fragmentShader: BUBBLE_BG_FRAGMENT_SHADER,
      })
    )
  );

  /* --- pass 2: the bubbles ------------------------------------------------ */
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(0, 0, 14);

  const ORANGE = new THREE.Color(1.0, 0.52, 0.13);
  const AMBER = new THREE.Color(1.0, 0.7, 0.3);
  const VIOLET = new THREE.Color(0.62, 0.38, 1.0);
  const PINK = new THREE.Color(1.0, 0.42, 0.75);
  const BLUE = new THREE.Color(0.22, 0.42, 1.0);

  const bubbles = [];
  function bubble({ r, pos, colA, colB, axis, glow, haze = 0.28, intensity = 1.0, detail = 96 }) {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uColA: { value: new THREE.Color(colA) },
        uColB: { value: new THREE.Color(colB) },
        uGlow: { value: new THREE.Color(glow || BLUE) },
        uAxis: { value: new THREE.Vector2(axis[0], axis[1]) },
        uIntensity: { value: intensity },
        uHaze: { value: haze },
        uReveal: { value: 0 },
      },
      vertexShader: BUBBLE_VERTEX_SHADER,
      fragmentShader: BUBBLE_RIM_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, detail, detail), mat);
    m.position.set(...pos);
    scene.add(m);
    bubbles.push(m);
    return m;
  }

  /* Composition traced from the reference (landscape, camera at z=14): */

  /* A — huge left sphere: amber top rim, blue haze filling its body */
  bubble({ r: 8.0, pos: [-7.5, -2.8, 0.0],
           colA: VIOLET, colB: AMBER, axis: [0.25, 1],
           glow: BLUE, haze: 0.42, intensity: 1.05 });

  /* B — giant top sphere: violet upper rim, hot orange lower rim */
  bubble({ r: 9.0, pos: [3.2, 8.6, -1.0],
           colA: ORANGE, colB: VIOLET, axis: [0.15, 1],
           glow: new THREE.Color(0.3, 0.1, 0.45), haze: 0.2, intensity: 1.15 });

  /* C — bottom-right sphere: white-violet top rim, blue glow inside */
  bubble({ r: 7.0, pos: [7.8, -7.8, 0.5],
           colA: ORANGE, colB: PINK, axis: [-0.2, 1],
           glow: BLUE, haze: 0.4, intensity: 1.2 });

  /* D — far right sphere: pure violet rim sweeping the right edge */
  bubble({ r: 9.5, pos: [14.5, 3.0, -2.0],
           colA: VIOLET, colB: PINK, axis: [-1, 0.2],
           glow: new THREE.Color(0.25, 0.08, 0.4), haze: 0.15, intensity: 1.0 });

  /* E — the small inner lens where the big rims cross */
  bubble({ r: 2.3, pos: [0.3, 2.1, 1.2],
           colA: PINK, colB: new THREE.Color(0.85, 0.8, 1.0), axis: [0.4, 1],
           glow: VIOLET, haze: 0.1, intensity: 0.75, detail: 64 });

  /* --- resize / pointer / loop -------------------------------------------- */
  function resize() {
    const w = host.clientWidth;
    const h = host.clientHeight;
    if (!w || !h) return;

    renderer.setSize(w, h, false);
    bgUni.uRes.value.set(w * renderer.getPixelRatio(), h * renderer.getPixelRatio());
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    /* pull the camera back on portrait screens so the arcs still cross on-frame */
    camera.position.z = w / h < 1 ? 14 * (1.25 + (1 - w / h) * 0.5) : 14;
  }
  /* Observed rather than measured once: the section is still pre-layout when
     this runs, exactly as the About field was. */
  resize();
  new ResizeObserver(resize).observe(host);

  const target = { x: 0, y: 0 };
  const ptr = { x: 0, y: 0 };
  /*
   * The field is pointer-events:none so the cards keep their hover, so the
   * cursor is read off the section and converted against the field's own box.
   */
  const section = host.closest('section') || host;
  function fromEvent(e) {
    const rct = host.getBoundingClientRect();
    const p = e.touches ? e.touches[0] : e;
    target.x = ((p.clientX - rct.left) / rct.width - 0.5) * 2;
    target.y = -((p.clientY - rct.top) / rct.height - 0.5) * 2;
  }
  section.addEventListener('pointermove', fromEvent);
  section.addEventListener('touchmove', fromEvent, { passive: true });
  section.addEventListener('pointerleave', () => {
    target.x = 0;
    target.y = 0;
  });

  const clock = new THREE.Clock();
  const base = bubbles.map((m) => m.position.clone());
  let frameId = null;
  let onScreen = false;

  function draw() {
    renderer.clear();
    renderer.render(bgScene, bgCam);
    renderer.clearDepth();
    renderer.render(scene, camera);
  }

  function frame() {
    frameId = requestAnimationFrame(frame);
    const t = prefersReducedMotion ? 0 : clock.getElapsedTime();

    ptr.x += (target.x - ptr.x) * 0.045;
    ptr.y += (target.y - ptr.y) * 0.045;

    camera.position.x = ptr.x * 0.9;
    camera.position.y = ptr.y * 0.7;
    camera.lookAt(0, 0, 0);

    if (!prefersReducedMotion) {
      /* slow orbital drift so the crossing points glide and re-flare */
      bubbles.forEach((m, i) => {
        m.position.x = base[i].x + Math.sin(t * 0.11 + i * 2.1) * 0.45;
        m.position.y = base[i].y + Math.cos(t * 0.09 + i * 1.7) * 0.40;
      });
    }

    draw();
  }

  let entrancePlayed = false;

  /*
   * Held until the section is actually on screen. Fired on load the rims would
   * have finished igniting long before anyone scrolled this far down.
   */
  function playEntrance() {
    if (entrancePlayed) return;
    entrancePlayed = true;

    const tl = gsap.timeline({ defaults: { ease: 'power2.out' } });
    tl.to(bgUni.uReveal, { value: 1, duration: 1.6, ease: 'power2.inOut' }, 0);
    bubbles.forEach((m, i) => {
      m.scale.setScalar(0.94);
      tl.to(m.material.uniforms.uReveal, { value: 1, duration: 1.5 }, 0.5 + i * 0.28);
      tl.to(m.scale, { x: 1, y: 1, z: 1, duration: 2.0, ease: 'power3.out' }, 0.5 + i * 0.28);
    });
  }

  function sync() {
    const shouldRun = onScreen && !document.hidden;
    if (shouldRun) {
      playEntrance();
      if (frameId === null) frame();
    } else if (frameId !== null) {
      cancelAnimationFrame(frameId);
      frameId = null;
    }
  }

  if (prefersReducedMotion) {
    bgUni.uReveal.value = 1;
    bubbles.forEach((m) => {
      m.material.uniforms.uReveal.value = 1;
    });
    draw();
    return;
  }

  new IntersectionObserver(
    ([entry]) => {
      onScreen = entry.isIntersecting;
      sync();
    },
    { rootMargin: '200px' }
  ).observe(host);

  document.addEventListener('visibilitychange', sync);
}

/* =========================================================================
 * Contact field
 *
 * The About section's raymarched liquid, reused behind "Let's Build Something
 * Meaningful" — pass 1 only. The ALPHINTRA letter column is that section's
 * motif, so this is the fluid on its own, which also keeps it to a single
 * draw call per frame.
 *
 * Deliberately a small separate initialiser rather than a parameterised
 * version of initAboutField(): that function is 300 lines with the letter
 * choreography woven through its resize, frame and entrance paths, and
 * threading a flag through all of it to save ~40 lines here would put the
 * About section at risk for no visual gain.
 * ====================================================================== */
function initContactField() {
  const host = document.querySelector('#contact-field');
  if (!host) return;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  } catch (error) {
    console.error('Contact field: no WebGL context', error);
    return;
  }

  /* Same r128 grade as the About field — the shader applies its own pow(). */
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setPixelRatio(pixelRatioFor(1.5, 1));
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const uni = {
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uPtr: { value: new THREE.Vector2(0, 0) },
    uSpread: { value: 1 },
    uReveal: { value: 0 },
  };

  scene.add(
    new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        uniforms: uni,
        vertexShader: 'void main(){ gl_Position = vec4(position,1.0); }',
        fragmentShader: FIELD_FRAGMENT_SHADER,
      })
    )
  );

  function resize() {
    const w = host.clientWidth;
    const h = host.clientHeight;
    if (!w || !h) return;

    renderer.setSize(w, h, false);
    uni.uRes.value.set(w * renderer.getPixelRatio(), h * renderer.getPixelRatio());
    /* Same framing rule as the About field: spread the pods on wide boxes. */
    uni.uSpread.value = Math.min(Math.max(w / h / 0.56, 1), 2.1);
  }
  /* Observed, not measured once — this section is still pre-layout here. */
  resize();
  new ResizeObserver(resize).observe(host);

  const target = { x: 0, y: 0 };
  function fromEvent(e) {
    const r = host.getBoundingClientRect();
    const p = e.touches ? e.touches[0] : e;
    target.x = ((p.clientX - r.left) / r.width - 0.5) * 2;
    target.y = -((p.clientY - r.top) / r.height - 0.5) * 2;
  }
  host.addEventListener('pointermove', fromEvent);
  host.addEventListener('touchmove', fromEvent, { passive: true });
  host.addEventListener('pointerleave', () => {
    target.x = 0;
    target.y = 0;
  });

  const clock = new THREE.Clock();
  let frameId = null;
  let onScreen = false;

  function draw() {
    renderer.render(scene, cam);
  }

  function frame() {
    frameId = requestAnimationFrame(frame);
    uni.uTime.value = clock.getElapsedTime();

    const p = uni.uPtr.value;
    p.x += (target.x - p.x) * 0.05;
    p.y += (target.y - p.y) * 0.05;

    draw();
  }

  let entrancePlayed = false;

  function playEntrance() {
    if (entrancePlayed) return;
    entrancePlayed = true;
    gsap.to(uni.uReveal, { value: 1, duration: 1.8, ease: 'power2.inOut' });
  }

  function sync() {
    const shouldRun = onScreen && !document.hidden;
    if (shouldRun) {
      playEntrance();
      if (frameId === null) frame();
    } else if (frameId !== null) {
      cancelAnimationFrame(frameId);
      frameId = null;
    }
  }

  if (prefersReducedMotion) {
    uni.uReveal.value = 1;
    draw();
    return;
  }

  new IntersectionObserver(
    ([entry]) => {
      onScreen = entry.isIntersecting;
      sync();
    },
    { rootMargin: '200px' }
  ).observe(host);

  document.addEventListener('visibilitychange', sync);
}
