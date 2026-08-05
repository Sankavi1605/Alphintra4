import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

import { pixelRatioFor } from './render-quality.js';
// Canvas-texture glyph rows, shared by the Makers and Featured Work fields.
import { makeLetter, fitScale } from './webgl-letters.js';
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
  queueMicrotask(initAboutUsField);
  queueMicrotask(initServicesField);
  queueMicrotask(initMakersField);
  queueMicrotask(initProjectsField);
  queueMicrotask(initContactField);
  queueMicrotask(initFooterField);
  /* Neither depends on the hero model, and the carousel drives itself off a
     GSAP loop rather than ScrollTrigger, so both run here instead of in
     setupScrollAnimations — which only fires once the GLTF has resolved. */
  queueMicrotask(setupProjectsCarousel);
  queueMicrotask(setupWorkGlass);
  queueMicrotask(setupCapabilityCycle);
  queueMicrotask(setupServiceDeck);
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
  queueMicrotask(initAboutUsField);
  queueMicrotask(initServicesField);
  queueMicrotask(initMakersField);
  queueMicrotask(initProjectsField);
  queueMicrotask(initContactField);
  queueMicrotask(initFooterField);
  /* Neither depends on the hero model, and the carousel drives itself off a
     GSAP loop rather than ScrollTrigger, so both run here instead of in
     setupScrollAnimations — which only fires once the GLTF has resolved. */
  queueMicrotask(setupProjectsCarousel);
  queueMicrotask(setupWorkGlass);
  queueMicrotask(setupCapabilityCycle);
  queueMicrotask(setupServiceDeck);
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

  renderer.setPixelRatio(pixelRatioFor(2, 2));
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

      /*
       * Ultra-polished liquid chrome.
       *
       * roughness is deliberately NOT lower than this. The GLB ships
       * KHR_mesh_quantization normals stored as normalized int8 — about 1/127
       * of precision per component — so the shading normal steps in visible
       * increments across the surface. At a near-mirror 0.08 those steps land
       * straight in the specular lobe and read as a stepped, speckled fringe
       * along the edges; widening the lobe slightly smears each step into its
       * neighbour and the highlight reads smooth. It is still unmistakably
       * chrome at 0.14 — the reflections just aren't razor-sharp.
       */
      model.traverse((child) => {
        if (!child.isMesh) return;
        ensureNormals(child.geometry);
        child.material = new THREE.MeshPhysicalMaterial({
          color: 0xffffff,
          metalness: 1.0,
          roughness: 0.14,
          clearcoat: 1.0,
          clearcoatRoughness: 0.08,
          envMapIntensity: 3.5,
          flatShading: false,
        });
      });

      scene.add(model);

      // Initial state
      model.scale.set(3.5, 3.5, 3.5);
      model.position.z = -2;
      /*
       * Sat low enough that the wordmark clears the model's apex. At -2 the
       * spike reached the top of the row and split "ALPHI(N)TRA" in half; the
       * word has come up to 24% of the hero (see .hero-title) and this drops
       * the model the rest of the way, so the two occupy the frame in turn
       * instead of fighting over the middle of it.
       *
       * -2.72 is the floor: one world unit is ~138px at this depth, and any
       * lower starts cutting the feet off the bottom of the frame.
       */
      model.position.y = -2.72;
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
            child.material.roughness = 0.17; // see the note on `model` above
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
    renderer.setPixelRatio(pixelRatioFor(2, 2));
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

  /*
   * 1. CAPABILITIES
   *
   * The heading and the cards are not animated here any more. The heading is
   * lettered in WebGL and faded in by initCapabilityField's own entrance, and
   * the cards are owned by setupCapabilityCycle — a scroll-triggered stagger
   * would set opacity:1 on all four and fight the cross-fade for control of the
   * same properties. Only the tail below the deck is left.
   */
  const at = { trigger: '.concepts-action', start: 'top 90%' };
  reveal('.concepts-action-text', at, { y: 20, blur: 4 }, { duration: 0.6 });
  reveal('.concepts-action .btn-outline', at, { y: 25, scale: 0.9 },
    { duration: 0.7, ease: 'back.out(1.4)', delay: 0.15 });

  /*
   * 2. ABOUT
   *
   * The heading is not animated here any more: it is lettered in WebGL and
   * faded in by initAboutField's own entrance, and the HTML pair it stands in
   * for is hidden.
   *
   * The trigger is .about-content. It used to be .about-image, which has not
   * been in the markup since the WebGL blob replaced it — so this whole group
   * was hanging off an element that does not exist.
   */
  const aboutBody = { trigger: '.about-content', start: 'top 70%' };
  reveal('.about-content h3', aboutBody, { y: 35, skewY: 2, blur: 6 }, { duration: 0.8, delay: 0.25 });

  const aboutParagraphs = document.querySelectorAll('.about-content p');
  gsap.fromTo(aboutParagraphs,
    { opacity: 0, y: 25, filter: 'blur(5px)' },
    { scrollTrigger: aboutBody, opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.8, stagger: 0.18, delay: 0.45 }
  );

  reveal('.about-content .project-link', aboutBody, { x: -20, blur: 4 },
    { duration: 0.6, delay: 0.45 + aboutParagraphs.length * 0.18 + 0.2 });

  // 3. CONTACT
  // The heading is drawn in the WebGL field now, so there is no h2 or subtext
  // to reveal here — the two cards come in from their own side of the crater.
  gsap.fromTo('.contact-card',
    { opacity: 0, y: 30, filter: 'blur(6px)' },
    {
      scrollTrigger: { trigger: '.contact-inner', start: 'top 70%' },
      opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.9, ease: 'power3.out', stagger: 0.15,
    }
  );

  // 4. CLOSING CALL TO ACTION
  // The card comes in as one piece — its own heading no longer needs a
  // separate reveal, and animating both left the h2 lagging inside the glass.
  gsap.fromTo('.cta-card',
    { opacity: 0, y: 35, filter: 'blur(6px)' },
    { scrollTrigger: { trigger: '.faq-inner', start: 'top 75%' }, opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.9, ease: 'power3.out' }
  );

  // 5. FOOTER
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
 * Featured Work carousel.
 *
 * Each card sweeps in from the right, holds centre, then departs left as the
 * next one enters — the sketch's conveyor, verbatim in its timings. Cards are
 * absolutely stacked (see .project-slide) so only x, rotateY, opacity and blur
 * animate; nothing reflows per frame.
 *
 * Deviation from the sketch, deliberately: the loop pauses while a card is
 * hovered or holds focus. The sketch's cards were dummies with a "View case"
 * label, ours carry real links to live projects, and a 4.4s cycle that cannot
 * be stopped makes them a moving target for the mouse and unreadable for
 * anyone who reads slowly.
 */
function setupProjectsCarousel() {
  const stage = document.querySelector('.projects-deck');
  const slides = gsap.utils.toArray('.project-slide');
  if (!stage || slides.length === 0) return;

  /*
   * The stacked layout and the conveyor only exist above the phone breakpoint
   * and outside reduced motion; below that the cards flow down the page (see
   * the matching CSS), and driving x on them there would fight the layout.
   */
  const stacked = window.matchMedia('(min-width: 769px)');
  if (prefersReducedMotion || !stacked.matches) return;

  gsap.set(slides, { opacity: 0 });

  /*
   * Just far enough to be fully clear of the track, plus a little for the blur.
   *
   * The sketch used `stage/2 + card * 0.9`, but its cards were min(560px, 88vw)
   * inside a full-width stage. Ours fill the track — the copy is a tags row, a
   * title, a 62ch paragraph and a link, which at 560px would be a very tall
   * card — so that formula asked for ~40% more distance than the card needs.
   * With the duration fixed at 1.15s the surplus all came off the visible part
   * of the move, and the sweep read as a whip.
   */
  const travel = () => stage.clientWidth * 0.5 + slides[0].offsetWidth * 0.6;

  let cycle = null;

  function showCard(i) {
    const card = slides[i];
    /* Entering card on top of the one leaving. */
    stage.appendChild(card);

    cycle = gsap
      .timeline()
      .fromTo(
        card,
        { x: travel(), opacity: 0, rotateY: 14, filter: 'blur(8px)' },
        { x: 0, opacity: 1, rotateY: 0, filter: 'blur(0px)', duration: 1.15, ease: 'power3.out' }
      )
      .to(card, { duration: 2.1 })
      .to(card, {
        x: -travel(),
        opacity: 0,
        rotateY: -14,
        filter: 'blur(8px)',
        duration: 1.15,
        ease: 'power3.in',
        onStart() {
          showCard((i + 1) % slides.length);
        },
      });
  }

  /*
   * Paused on the whole deck rather than per card: the pointer has to cross the
   * card that is leaving to reach the one arriving, and pausing only the hovered
   * card would leave the other mid-flight.
   */
  const hold = () => cycle && cycle.pause();
  const release = () => {
    if (cycle && !stage.matches(':hover') && !stage.contains(document.activeElement)) cycle.resume();
  };
  stage.addEventListener('pointerenter', hold);
  stage.addEventListener('pointerleave', release);
  stage.addEventListener('focusin', hold);
  stage.addEventListener('focusout', release);

  showCard(0);
}

/* -------------------------------------------------------------------------
 * Featured Work background — lit blades
 *
 * The supplied sketch, ported from three r128. Seven stacked chevrons in the
 * dark: one lit hot white-violet, the rest fading back into black, each at its
 * own parallax depth so the row separates as the cursor moves. The heading is
 * drawn over them from a second, perspective camera — same treatment as THE
 * TEAM over the orbs, and again decoration only; the real h2 is in the HTML.
 * ---------------------------------------------------------------------- */
const BLADE_COUNT = 7;

const BLADES_FRAGMENT_SHADER = `
  precision highp float;
  uniform vec2  uRes, uPtr;
  uniform float uTime, uReveal;
  uniform float uRev[${BLADE_COUNT}];

  float sdSeg(vec2 p, vec2 a, vec2 b){
    vec2 pa = p-a, ba = b-a;
    float h = clamp(dot(pa,ba)/dot(ba,ba), 0.0, 1.0);
    return length(pa - ba*h);
  }
  /* a ">" chevron: two arms sweeping back-left from a vertex */
  float blade(vec2 p, vec2 v, float sc){
    vec2 d1 = normalize(vec2(-1.00, 0.62));
    vec2 d2 = normalize(vec2(-0.50,-1.00));
    return min(sdSeg(p, v, v + d1*2.1*sc), sdSeg(p, v, v + d2*2.1*sc));
  }

  void main(){
    vec2 uv = (gl_FragCoord.xy - 0.5*uRes)/min(uRes.x,uRes.y)*2.0;
    vec3 col = vec3(0.010, 0.006, 0.018);

    /* vertex, scale, core intensity, soft intensity, blur, parallax */
    vec2  V[${BLADE_COUNT}];
    vec4  K[${BLADE_COUNT}];   /* x core, y soft, z blur, w parallax */
    float S[${BLADE_COUNT}];

    V[0]=vec2( 0.30,-0.02); K[0]=vec4(1.60,0.55, 90.0,0.06); S[0]=1.00; /* the hot one */
    V[1]=vec2( 0.52, 0.11); K[1]=vec4(0.22,0.16, 42.0,0.09); S[1]=0.96;
    V[2]=vec2( 0.74, 0.24); K[2]=vec4(0.10,0.10, 24.0,0.12); S[2]=0.92;
    V[3]=vec2( 0.95, 0.37); K[3]=vec4(0.05,0.07, 14.0,0.15); S[3]=0.90;
    V[4]=vec2( 0.10,-0.20); K[4]=vec4(0.14,0.12, 34.0,0.05); S[4]=1.05;
    V[5]=vec2(-0.14,-0.42); K[5]=vec4(0.06,0.08, 18.0,0.03); S[5]=1.10;
    V[6]=vec2( 0.55, 0.95); K[6]=vec4(0.05,0.06, 10.0,0.10); S[6]=1.45; /* faint far blade up top */

    for(int i=0;i<${BLADE_COUNT};i++){
      vec2 wob = 0.012*vec2(sin(uTime*0.30+float(i)*1.7), cos(uTime*0.24+float(i)*2.3));
      vec2 p = uv + uPtr*K[i].w + wob;
      float e = blade(p, V[i], S[i]);

      float core = exp(-pow(e*K[i].z, 2.0));
      float soft = exp(-e*7.5);
      vec3 tintC = mix(vec3(0.60,0.42,0.98), vec3(0.96,0.90,1.08), core); /* violet steel */
      vec3 tintS = vec3(0.28,0.15,0.48);

      col += (tintC * core * K[i].x + tintS * soft * K[i].y) * uRev[i];
    }

    /* soft purple ambience pooling behind the cards */
    col += vec3(0.30,0.12,0.58) * exp(-pow(length((uv - vec2(0.05,-0.58))*vec2(0.75,1.25)), 2.0)*1.5) * 0.40;
    col += vec3(0.16,0.06,0.34) * exp(-pow(length((uv - vec2(-0.75,0.55))), 2.0)*1.2) * 0.30;

    /* vignette + dither */
    col *= 1.0 - 0.32*pow(length(uv*vec2(0.55,0.55)), 2.4);
    col += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898,78.233)))*43758.5453)-0.5)/255.0;
    gl_FragColor = vec4(col * uReveal, 1.0);
  }`;

function initProjectsField() {
  const host = document.querySelector('#projects-field');
  if (!host) return;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  } catch (error) {
    console.error('Projects field: no WebGL context', error);
    return;
  }

  /* Same grade as the other fields — the shader writes its own linear ramps
     and dithers by hand at 1/255, both of which an sRGB transfer would eat. */
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setPixelRatio(pixelRatioFor(2, 1.25));
  /* The lettering draws on top of the blades, so the frame is cleared by hand. */
  renderer.autoClear = false;
  host.appendChild(renderer.domElement);

  /* ---- pass 1: the blades ---- */
  const bgScene = new THREE.Scene();
  const bgCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  /*
   * One reveal per blade, held in a plain array. three uploads array uniforms
   * with uniform1fv every render, so GSAP mutating an element in place is
   * picked up without any needsUpdate bookkeeping.
   */
  const revArr = new Array(BLADE_COUNT).fill(0);

  const uni = {
    uRes: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 },
    uPtr: { value: new THREE.Vector2(0, 0) },
    uReveal: { value: 0 },
    uRev: { value: revArr },
  };

  bgScene.add(
    new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        uniforms: uni,
        vertexShader: 'void main(){ gl_Position = vec4(position,1.0); }',
        fragmentShader: BLADES_FRAGMENT_SHADER,
      })
    )
  );

  /* ---- pass 2: OUR FEATURED WORK ---- */
  const txScene = new THREE.Scene();
  const txCam = new THREE.PerspectiveCamera(40, 1, 0.1, 50);
  txCam.position.z = 6;

  const WORD = 'OUR FEATURED WORK';
  const LETTER_SIZE = 0.34;
  const LETTER_GAP = 0.335;
  const WORD_WIDTH = (WORD.length - 1) * LETTER_GAP;
  const WORD_HALF = WORD_WIDTH / 2 + LETTER_SIZE / 2;

  const letters = [];
  [...WORD].forEach((ch, i) => {
    if (ch === ' ') return;
    letters.push(
      makeLetter(
        txScene,
        ch,
        'rgba(240,236,250,0.95)',
        null,
        LETTER_SIZE,
        -WORD_WIDTH / 2 + i * LETTER_GAP,
        1.18,
        Math.sin(i * 1.7) * 0.08,
        false
      )
    );
  });
  const echoes = [
    makeLetter(txScene, 'F', '#8a4bff', 'rgba(138,75,255,0.9)', 0.42, -2.55, 0.52, -0.4, true),
    makeLetter(txScene, 'W', '#4653f0', 'rgba(70,83,240,0.9)', 0.4, 2.75, 1.85, -0.5, true),
  ];

  function draw() {
    renderer.clear();
    renderer.render(bgScene, bgCam);
    renderer.clearDepth();
    renderer.render(txScene, txCam);
  }

  function resize() {
    const w = host.clientWidth;
    const h = host.clientHeight;
    if (!w || !h) return;

    renderer.setSize(w, h, false);
    uni.uRes.value.set(w * renderer.getPixelRatio(), h * renderer.getPixelRatio());

    txCam.aspect = w / h;
    txCam.updateProjectionMatrix();
    /*
     * The sketch's own term is `Math.max(0.52, Math.min(1, (w / h) / 1.55))`.
     * As with THE TEAM that floor is too high for a portrait box — 17 glyphs
     * at 0.52 still overflow a phone's frustum — so fitScale caps it. Every
     * landscape width resolves to the sketch's term untouched.
     */
    txScene.scale.setScalar(Math.min(1, w / h / 1.55, fitScale(txCam, w / h, WORD_HALF)));

    if (prefersReducedMotion) draw();
  }
  /* Observed, not measured once — this section is still pre-layout here. */
  resize();
  new ResizeObserver(resize).observe(host);

  const target = { x: 0, y: 0 };
  /* The field is pointer-events:none so the cards stay clickable; the cursor
     is read off the section and converted against the field's own box. */
  const section = host.closest('section') || host;
  function fromEvent(e) {
    const r = host.getBoundingClientRect();
    const p = e.touches ? e.touches[0] : e;
    target.x = ((p.clientX - r.left) / r.width - 0.5) * 2;
    target.y = -((p.clientY - r.top) / r.height - 0.5) * 2;
  }
  section.addEventListener('pointermove', fromEvent);
  section.addEventListener('touchmove', fromEvent, { passive: true });
  section.addEventListener('pointerleave', () => {
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

    txCam.position.x = p.x * 0.3;
    txCam.position.y = p.y * 0.22;
    /* Aimed above the origin, which lifts the word clear of the card band. */
    txCam.lookAt(0, 0.6, 0);

    letters.forEach((m, i) => {
      m.position.y = m.userData.baseY + Math.sin(t * 0.5 + i * 0.6) * 0.01;
    });

    draw();
  }

  let entrancePlayed = false;
  let entranceCtx = null;

  function playEntrance() {
    if (entrancePlayed) return;
    entrancePlayed = true;
    entranceCtx = gsap.context(entranceSequence);
  }

  /*
   * Rewound whenever the section leaves the screen, so scrolling back to it
   * starts the sequence from black instead of dropping you into a scene that
   * finished minutes ago. The context is what makes that safe: it collects
   * every tween the sequence creates — including the infinite float and
   * breathe loops, which would otherwise stack a fresh copy on each visit —
   * and revert() both kills them and restores the values they started from.
   *
   * A hidden tab only pauses; it does not rewind. Coming back to a tab is not
   * arriving at the section.
   */
  function resetEntrance() {
    if (entranceCtx) entranceCtx.revert();
    entranceCtx = null;
    entrancePlayed = false;
  }

  function entranceSequence() {

    const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
    tl.to(uni.uReveal, { value: 1, duration: 1.2, ease: 'power2.inOut' }, 0);

    /* The hot blade cuts in first, the echoes fan out behind it. */
    const order = [0, 4, 1, 5, 2, 3, 6];
    order.forEach((b, k) => {
      const o = { v: 0 };
      tl.to(
        o,
        {
          v: 1,
          duration: 1.3,
          ease: 'power2.out',
          onUpdate() {
            revArr[b] = o.v;
          },
        },
        0.25 + k * 0.18
      );
    });

    letters.forEach((m, i) => {
      tl.fromTo(
        m.position,
        { y: m.userData.baseY - 0.22 },
        { y: m.userData.baseY, duration: 1.0, ease: 'power3.out' },
        1.15 + i * 0.055
      );
      tl.to(m.material, { opacity: 0.95, duration: 0.8, ease: 'power2.out' }, 1.15 + i * 0.055);
    });
    echoes.forEach((m, i) => {
      tl.fromTo(
        m.scale,
        { x: 0.7, y: 0.7 },
        { x: 1, y: 1, duration: 1.1, ease: 'back.out(1.6)' },
        2.35 + i * 0.22
      );
      tl.to(m.material, { opacity: 0.5, duration: 1.0 }, 2.35 + i * 0.22);
      gsap.to(m.position, {
        y: '+=0.10',
        x: i ? '-=0.06' : '+=0.06',
        duration: 6 + i,
        repeat: -1,
        yoyo: true,
        ease: 'sine.inOut',
        delay: 4,
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
    revArr.fill(1);
    letters.forEach((m) => {
      m.material.opacity = 0.95;
    });
    echoes.forEach((m) => {
      m.material.opacity = 0.5;
    });
    draw();
    return;
  }

  new IntersectionObserver(
    ([entry]) => {
      onScreen = entry.isIntersecting;
      if (!onScreen) resetEntrance();
      sync();
    },
    { rootMargin: '200px' }
  ).observe(host);

  document.addEventListener('visibilitychange', sync);
}

/**
 * Engineering Capabilities: the four cards, shown one at a time inside the halo.
 *
 * A cross-fade rather than the horizontal sweep the projects deck uses. That
 * card spans a full-width track and can leave the frame; this one is centred
 * inside a circle, so sliding it sideways would drag it out through the rings.
 * It lifts, fades and settles in place instead, which keeps every frame of the
 * transition inside the halo.
 *
 * As with the projects deck, the cycle pauses on hover or focus — four cards at
 * ~3.3s each is a 13s round trip, and a card that moves while it is being read
 * is worse than no rotation at all.
 */
function setupCapabilityCycle() {
  const deck = document.querySelector('.concepts-deck');
  const cards = gsap.utils.toArray('.concept-card');
  if (!deck || cards.length === 0) return;

  /*
   * Under reduced motion the CSS un-stacks the deck and shows all four down the
   * page, because a cycle that never advances would leave three of the four
   * capabilities permanently invisible.
   */
  if (prefersReducedMotion) return;

  gsap.set(cards, { opacity: 0 });

  let cycle = null;

  function show(i) {
    const card = cards[i];
    /* the entering card on top of the one leaving */
    deck.appendChild(card);
    cycle = gsap
      .timeline()
      .fromTo(
        card,
        { opacity: 0, y: 26, scale: 0.965, filter: 'blur(6px)' },
        { opacity: 1, y: 0, scale: 1, filter: 'blur(0px)', duration: 0.85, ease: 'power3.out' }
      )
      .to(card, { duration: 2.4 })
      .to(card, {
        opacity: 0,
        y: -26,
        scale: 0.965,
        filter: 'blur(6px)',
        duration: 0.85,
        ease: 'power3.in',
        onStart() {
          show((i + 1) % cards.length);
        },
      });
  }

  /*
   * Paused on the deck rather than per card: the cards overlap during the
   * cross-fade, so pausing only the hovered one would leave the other mid-flight.
   */
  const hold = () => cycle && cycle.pause();
  const release = () => {
    if (cycle && !deck.matches(':hover') && !deck.contains(document.activeElement)) cycle.resume();
  };
  deck.addEventListener('pointerenter', hold);
  deck.addEventListener('pointerleave', release);
  deck.addEventListener('focusin', hold);
  deck.addEventListener('focusout', release);

  show(0);
}

/**
 * The liquid in the glass: the specular pool tracks the pointer over each card
 * and drifts on its own when idle, so the surface never looks like a static
 * gradient. Writes CSS custom properties, so the highlight itself is composited
 * by the browser rather than re-rendered here.
 */
function setupWorkGlass() {
  const cards = gsap.utils.toArray('.work-glass');

  cards.forEach((card, i) => {
    card.addEventListener('pointermove', (e) => {
      const r = card.getBoundingClientRect();
      card.style.setProperty('--mx', (((e.clientX - r.left) / r.width) * 100).toFixed(1) + '%');
      card.style.setProperty('--my', (((e.clientY - r.top) / r.height) * 100).toFixed(1) + '%');
    });

    if (prefersReducedMotion) return;
    gsap.to(card, {
      '--mx': 38 + i * 12 + '%',
      duration: 5 + i,
      repeat: -1,
      yoyo: true,
      ease: 'sine.inOut',
    });
    gsap.to(card, {
      '--my': 30 + i * 14 + '%',
      duration: 6 + i * 1.3,
      repeat: -1,
      yoyo: true,
      ease: 'sine.inOut',
    });
  });
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
 * About background — the planet
 *
 * The supplied sketch, ported from three r128 to r185, replacing the
 * raymarched liquid and its ALPHINTRA column. Two passes share one renderer:
 *
 *   1. An orthographic full-screen quad drawing a sphere lit from the
 *      lower-left — a cloudy lavender crescent melting into a near-black night
 *      side, a magenta atmosphere ringing the disc and cooling to blue at the
 *      bottom, nebula wisps drifting outside it, and a pink glint on the dark
 *      side.
 *   2. A perspective pass lettering ENGINEERING STUDIO / FOR SCALABLE PRODUCTS
 *      in two rows across the lower field, plus two coloured echoes.
 *
 * The section's copy sits over the planet, in the band the scrim darkens most,
 * and the lettering sits below the copy — the rows are at world y -1.70/-1.98
 * of a 2.18 half-height frame, so they land in the bottom fifth, clear of it.
 *
 * The real heading is the visually-hidden h2 and its companion paragraph, which
 * keep the document outline, search and text selection intact.
 * ---------------------------------------------------------------------- */
const PLANET_FRAGMENT_SHADER = `
  precision highp float;
  uniform vec2  uRes, uPtr;
  uniform float uTime, uReveal, uGlow, uSurf, uNeb, uStar;

  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
  float noise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    f = f*f*(3.0-2.0*f);
    return mix(mix(hash(i), hash(i+vec2(1,0)), f.x),
               mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
  }
  float fbm(vec2 p){
    float v = 0.0, a = 0.5;
    for(int k=0;k<5;k++){ v += a*noise(p); p *= 2.03; a *= 0.5; }
    return v;
  }

  void main(){
    vec2 uv = (gl_FragCoord.xy - 0.5*uRes)/min(uRes.x,uRes.y)*2.0;
    uv += uPtr * 0.025;

    vec3 col = vec3(0.006, 0.004, 0.012);

    /* ---------- nebula wisps drifting outside ---------- */
    float nb = fbm(uv*1.6 + vec2(uTime*0.014, -uTime*0.009));
    nb = pow(max(nb - 0.30, 0.0)*1.6, 1.5);
    float mR = exp(-pow(length(uv - vec2( 1.05,-0.55))*1.05, 2.0));
    float mL = exp(-pow(length(uv - vec2(-1.00, 0.20))*1.35, 2.0));
    float mT = exp(-pow(length(uv - vec2( 0.55, 0.95))*1.30, 2.0));
    col += vec3(0.78,0.15,0.82) * nb * (mR*0.75 + mT*0.35) * uNeb;
    col += vec3(0.42,0.13,0.76) * nb * mL * 0.45 * uNeb;

    /* ---------- the planet ---------- */
    vec2  C = vec2(0.0, 0.14);
    float R = 0.52;
    vec2  q = (uv - C)/R;
    float r = length(q);
    float inside = 1.0 - smoothstep(0.995, 1.012, r);

    if(inside > 0.0){
      float nz = sqrt(max(1.0 - r*r, 0.0));
      vec3  n  = vec3(q, nz);
      vec3  L  = normalize(vec3(-0.62,-0.55, 0.56));
      float diff = pow(max(dot(n, L), 0.0), 1.15) * uSurf;

      /* living cloud surface: domain-warped fbm, drifting slowly */
      vec2 sp = q*2.6 + vec2(uTime*0.010, uTime*0.006);
      float warp = fbm(sp*1.4 + 3.0);
      float cloud = fbm(sp + warp*1.3);

      vec3 surf = mix(vec3(0.040,0.024,0.085), vec3(0.355,0.300,0.640), diff);
      surf += vec3(0.86,0.88,1.00) * pow(diff, 1.9) * (0.35 + 0.85*cloud);
      surf *= 0.72 + 0.55*mix(1.0, cloud, min(diff*1.6, 1.0));

      /* night side isn't dead black — a whisper of violet */
      surf += vec3(0.018,0.010,0.036) * (1.0 - diff);

      /* atmosphere glowing along the inside of the limb */
      float ang = atan(q.y, q.x);
      vec3 rimTint = mix(vec3(0.60,0.72,1.00), vec3(0.72,0.25,1.00),
                         smoothstep(-0.65, 0.55, sin(ang)));
      float rimIn = pow(smoothstep(0.78, 1.0, r), 3.0);
      surf += rimTint * rimIn * (0.55 + 0.45*uSurf) * 0.62 * uGlow;

      col = mix(col, surf, inside);
    }

    /* ---------- atmosphere halo outside the disc ---------- */
    float e = max(r - 1.0, 0.0) * R;
    float ang2 = atan(q.y, q.x);
    vec3 haloTint = mix(vec3(0.55,0.68,1.00), vec3(0.72,0.25,1.00),
                        smoothstep(-0.65, 0.55, sin(ang2)));
    float haloA = 0.78 + 0.32*smoothstep(-1.0, 1.0, sin(ang2));
    float halo = exp(-e*4.2)*0.80 + exp(-e*1.5)*0.28;
    col += haloTint * halo * haloA * (1.0 - inside) * uGlow;

    /* ---------- the tiny pink glint on the night side ---------- */
    float gd = length(uv - (C + vec2(0.035, 0.005)));
    float twk = 0.75 + 0.25*sin(uTime*2.2);
    col += vec3(1.00,0.28,0.55) * (exp(-gd*260.0)*1.15 + exp(-gd*70.0)*0.14) * twk * uStar;

    /* quiet scrim over the bottom band, where the heading lives */
    col *= 1.0 - 0.22*smoothstep(0.35, 0.95, -uv.y);
    col *= 1.0 - 0.26*pow(length(uv*vec2(0.55,0.55)), 2.4);
    col += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898,78.233)))*43758.5453)-0.5)/255.0;
    gl_FragColor = vec4(col * uReveal, 1.0);
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
   * Same r128 grade as the other fields: the shader hand-rolls its own ramps
   * and adds a 1/255 dither, and an sRGB transfer on the way out would crush
   * the crescent's cloud detail and the atmosphere's blue-to-magenta sweep.
   */
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setPixelRatio(pixelRatioFor(2, 1.25));
  /* Two passes into one buffer, so the clear is driven by hand. */
  renderer.autoClear = false;
  host.appendChild(renderer.domElement);

  /* --- pass 1: the planet --------------------------------------------------- */
  const bgScene = new THREE.Scene();
  const bgCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const uni = {
    uRes: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 },
    uPtr: { value: new THREE.Vector2(0, 0) },
    uReveal: { value: 0 } /* field + stars */,
    uGlow: { value: 0 } /* atmosphere ring */,
    uSurf: { value: 0 } /* dawn sweeps the surface */,
    uNeb: { value: 0 } /* nebula wisps */,
    uStar: { value: 0 } /* the pink glint */,
  };

  bgScene.add(
    new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        uniforms: uni,
        vertexShader: 'void main(){ gl_Position = vec4(position,1.0); }',
        fragmentShader: PLANET_FRAGMENT_SHADER,
      })
    )
  );

  /* --- pass 2: ENGINEERING STUDIO / FOR SCALABLE PRODUCTS ------------------ */
  const txScene = new THREE.Scene();
  const txCam = new THREE.PerspectiveCamera(40, 1, 0.1, 50);
  txCam.position.z = 6;

  /*
   * A stand-in for the camera at rest, used only to place the letter rows in
   * resize(). The live camera drifts with the pointer, and solving against that
   * would make the rows creep as the cursor moved.
   */
  const restCam = new THREE.PerspectiveCamera(40, 1, 0.1, 50);
  restCam.position.set(0, 0, 6);
  restCam.lookAt(0, -0.6, 0);
  restCam.updateMatrixWorld(true);
  const probe = new THREE.Vector3();
  const halfFrame = Math.tan(((40 / 2) * Math.PI) / 180) * 6;

  /*
   * The plate is what makes this word legible: the top row crosses the planet's
   * lit crescent, so each glyph carries a blurred near-black copy of itself
   * underneath. See letterTexture's opts.
   */
  const GLYPH = { weight: 200, plate: 'rgba(8,5,18,0.9)' };

  const letters = [];
  function makeRow(word, y, size, gap) {
    const width = (word.length - 1) * gap;
    [...word].forEach((ch, i) => {
      if (ch === ' ') return;
      const m = makeLetter(
        txScene,
        ch,
        'rgba(242,236,248,0.95)',
        null,
        size,
        -width / 2 + i * gap,
        y,
        Math.sin(letters.length * 1.7) * 0.06,
        false,
        GLYPH
      );
      /* Which row this glyph belongs to; resize() places the rows. See there. */
      m.userData.row = y;
      letters.push(m);
    });
  }
  makeRow('ENGINEERING STUDIO', -1.7, 0.235, 0.245);
  makeRow('FOR SCALABLE PRODUCTS', -1.98, 0.195, 0.205);

  /*
   * Where each row should land, as a fraction of the field's height.
   *
   * The sketch pins the rows with world y (-1.70 and -1.98) and that is still
   * what identifies them, but it cannot place them here. Two things move them:
   * the scene scale, which shrinks the row to fit the width and drags its y
   * toward the centre with it, and `lookAt(0, -0.6, 0)`, which tilts the camera
   * down and lifts everything on screen — together they put the rows about 12%
   * of the height higher than the sketch's numbers suggest, which on this
   * section is straight through the bottom of the copy.
   *
   * So the rows are placed by solving the real projection for the world y that
   * lands on these fractions.
   *
   * The fractions themselves are derived, not fixed. The section is one screen
   * tall now, so its height tracks the viewport, and a pinned 86%/93% that
   * cleared the copy on a tall window ran straight through it on a short one.
   * The rows follow the bottom of .about-content instead.
   */
  const copyEl = document.querySelector('#about .about-content');
  const ROW_GAP = 0.07; /* row 2 below row 1, in fractions of the field height */
  const ROW_FLOOR = 0.955; /* how far down row 2 may land before it is cropped */
  const ROW_CEIL = 0.62; /* above this the rows climb into the planet */

  function rowFractions(fieldRect) {
    let first = 0.86;
    if (copyEl) {
      /*
       * 46px of air under the CTA. The fraction names where the row's *centre*
       * lands, so half a glyph — about 3% of the height — sits above it; the
       * gap has to cover that as well as read as a break.
       */
      first = (copyEl.getBoundingClientRect().bottom - fieldRect.top + 46) / fieldRect.height;
    }
    first = Math.min(Math.max(first, ROW_CEIL), ROW_FLOOR - ROW_GAP);
    return new Map([
      [-1.7, first],
      [-1.98, first + ROW_GAP],
    ]);
  }

  /* the wider row sets the fit; FOR SCALABLE PRODUCTS is 21 characters */
  const WORD_HALF = (20 * 0.205) / 2 + 0.195 / 2;

  const echoes = [
    makeLetter(txScene, 'E', '#d84bff', 'rgba(216,75,255,0.9)', 0.34, -2.6, -1.28, -0.4, true),
    makeLetter(txScene, 'P', '#4653f0', 'rgba(70,83,240,0.9)', 0.32, 2.7, -2.3, -0.5, true),
  ];

  /* --- resize / pointer / loop -------------------------------------------- */
  function resize() {
    const w = host.clientWidth;
    const h = host.clientHeight;
    if (!w || !h) return;

    renderer.setSize(w, h, false);
    uni.uRes.value.set(w * renderer.getPixelRatio(), h * renderer.getPixelRatio());
    txCam.aspect = w / h;
    txCam.updateProjectionMatrix();

    /*
     * The sketch's own term, capped by fitScale. Its floor of 0.52 has the same
     * flaw as the other sketches': at 0.52 this row spans 2.15 world units
     * either side of centre, and a portrait frustum is nowhere near that wide,
     * so the outer glyphs of FOR SCALABLE PRODUCTS fall outside the frame. The
     * cap is inert on any landscape box, where the sketch's term already wins.
     */
    const scale = Math.min(1, Math.max(0.52, w / h / 1.35), fitScale(txCam, w / h, WORD_HALF));
    txScene.scale.setScalar(scale);

    /*
     * Place the rows against the actual projection, at the camera's rest pose —
     * not the live one, or the rows would slide up and down as the pointer
     * nudged the camera. Bisection rather than algebra because the perspective
     * divide makes it non-linear and 40 halvings on a resize costs nothing.
     *
     * Dividing by the scale converts the world y we solved for into the local y
     * the scaled scene needs. The frame loop reads baseY every frame, so the new
     * placement takes effect immediately.
     */
    restCam.aspect = txCam.aspect;
    restCam.updateProjectionMatrix();

    const solved = new Map();
    rowFractions(host.getBoundingClientRect()).forEach((fraction, row) => {
      const targetNdcY = 1 - 2 * fraction;
      let lo = -halfFrame * 4;
      let hi = halfFrame * 4;
      for (let k = 0; k < 40; k++) {
        const mid = (lo + hi) / 2;
        probe.set(0, mid, 0).project(restCam);
        if (probe.y > targetNdcY) hi = mid;
        else lo = mid;
      }
      solved.set(row, (lo + hi) / 2 / scale);
    });

    letters.forEach((m) => {
      m.userData.baseY = solved.get(m.userData.row);
      m.position.y = m.userData.baseY;
    });
  }
  /* Observed rather than measured once: the section is still pre-layout here. */
  resize();
  new ResizeObserver(resize).observe(host);

  const target = { x: 0, y: 0 };
  function fromEvent(e) {
    const rct = host.getBoundingClientRect();
    const p = e.touches ? e.touches[0] : e;
    target.x = ((p.clientX - rct.left) / rct.width - 0.5) * 2;
    target.y = -((p.clientY - rct.top) / rct.height - 0.5) * 2;
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
    const t = prefersReducedMotion ? 0 : clock.getElapsedTime();
    uni.uTime.value = t;

    const p = uni.uPtr.value;
    p.x += (target.x - p.x) * 0.045;
    p.y += (target.y - p.y) * 0.045;

    txCam.position.x = p.x * 0.26;
    txCam.position.y = p.y * 0.18;
    txCam.lookAt(0, -0.6, 0);

    if (!prefersReducedMotion) {
      letters.forEach((m, i) => {
        m.position.y = m.userData.baseY + Math.sin(t * 0.5 + i * 0.45) * 0.007;
      });
    }

    renderer.clear();
    renderer.render(bgScene, bgCam);
    renderer.clearDepth();
    renderer.render(txScene, txCam);
  }

  let entrancePlayed = false;
  let entranceCtx = null;

  /*
   * Held until the section is on screen. The sequence runs about six seconds —
   * fired on load, the dawn would have swept the planet and the glint would
   * already be sitting there long before anyone scrolled down to it.
   */
  function playEntrance() {
    if (entrancePlayed) return;
    entrancePlayed = true;
    entranceCtx = gsap.context(entranceSequence);
  }

  /*
   * Rewound whenever the section leaves the screen, so scrolling back to it
   * starts the sequence from black instead of dropping you into a scene that
   * finished minutes ago. The context is what makes that safe: it collects
   * every tween the sequence creates — including the infinite float and
   * breathe loops, which would otherwise stack a fresh copy on each visit —
   * and revert() both kills them and restores the values they started from.
   *
   * A hidden tab only pauses; it does not rewind. Coming back to a tab is not
   * arriving at the section.
   */
  function resetEntrance() {
    if (entranceCtx) entranceCtx.revert();
    entranceCtx = null;
    entrancePlayed = false;
  }

  function entranceSequence() {

    /*
     * The sequence: stars wake in the dark, the atmosphere ring ignites around
     * the silhouette, dawn sweeps across the surface to reveal the cloudy
     * crescent, the nebula breathes in, the heading settles row by row, and the
     * pink glint pops on the night side.
     */
    const tl = gsap.timeline({ defaults: { ease: 'power2.inOut' } });
    tl.to(uni.uReveal, { value: 1, duration: 1.4 }, 0)
      .to(uni.uGlow, { value: 1, duration: 2.0, ease: 'power2.out' }, 0.5)
      .to(uni.uSurf, { value: 1, duration: 2.8 }, 1.0)
      .to(uni.uNeb, { value: 1, duration: 2.4, ease: 'power2.out' }, 1.6);

    letters.forEach((m, i) => {
      tl.fromTo(
        m.position,
        { y: m.userData.baseY - 0.16 },
        { y: m.userData.baseY, duration: 0.9, ease: 'power3.out' },
        2.6 + i * 0.04
      );
      tl.to(m.material, { opacity: 0.95, duration: 0.7, ease: 'power2.out' }, 2.6 + i * 0.04);
    });

    tl.fromTo(uni.uStar, { value: 0 }, { value: 1, duration: 1.2, ease: 'back.out(2.2)' }, 4.0);

    echoes.forEach((m, i) => {
      tl.fromTo(
        m.scale,
        { x: 0.7, y: 0.7 },
        { x: 1, y: 1, duration: 1.1, ease: 'back.out(1.6)' },
        4.3 + i * 0.22
      );
      tl.to(m.material, { opacity: 0.5, duration: 1.0 }, 4.3 + i * 0.22);
      gsap.to(m.position, {
        y: '+=0.10',
        x: i ? '-=0.06' : '+=0.06',
        duration: 6 + i,
        repeat: -1,
        yoyo: true,
        ease: 'sine.inOut',
        delay: 5.8,
      });
    });

    /* the atmosphere keeps breathing */
    gsap.to(uni.uGlow, {
      value: 0.86,
      duration: 4.6,
      repeat: -1,
      yoyo: true,
      ease: 'sine.inOut',
      delay: 5.5,
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
    /* No entrance to play, so every stage is placed at its settled value. */
    uni.uReveal.value = 1;
    uni.uGlow.value = 1;
    uni.uSurf.value = 1;
    uni.uNeb.value = 1;
    uni.uStar.value = 1;
    letters.forEach((m) => {
      m.material.opacity = 0.95;
    });
    echoes.forEach((m) => {
      m.material.opacity = 0.5;
    });
    renderer.clear();
    renderer.render(bgScene, bgCam);
    renderer.clearDepth();
    renderer.render(txScene, txCam);
    return;
  }

  new IntersectionObserver(
    ([entry]) => {
      onScreen = entry.isIntersecting;
      if (!onScreen) resetEntrance();
      sync();
    },
    { rootMargin: '200px' }
  ).observe(host);

  document.addEventListener('visibilitychange', sync);
}

/* -------------------------------------------------------------------------
 * Engineering Capabilities background — the halo
 *
 * The supplied sketch, ported from three r128 to r185, replacing the grain
 * spheres. Two passes share one renderer:
 *
 *   1. An orthographic full-screen quad drawing three overlapping ring
 *      layers. Each ring carries white-hot segments that orbit it forever,
 *      wrapped in violet haze, and each can draw itself around the circle
 *      for the entrance.
 *   2. A perspective pass lettering ENGINEERING / CAPABILITIES in two centred
 *      rows inside the halo, in the same treatment as the other fields, plus
 *      two coloured echoes.
 *
 * The word stays on screen — it is the section's heading, so the entrance
 * fades it in and leaves it there. The real heading is the visually-hidden
 * h2, which keeps the document outline, search and text selection intact.
 * ---------------------------------------------------------------------- */
const HALO_RING_COUNT = 3;

const HALO_FRAGMENT_SHADER = `
  precision highp float;
  uniform vec2  uRes, uPtr;
  uniform float uTime, uReveal;
  uniform float uRev[${HALO_RING_COUNT}];

  const float TAU = 6.28318530718;

  float hot(float th, float a, float w){
    float d = abs(atan(sin(th - a), cos(th - a)));
    return exp(-pow(d/w, 2.0));
  }

  void main(){
    vec2 uv = (gl_FragCoord.xy - 0.5*uRes)/min(uRes.x,uRes.y)*2.0;
    vec3 col = vec3(0.008, 0.005, 0.016);

    /* per-ring: centre offset, radius, tint, rotation speed, sweep start */
    vec2  C[${HALO_RING_COUNT}];
    float R[${HALO_RING_COUNT}];
    vec3  T[${HALO_RING_COUNT}];
    float ROT[${HALO_RING_COUNT}];
    float A0[${HALO_RING_COUNT}];

    C[0]=vec2( 0.000, 0.015); R[0]=0.620; T[0]=vec3(0.62,0.32,1.00); ROT[0]= 0.12; A0[0]=2.20;
    C[1]=vec2( 0.014,-0.010); R[1]=0.598; T[1]=vec3(0.30,0.42,1.00); ROT[1]=-0.09; A0[1]=5.30;
    C[2]=vec2(-0.012, 0.012); R[2]=0.648; T[2]=vec3(0.55,0.28,0.95); ROT[2]= 0.06; A0[2]=0.60;

    float breathe = 1.0 + 0.008*sin(uTime*0.5);

    for(int i=0;i<${HALO_RING_COUNT};i++){
      vec2 c = C[i] + uPtr*0.020*(1.0+float(i)*0.4);
      float r = R[i]*breathe;
      vec2 q = uv - c;
      float e = abs(length(q) - r);
      float th = atan(q.y, q.x);

      /* the entrance sweep: the ring draws itself around */
      float norm = fract((th - A0[i]) / TAU);
      float m = smoothstep(norm - 0.015, norm, uRev[i]);

      /* orbiting hot segments */
      float a1 = A0[i] + 0.55 + uTime*ROT[i];
      float a2 = A0[i] + 3.60 + uTime*ROT[i]*1.35;
      float heat = 0.30
                 + 1.55 * hot(th, a1, 0.55)
                 + 1.05 * hot(th, a2, 0.42)
                 + 0.45 * hot(th, a1 + 2.1, 0.9);

      float core = exp(-pow(e*170.0, 2.0));
      float mid  = exp(-pow(e* 46.0, 2.0));
      float halo = exp(-e*8.5);

      col += T[i] * mid  * heat * 0.85 * m;
      col += vec3(1.0,0.96,1.0) * core * heat * 1.25 * m;
      col += T[i] * halo * (0.22 + 0.30*heat) * 0.32 * m;
    }

    /* faint smoky wisps hugging the outside of the halo */
    float dw = abs(length(uv) - 0.63);
    float wisp = exp(-dw*4.0) * (0.5 + 0.5*sin(atan(uv.y,uv.x)*3.0 + uTime*0.25));
    col += vec3(0.30,0.14,0.55) * wisp * 0.10 * uRev[0];

    col *= 1.0 - 0.28*pow(length(uv*vec2(0.55,0.55)), 2.4);
    col += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898,78.233)))*43758.5453)-0.5)/255.0;
    gl_FragColor = vec4(col * uReveal, 1.0);
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
   * Same r128 grade as the other fields: the shader hand-rolls its own ramps
   * and adds a 1/255 dither, and an sRGB transfer on the way out would crush
   * the ring's core, mid and halo terms into one flat band.
   */
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setPixelRatio(pixelRatioFor(2, 1.25));
  /* Two passes into one buffer, so the clear is driven by hand. */
  renderer.autoClear = false;
  host.appendChild(renderer.domElement);

  /* --- pass 1: the halo ---------------------------------------------------- */
  const bgScene = new THREE.Scene();
  const bgCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  /*
   * A plain array, mutated in place. three uploads it with uniform1fv on every
   * render, so the entrance can write revArr[i] straight from a GSAP tween
   * with no needsUpdate bookkeeping.
   */
  const revArr = new Array(HALO_RING_COUNT).fill(0);
  const uni = {
    uRes: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 },
    uPtr: { value: new THREE.Vector2(0, 0) },
    uReveal: { value: 0 },
    uRev: { value: revArr },
  };

  bgScene.add(
    new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        uniforms: uni,
        vertexShader: 'void main(){ gl_Position = vec4(position,1.0); }',
        fragmentShader: HALO_FRAGMENT_SHADER,
      })
    )
  );

  /* --- pass 2: ENGINEERING / CAPABILITIES --------------------------------- */
  const txScene = new THREE.Scene();
  const txCam = new THREE.PerspectiveCamera(40, 1, 0.1, 50);
  txCam.position.z = 6;

  const LETTER_SIZE = 0.205;
  const LETTER_GAP = 0.215;
  /*
   * Half the height of a row band, in scene units: half a row's glyph plus the
   * half-gap to the other row's centre.
   */
  const BAND_HALF = 0.155 + LETTER_SIZE / 2;

  /*
   * Deviation from the sketch, and the one piece of geometry here that is
   * measured rather than fixed.
   *
   * The sketch had nothing in the frame but the word, so it sat dead centre.
   * Here a capability card shares the halo, and centred rows put the card
   * straight on top of CAPABILITIES. A fixed lift cannot fix that at both
   * aspect ratios either: on a wide box the section flex-ends its content low
   * in a tall halo and a small lift is enough, but on a phone the section
   * collapses to a block and the deck starts at the very top of a short one, so
   * the same lift leaves the card covering the word by ~160px.
   *
   * So the lift is derived from where the deck actually is, on every resize: put the
   * bottom of the word band a fixed margin above the top of the deck, then
   * clamp so the band cannot climb out of the frame. On a wide box that lands
   * the word inside the halo's upper half, as the sketch intends; on a phone,
   * where the rings are only as wide as the screen and the card is taller than
   * the circle, the clamp lifts the word clear above them, where it reads as
   * the section's heading rather than as a label buried under a card.
   */
  /*
   * Generous on purpose. The px<->world conversion below treats the rows as if
   * they sat on the z=0 plane, but they are scattered over z -0.06..0.06 and the
   * camera tilts slightly with the pointer, so the real projection lands a few
   * percent lower than the arithmetic predicts — enough, at 24px, for the card's
   * top edge to clip the bottom of CAPABILITIES.
   */
  const DECK_GAP_PX = 64;
  const deckEl = document.querySelector('.concepts-deck');

  function rowLift(scale, fieldRect) {
    if (!deckEl) return 0.7; /* the sketch's own placement, near enough */
    const halfHeight = Math.tan(((txCam.fov / 2) * Math.PI) / 180) * txCam.position.z;
    const halfPx = fieldRect.height / 2;
    const deckTopPx = deckEl.getBoundingClientRect().top - fieldRect.top;

    /* world y of the point DECK_GAP_PX above the deck's top edge */
    const wantBottom = ((halfPx - (deckTopPx - DECK_GAP_PX)) / halfPx) * halfHeight;
    const lift = wantBottom / scale + BAND_HALF;

    /*
     * Cap it against the field's own top mask, not against the frame edge.
     * .capability-field fades from transparent to opaque over its top 12%, so a
     * band lifted into that strip is faded out with the artwork — which is
     * exactly what happened on a phone: the word was placed correctly and drawn
     * at 25% alpha, so it read as missing.
     */
    const maskFloorPx = fieldRect.height * 0.14;
    const maxBottom = ((halfPx - maskFloorPx) / halfPx) * halfHeight;
    const maxLift = maxBottom / scale - BAND_HALF;
    return Math.max(0, Math.min(lift, maxLift));
  }

  const letters = [];
  function makeRow(word, y) {
    const width = (word.length - 1) * LETTER_GAP;
    [...word].forEach((ch, i) => {
      letters.push(
        makeLetter(
          txScene,
          ch,
          'rgba(240,236,250,0.95)',
          /*
           * A dark halo, where the other fields pass null. Those words sit over
           * empty space; this one is threaded through the halo's top arc, so a
           * bare white glyph crossing a lit ring loses its edge. Same idea as
           * the text-shadow the CSS puts behind copy over this artwork.
           */
          'rgba(0,0,0,0.95)',
          LETTER_SIZE,
          -width / 2 + i * LETTER_GAP,
          y,
          Math.sin(letters.length * 1.7) * 0.06,
          false
        )
      );
    });
  }
  /* Laid out around y=0; resize() lifts the whole row group into place. */
  makeRow('ENGINEERING', 0.155);
  makeRow('CAPABILITIES', -0.155);
  const rows = new THREE.Group();
  letters.forEach((m) => rows.add(m));
  txScene.add(rows);

  /* the wider row sets the fit; CAPABILITIES is 12 glyphs */
  const WORD_HALF = (11 * LETTER_GAP) / 2 + LETTER_SIZE / 2;

  const echoes = [
    makeLetter(txScene, 'E', '#8a4bff', 'rgba(138,75,255,0.9)', 0.34, -1.8, 1.35, -0.4, true),
    makeLetter(txScene, 'C', '#4653f0', 'rgba(70,83,240,0.9)', 0.32, 1.95, -1.3, -0.5, true),
  ];

  /* --- resize / pointer / loop -------------------------------------------- */
  function resize() {
    const w = host.clientWidth;
    const h = host.clientHeight;
    if (!w || !h) return;

    renderer.setSize(w, h, false);
    uni.uRes.value.set(w * renderer.getPixelRatio(), h * renderer.getPixelRatio());
    txCam.aspect = w / h;
    txCam.updateProjectionMatrix();

    /*
     * The halo is sized off the SMALLER dimension — its radius is 0.62 in a uv
     * space normalised by min(w,h) — so the rows are fitted against that
     * circle rather than against the frustum. The sketch's own term is the
     * first: the row is held to 82% of the halo's diameter.
     *
     * fitScale is kept as a second cap for the pathological case where the
     * halo is wider than the frame, but on every ordinary box the halo term is
     * the binding one, which is what keeps CAPABILITIES inside the rings on a
     * phone instead of spilling across them.
     */
    const frameHalfH = Math.tan(((txCam.fov / 2) * Math.PI) / 180) * txCam.position.z;
    const haloDiameter = 2 * 0.62 * frameHalfH * Math.min(1, w / h);
    const scale = Math.min(
      1,
      (haloDiameter * 0.82) / (WORD_HALF * 2),
      fitScale(txCam, w / h, WORD_HALF)
    );
    txScene.scale.setScalar(scale);
    rows.position.y = rowLift(scale, host.getBoundingClientRect());
  }
  /* Observed rather than measured once: the section is still pre-layout here. */
  resize();
  new ResizeObserver(resize).observe(host);

  const target = { x: 0, y: 0 };
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
  let frameId = null;
  let onScreen = false;

  function frame() {
    frameId = requestAnimationFrame(frame);
    const t = prefersReducedMotion ? 0 : clock.getElapsedTime();
    uni.uTime.value = t;

    const p = uni.uPtr.value;
    p.x += (target.x - p.x) * 0.045;
    p.y += (target.y - p.y) * 0.045;

    txCam.position.x = p.x * 0.28;
    txCam.position.y = p.y * 0.2;
    txCam.lookAt(0, 0, 0);

    if (!prefersReducedMotion) {
      letters.forEach((m, i) => {
        m.position.y = m.userData.baseY + Math.sin(t * 0.5 + i * 0.5) * 0.008;
      });
    }

    renderer.clear();
    renderer.render(bgScene, bgCam);
    renderer.clearDepth();
    renderer.render(txScene, txCam);
  }

  let entrancePlayed = false;
  let entranceCtx = null;

  /*
   * Held until the section is on screen. Fired on load, the rings would have
   * finished drawing themselves long before anyone scrolled this far down.
   */
  function playEntrance() {
    if (entrancePlayed) return;
    entrancePlayed = true;
    entranceCtx = gsap.context(entranceSequence);
  }

  /*
   * Rewound whenever the section leaves the screen, so scrolling back to it
   * starts the sequence from black instead of dropping you into a scene that
   * finished minutes ago. The context is what makes that safe: it collects
   * every tween the sequence creates — including the infinite float and
   * breathe loops, which would otherwise stack a fresh copy on each visit —
   * and revert() both kills them and restores the values they started from.
   *
   * A hidden tab only pauses; it does not rewind. Coming back to a tab is not
   * arriving at the section.
   */
  function resetEntrance() {
    if (entranceCtx) entranceCtx.revert();
    entranceCtx = null;
    entrancePlayed = false;
  }

  function entranceSequence() {

    const tl = gsap.timeline({ defaults: { ease: 'power2.inOut' } });
    tl.to(uni.uReveal, { value: 1, duration: 1.0 }, 0);

    /* each ring ignites and draws itself around the circle */
    for (let i = 0; i < HALO_RING_COUNT; i++) {
      const o = { v: 0 };
      tl.to(
        o,
        {
          v: 1,
          duration: 1.6,
          ease: 'power2.inOut',
          onUpdate() {
            revArr[i] = o.v;
          },
        },
        0.25 + i * 0.3
      );
    }

    /*
     * Then the two rows settle in, letter by letter, left to right — and stay.
     * The entrance only ever raises their opacity; nothing later takes the
     * word back down, because it is the section's heading.
     */
    letters.forEach((m, i) => {
      tl.fromTo(
        m.position,
        { y: m.userData.baseY - 0.16 },
        { y: m.userData.baseY, duration: 0.9, ease: 'power3.out' },
        1.7 + i * 0.045
      );
      tl.to(m.material, { opacity: 0.95, duration: 0.7, ease: 'power2.out' }, 1.7 + i * 0.045);
    });
    echoes.forEach((m, i) => {
      tl.fromTo(
        m.scale,
        { x: 0.7, y: 0.7 },
        { x: 1, y: 1, duration: 1.1, ease: 'back.out(1.6)' },
        3.1 + i * 0.22
      );
      tl.to(m.material, { opacity: 0.5, duration: 1.0 }, 3.1 + i * 0.22);
      gsap.to(m.position, {
        y: '+=0.10',
        x: i ? '-=0.06' : '+=0.06',
        duration: 6 + i,
        repeat: -1,
        yoyo: true,
        ease: 'sine.inOut',
        delay: 4.5,
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
    revArr.fill(1);
    /* No entrance to play, so the word is placed at its settled values. */
    letters.forEach((m) => {
      m.material.opacity = 0.95;
    });
    echoes.forEach((m) => {
      m.material.opacity = 0.5;
    });
    renderer.clear();
    renderer.render(bgScene, bgCam);
    renderer.clearDepth();
    renderer.render(txScene, txCam);
    return;
  }

  new IntersectionObserver(
    ([entry]) => {
      onScreen = entry.isIntersecting;
      if (!onScreen) resetEntrance();
      sync();
    },
    { rootMargin: '200px' }
  ).observe(host);

  document.addEventListener('visibilitychange', sync);
}

/* -------------------------------------------------------------------------
 * Services background — the eclipse
 *
 * The supplied sketch, ported from three r128 to r185. Two torus-faced orbs
 * kissing at a white-hot point: silver above lit from below, violet below lit
 * from above. Light crawls around each limb outward from the contact, and each
 * face carries a soft inner ring. Two passes share one renderer, so
 * `renderer.autoClear` is off and the clear is driven by hand.
 * ---------------------------------------------------------------------- */
const ECLIPSE_FRAGMENT_SHADER = `
  precision highp float;
  uniform vec2  uRes, uPtr;
  uniform float uTime, uReveal, uCore, uSweep, uRing;

  vec3 orb(vec2 uv, vec2 C, float R, float side, vec3 tint){
    /* side = +1: lit from below (the top orb)
       side = -1: lit from above (the bottom orb) */
    vec2 q = (uv - C)/R;
    float r = length(q);
    if(r > 1.6) return vec3(0.0);
    float th = atan(q.y, q.x);

    /* the light crawls around the limb away from the kiss */
    float contact = side > 0.0 ? -1.5707963 : 1.5707963;
    float ad = abs(atan(sin(th - contact), cos(th - contact)));
    float m = 1.0 - smoothstep(uSweep*3.35 - 0.22, uSweep*3.35 + 0.06, ad);

    float inside = 1.0 - smoothstep(0.99, 1.015, r);
    float nz = sqrt(max(1.0 - r*r, 0.0));
    vec3  n  = vec3(q, nz);
    vec3  L  = normalize(vec3(0.0, -side, 0.55));
    float diff = pow(max(dot(n, L), 0.0), 2.4);

    /* faint body — the orb barely emerges from black */
    vec3 col = tint * diff * 0.22 * inside;

    /* the outer limb: bright toward the kiss, white-hot at it */
    float rim  = exp(-pow((r - 1.0)*24.0, 2.0));
    float rimW = pow(max(-side*sin(th), 0.0), 1.7);
    col += tint * rim * (0.10 + 1.45*rimW) * 1.0;
    col += vec3(1.0,0.99,1.0) * rim * pow(rimW, 3.2) * 0.95;

    /* soft glow bleeding just outside the lit limb */
    float e = max(r - 1.0, 0.0);
    col += tint * exp(-e*10.0) * rimW * 0.35 * step(1.0, r);

    /* the inner ring — the torus hole, shimmering faintly,
       lit on its kiss-facing arc */
    float rr = 0.55 + 0.012*sin(uTime*0.6 + th*2.0);
    float ring = exp(-pow((r - rr)*15.0, 2.0));
    col += tint * ring * (0.08 + 0.30*rimW + 0.10*diff) * uRing;

    return col * m;
  }

  void main(){
    vec2 uv = (gl_FragCoord.xy - 0.5*uRes)/min(uRes.x,uRes.y)*2.0;
    uv += uPtr * 0.022;

    vec3 col = vec3(0.004, 0.004, 0.007);

    vec3 silver = vec3(0.82, 0.85, 0.92);
    vec3 violet = vec3(0.55, 0.36, 0.98);

    float breathe = 1.0 + 0.006*sin(uTime*0.5);

    col += orb(uv, vec2(0.0,  0.435*breathe), 0.415, +1.0, silver);
    col += orb(uv, vec2(0.0, -0.435*breathe), 0.415, -1.0, violet);

    /* the kiss: a white-violet star where the limbs meet */
    float cd = length((uv - vec2(0.0, 0.0)) * vec2(1.0, 1.9));
    vec3 kiss = mix(violet, vec3(1.0,0.99,1.0), 0.62);
    col += kiss * (exp(-cd*24.0)*1.25 + exp(-cd*7.5)*0.32) * uCore;

    /* quiet scrim over the bottom band, where the heading lives */
    col *= 1.0 - 0.20*smoothstep(0.42, 0.95, -uv.y);
    col *= 1.0 - 0.26*pow(length(uv*vec2(0.55,0.55)), 2.4);
    col += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898,78.233)))*43758.5453)-0.5)/255.0;
    gl_FragColor = vec4(col * uReveal, 1.0);
  }
`;

function initServicesField() {
  const host = document.querySelector('#services-field');
  if (!host) return;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  } catch (error) {
    console.error('Services field: no WebGL context', error);
    return;
  }

  /*
   * Same r128 grade as the other fields: the shader hand-rolls its rim, halo
   * and kiss terms and adds a 1/255 dither, and an sRGB transfer on the way out
   * would crush the three into one flat bloom.
   */
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setPixelRatio(pixelRatioFor(2, 1.25));
  renderer.autoClear = false;
  host.appendChild(renderer.domElement);

  /* --- pass 1: the eclipse ------------------------------------------------- */
  const bgScene = new THREE.Scene();
  const bgCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const uni = {
    uRes: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 },
    uPtr: { value: new THREE.Vector2(0, 0) },
    uReveal: { value: 0 },
    uCore: { value: 0 } /* the kiss-point bloom            */,
    uSweep: { value: 0 } /* light crawling around the limbs */,
    uRing: { value: 0 } /* the inner rings                 */,
  };

  bgScene.add(
    new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        uniforms: uni,
        vertexShader: 'void main(){ gl_Position = vec4(position,1.0); }',
        fragmentShader: ECLIPSE_FRAGMENT_SHADER,
      })
    )
  );

  /* --- pass 2: AI AND AUTOMATION ------------------------------------------ */
  const txScene = new THREE.Scene();
  const txCam = new THREE.PerspectiveCamera(40, 1, 0.1, 50);
  txCam.position.z = 6;

  /*
   * The camera's rest pose, cloned. resize() solves the row's world y against
   * this rather than against txCam, or the word would slide up and down as the
   * pointer nudged the live camera. See the same trick in initAboutField.
   */
  const restCam = new THREE.PerspectiveCamera(40, 1, 0.1, 50);
  restCam.position.set(0, 0, 6);
  restCam.lookAt(0, -0.35, 0);
  restCam.updateMatrixWorld(true);
  const probe = new THREE.Vector3();
  const halfFrame = Math.tan(((40 / 2) * Math.PI) / 180) * 6;

  const LETTER_SIZE = 0.235;
  const LETTER_GAP = 0.245;
  const WORD = 'AI AND AUTOMATION';

  /*
   * The plate is what makes the word legible: it crosses the violet orb's lit
   * limb, so each glyph carries a blurred near-black copy of itself underneath.
   * See letterTexture's opts.
   */
  const GLYPH = { weight: 200, plate: 'rgba(6,4,14,0.9)' };

  const letters = [];
  {
    const width = (WORD.length - 1) * LETTER_GAP;
    [...WORD].forEach((ch, i) => {
      if (ch === ' ') return;
      letters.push(
        makeLetter(
          txScene,
          ch,
          'rgba(242,238,248,0.95)',
          null,
          LETTER_SIZE,
          -width / 2 + i * LETTER_GAP,
          0 /* resize() places the row; see rowFraction */,
          Math.sin(letters.length * 1.7) * 0.06,
          false,
          GLYPH
        )
      );
    });
  }
  const WORD_HALF = ((WORD.length - 1) * LETTER_GAP) / 2 + LETTER_SIZE / 2;

  const echoes = [
    makeLetter(txScene, 'A', '#8a4bff', 'rgba(138,75,255,0.9)', 0.34, -2.55, -1.2, -0.4, true),
    makeLetter(txScene, 'N', '#9aa8c8', 'rgba(154,168,200,0.9)', 0.32, 2.6, -2.1, -0.5, true),
  ];

  /*
   * Where the row lands, as a fraction of the field's height.
   *
   * The sketch pinned it at world y = -1.72, which it could: it had nothing in
   * frame but the word. Here a card and a hint line sit above it, and the
   * section is one screen tall, so the row follows the bottom of the copy
   * instead — clamped so it can neither climb into the card nor fall off the
   * bottom edge.
   */
  const hintEl = document.querySelector('#services-hint');
  function rowFraction(fieldRect) {
    let f = 0.88;
    if (hintEl) {
      /*
       * 58px, not the ~30 it looks like it needs: the fraction names where the
       * row's *centre* lands, so half a glyph — around 23px at this size — sits
       * above it and eats most of the gap.
       */
      f = (hintEl.getBoundingClientRect().bottom - fieldRect.top + 58) / fieldRect.height;
    }
    /* 0.92, not 1: past that the row runs into the field's own bottom mask,
       which fades from 90% and would draw the word at half alpha. */
    return Math.min(Math.max(f, 0.6), 0.92);
  }

  /* --- resize / pointer / loop -------------------------------------------- */
  function resize() {
    const w = host.clientWidth;
    const h = host.clientHeight;
    if (!w || !h) return;

    renderer.setSize(w, h, false);
    uni.uRes.value.set(w * renderer.getPixelRatio(), h * renderer.getPixelRatio());
    txCam.aspect = w / h;
    txCam.updateProjectionMatrix();

    /*
     * The sketch's own term, capped by fitScale. Its 0.52 floor has the same
     * flaw as the other sketches': at 0.52 this 17-glyph row still spans 1.08
     * world units either side of centre, and a portrait frustum is nowhere near
     * that wide, so AUTOMATION loses its outer glyphs.
     */
    const scale = Math.min(1, Math.max(0.52, w / h / 1.3), fitScale(txCam, w / h, WORD_HALF));
    txScene.scale.setScalar(scale);

    /*
     * Bisect the real projection for the world y that lands on the target
     * fraction. Algebra will not do it: lookAt(0, -0.35, 0) tilts the view, and
     * the perspective divide makes the mapping non-linear. 40 halvings on a
     * resize costs nothing. Dividing by the scale converts the world y into the
     * local y the scaled scene needs.
     */
    restCam.aspect = txCam.aspect;
    restCam.updateProjectionMatrix();

    const targetNdcY = 1 - 2 * rowFraction(host.getBoundingClientRect());
    let lo = -halfFrame * 4;
    let hi = halfFrame * 4;
    for (let k = 0; k < 40; k++) {
      const mid = (lo + hi) / 2;
      probe.set(0, mid, 0).project(restCam);
      if (probe.y > targetNdcY) hi = mid;
      else lo = mid;
    }
    const y = (lo + hi) / 2 / scale;

    letters.forEach((m) => {
      m.userData.baseY = y;
      m.position.y = y;
    });
  }
  /* Observed rather than measured once: the section is still pre-layout here. */
  resize();
  new ResizeObserver(resize).observe(host);

  const target = { x: 0, y: 0 };
  /* The field is pointer-events:none so the card keeps its hover, so the cursor
     is read off the section and converted against the field's own box. */
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
  let frameId = null;
  let onScreen = false;

  function draw() {
    renderer.clear();
    renderer.render(bgScene, bgCam);
    renderer.clearDepth();
    renderer.render(txScene, txCam);
  }

  function frame() {
    frameId = requestAnimationFrame(frame);
    const t = prefersReducedMotion ? 0 : clock.getElapsedTime();
    uni.uTime.value = t;

    const p = uni.uPtr.value;
    p.x += (target.x - p.x) * 0.045;
    p.y += (target.y - p.y) * 0.045;

    txCam.position.x = p.x * 0.26;
    txCam.position.y = p.y * 0.18;
    txCam.lookAt(0, -0.35, 0);

    if (!prefersReducedMotion) {
      letters.forEach((m, i) => {
        m.position.y = m.userData.baseY + Math.sin(t * 0.5 + i * 0.45) * 0.007;
      });
    }

    draw();
  }

  let entrancePlayed = false;
  let entranceCtx = null;

  /*
   * Held until the section is on screen. The sequence runs about six seconds —
   * fired on load, the kiss would have ignited and the limbs finished lighting
   * long before anyone scrolled down to it.
   */
  function playEntrance() {
    if (entrancePlayed) return;
    entrancePlayed = true;
    entranceCtx = gsap.context(entranceSequence);
  }

  /*
   * Rewound whenever the section leaves the screen, so scrolling back to it
   * starts the sequence from black instead of dropping you into a scene that
   * finished minutes ago. The context is what makes that safe: it collects
   * every tween the sequence creates — including the infinite float and breathe
   * loops, which would otherwise stack a fresh copy on each visit — and
   * revert() both kills them and restores the values they started from.
   *
   * A hidden tab only pauses; it does not rewind.
   */
  function resetEntrance() {
    if (entranceCtx) entranceCtx.revert();
    entranceCtx = null;
    entrancePlayed = false;
  }

  function entranceSequence() {
    /*
     * The sequence: out of pure black the kiss ignites, light crawls around
     * both limbs away from it, the inner rings surface, then the heading
     * settles in beneath, letter by letter.
     */
    const tl = gsap.timeline({ defaults: { ease: 'power2.inOut' } });
    tl.to(uni.uReveal, { value: 1, duration: 0.9 }, 0)
      .fromTo(uni.uCore, { value: 0 }, { value: 1, duration: 1.1, ease: 'back.out(2.0)' }, 0.4)
      .to(uni.uSweep, { value: 1, duration: 2.4 }, 0.9)
      .to(uni.uRing, { value: 1, duration: 1.6, ease: 'power2.out' }, 2.2);

    letters.forEach((m, i) => {
      tl.fromTo(
        m.position,
        { y: m.userData.baseY - 0.16 },
        { y: m.userData.baseY, duration: 0.9, ease: 'power3.out' },
        2.8 + i * 0.05
      );
      tl.to(m.material, { opacity: 0.95, duration: 0.7, ease: 'power2.out' }, 2.8 + i * 0.05);
    });

    echoes.forEach((m, i) => {
      tl.fromTo(
        m.scale,
        { x: 0.7, y: 0.7 },
        { x: 1, y: 1, duration: 1.1, ease: 'back.out(1.6)' },
        4.0 + i * 0.22
      );
      tl.to(m.material, { opacity: 0.5, duration: 1.0 }, 4.0 + i * 0.22);
      gsap.to(m.position, {
        y: '+=0.10',
        x: i ? '-=0.06' : '+=0.06',
        duration: 6 + i,
        repeat: -1,
        yoyo: true,
        ease: 'sine.inOut',
        delay: 5.5,
      });
    });

    /* the kiss keeps breathing */
    gsap.to(uni.uCore, {
      value: 0.82,
      duration: 3.8,
      repeat: -1,
      yoyo: true,
      ease: 'sine.inOut',
      delay: 5,
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
    /* No entrance to play, so every stage is placed at its settled value. */
    uni.uReveal.value = 1;
    uni.uCore.value = 1;
    uni.uSweep.value = 1;
    uni.uRing.value = 1;
    letters.forEach((m) => {
      m.material.opacity = 0.95;
    });
    echoes.forEach((m) => {
      m.material.opacity = 0.5;
    });
    draw();
    return;
  }

  new IntersectionObserver(
    ([entry]) => {
      onScreen = entry.isIntersecting;
      if (!onScreen) resetEntrance();
      sync();
    },
    { rootMargin: '200px' }
  ).observe(host);

  document.addEventListener('visibilitychange', sync);
}

/**
 * The services deck: one capability card at a time, stepped by the arrows.
 *
 * Stepped by hand rather than on a timer like #concepts. Those cards are one
 * sentence each and can afford to leave on their own; these carry three bullets
 * apiece, and a card that takes ten seconds to read cannot also be taken away
 * after four.
 */
function setupServiceDeck() {
  const deck = document.querySelector('#services-deck');
  const cards = gsap.utils.toArray('#services-deck .service-card');
  const prev = document.querySelector('.services-arrow-prev');
  const next = document.querySelector('.services-arrow-next');
  if (!deck || cards.length === 0) return;

  /*
   * Under reduced motion the CSS un-stacks the deck and shows all four down the
   * page — and hides the arrows, which would then have nothing to step through.
   */
  if (prefersReducedMotion) return;

  let current = 0;
  let cycle = null;

  /*
   * inert, not hidden: the off cards have to keep their box so the deck holds
   * the height of the tallest one, but they must not be reachable by tab or
   * readable by a screen reader while they are invisible.
   */
  function mark() {
    cards.forEach((card, i) => {
      card.inert = i !== current;
      card.setAttribute('aria-hidden', i === current ? 'false' : 'true');
    });
  }

  gsap.set(cards, { opacity: 0, pointerEvents: 'none' });
  gsap.set(cards[0], { opacity: 1, pointerEvents: 'auto' });
  mark();

  function go(dir) {
    /*
     * A click mid-transition snaps the running one to its end rather than being
     * dropped. Ignoring it instead makes the arrows feel dead when they are
     * pressed twice quickly, and leaves the deck a step behind the clicks.
     */
    if (cycle) cycle.progress(1).kill();

    const from = cards[current];
    current = (current + dir + cards.length) % cards.length;
    const to = cards[current];
    mark();

    /* The entering card on top of the one leaving. */
    deck.appendChild(to);
    cycle = gsap
      .timeline({
        onComplete() {
          cycle = null;
        },
      })
      .to(from, {
        opacity: 0,
        x: -34 * dir,
        filter: 'blur(5px)',
        duration: 0.4,
        ease: 'power2.in',
        pointerEvents: 'none',
      })
      .fromTo(
        to,
        { opacity: 0, x: 34 * dir, filter: 'blur(5px)' },
        {
          opacity: 1,
          x: 0,
          filter: 'blur(0px)',
          duration: 0.55,
          ease: 'power3.out',
          pointerEvents: 'auto',
        },
        0.18
      );
  }

  if (prev) prev.addEventListener('click', () => go(-1));
  if (next) next.addEventListener('click', () => go(1));

  /*
   * Left/right on the deck itself, so the cards can be stepped without hunting
   * for the arrows once focus is already inside them.
   */
  deck.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      go(1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      go(-1);
    }
  });
}

/* -------------------------------------------------------------------------
 * About Us background — light trail
 *
 * The supplied sketch, ported from three r128 to r185. A flat ribbon of
 * light swept along a CatmullRom path and shaded like a long-exposure brush
 * stroke: fine parallel streak lanes with a white-hot core hugging the upper
 * edge, drawn three times at different widths (soft under-glow, the streak
 * band proper, a tight hot pass) plus three canvas glow sprites, brightest at
 * the hairpin fold.
 *
 * ABOUT US is lettered over it, in the same treatment as THE TEAM and OUR
 * FEATURED WORK: thin tracked glyphs, each a real object at its own depth,
 * with two faint coloured echoes. The letters join `world`, so the cursor
 * parallax and the slow drift carry them along with the stroke — which is
 * what the sketch does, and what makes them read as part of the artwork
 * rather than as text pasted on top of it.
 *
 * The glyphs are decoration: the section's real heading is the
 * visually-hidden h2, which stays selectable, searchable and available to
 * screen readers.
 * ---------------------------------------------------------------------- */
const TRAIL_VERTEX_SHADER = `
  varying vec2 vUv;
  void main(){
    vUv = uv;
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
  }
`;

const TRAIL_FRAGMENT_SHADER = `
  precision highp float;
  uniform float uTime, uReveal, uGlobal;
  uniform float uBase, uLaneAmp, uCoreAmp, uFlow, uPhase;
  varying vec2 vUv;

  void main(){
    float u = vUv.x, v = vUv.y;

    /* entrance: the stroke paints itself left to right */
    float m = clamp((uReveal*1.10 - u)/0.09, 0.0, 1.0);

    /* cross-profile: a sharp-ish TOP edge, all the softness below */
    float upper = 1.0 - smoothstep(0.76, 0.93, v);
    float lower = smoothstep(0.02, 0.55, v);
    float band  = upper * lower;

    /* fine parallel streak lanes across the band */
    float lanes = 0.5 + 0.5*sin((v*22.0 + sin(u*7.0 + uPhase)*0.5) * 3.14159265);
    lanes = pow(lanes, 2.2);

    /* razor core lines hugging the upper part of the band */
    float core = exp(-pow((v-0.72)*26.0, 2.0)) * 1.35
               + exp(-pow((v-0.62)*30.0, 2.0)) * 0.80
               + exp(-pow((v-0.80)*38.0, 2.0)) * 0.50;

    /* along the arc: strong on the left, the TURN ignites,
       the far end thins into a whisper instead of cutting off */
    float along = mix(1.0, 0.55, smoothstep(0.15, 0.72, u));
    along += 0.70 * exp(-pow((u-0.80)*7.0, 2.0));
    float endFade   = 1.0 - smoothstep(0.82, 1.0, u)*0.88;
    float startFade = smoothstep(0.0, 0.05, u);

    float flow = 0.88 + 0.12*sin(6.2831853*(u*2.0 - uTime*uFlow + uPhase));

    vec3 purple = vec3(0.50, 0.14, 1.00);
    vec3 violet = vec3(0.72, 0.40, 1.00);
    vec3 white  = vec3(1.00, 0.96, 1.00);

    vec3 col = purple * lower * (1.0 - smoothstep(0.55, 0.95, v)) * uBase;
    col += violet * band * lanes * uLaneAmp;
    col += white  * core * band * uCoreAmp;

    gl_FragColor = vec4(col * along * endFade * startFade * flow * m * uGlobal, 1.0);
  }
`;

function initAboutUsField() {
  const host = document.querySelector('#about-us-field');
  if (!host) return;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  } catch (error) {
    console.error('About Us field: no WebGL context', error);
    return;
  }

  /*
   * Same r128 grade as the other fields. The ribbon stacks three additive
   * passes whose brightest terms already sit near 1.0; an sRGB transfer on
   * top would crush the streak lanes together into flat white.
   */
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setPixelRatio(pixelRatioFor(2, 1.25));
  renderer.setClearColor(0x000000, 1);
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 60);
  camera.position.set(0, 0, 7.2);

  const world = new THREE.Group();
  scene.add(world);

  /* The stroke: in from the left, dipping, then folding into a hairpin on
     the right before it exits the top of the frame. */
  const PATH = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-6.8, 1.55, 0.0),
    new THREE.Vector3(-4.2, 0.35, 0.0),
    new THREE.Vector3(-1.6, -0.75, 0.0),
    new THREE.Vector3(1.2, -1.05, 0.0),
    new THREE.Vector3(3.6, -0.55, 0.0),
    new THREE.Vector3(5.3, 0.45, 0.0),
    new THREE.Vector3(6.1, 1.6, 0.0) /* the turn        */,
    new THREE.Vector3(5.9, 2.8, 0.0) /* the whisper up  */,
    new THREE.Vector3(5.3, 3.6, 0.0),
  ]);
  const SEGS = 220;
  const COLS = 10;

  /* one continuous taper: a thick band at the left melting into
     thin bright lines through the turn */
  function widthAt(t) {
    return 1.52 * Math.pow(1 - t, 1.15) + 0.1;
  }

  function buildRibbon(widthMul) {
    const pos = [];
    const uv = [];
    const idx = [];
    for (let i = 0; i <= SEGS; i++) {
      const t = i / SEGS;
      const p = PATH.getPoint(t);
      const T = PATH.getTangent(t);
      /* 2D perpendicular in the view plane — the ribbon always faces
         the camera flat, like the long-exposure artwork it mimics */
      const dir = new THREE.Vector3(-T.y, T.x, 0).normalize();
      if (dir.y < 0) dir.negate(); /* uv.y = 1 is always the top edge */
      const half = (widthAt(t) * widthMul) / 2;
      for (let j = 0; j <= COLS; j++) {
        const v = j / COLS;
        const c = v * 2 - 1;
        pos.push(p.x + dir.x * half * c, p.y + dir.y * half * c, p.z);
        uv.push(t, v);
      }
    }
    for (let i = 0; i < SEGS; i++) {
      for (let j = 0; j < COLS; j++) {
        const a = i * (COLS + 1) + j;
        const b = a + COLS + 1;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    return g;
  }

  function ribbonMat(o) {
    return new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uReveal: { value: 0 },
        uGlobal: { value: 1 },
        uBase: { value: o.base },
        uLaneAmp: { value: o.lanes },
        uCoreAmp: { value: o.core },
        uFlow: { value: o.flow },
        uPhase: { value: o.phase },
      },
      vertexShader: TRAIL_VERTEX_SHADER,
      fragmentShader: TRAIL_FRAGMENT_SHADER,
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
  }

  /*
   * The stroke and the word get a group each, both under `world` so they still
   * share its cursor parallax and drift.
   *
   * They need to be framed independently. The stroke is a landscape sweep and
   * has to be turned and refitted on a narrow frame; the word must not turn
   * with it, must keep one apparent size however far the camera pulls back, and
   * has to stay clear of the card. One group for both cannot do all three.
   */
  const stroke = new THREE.Group();
  const wordGroup = new THREE.Group();
  world.add(stroke);
  world.add(wordGroup);

  const ribbons = [];
  function addRibbon(widthMul, opts, z) {
    const mesh = new THREE.Mesh(buildRibbon(widthMul), ribbonMat(opts));
    mesh.position.z = z || 0;
    stroke.add(mesh);
    ribbons.push(mesh);
    return mesh;
  }

  /* wide soft under-glow, the main streak band, a tight hot pass */
  addRibbon(2.4, { base: 0.14, lanes: 0.04, core: 0.0, flow: 0.08, phase: 0.0 }, -0.05);
  addRibbon(1.0, { base: 0.26, lanes: 0.95, core: 0.6, flow: 0.11, phase: 0.4 }, 0.0);
  addRibbon(0.6, { base: 0.08, lanes: 0.6, core: 1.3, flow: 0.14, phase: 1.1 }, 0.03);

  /* bloom pockets: strongest at the fold, softer along the dip */
  function glowSprite(t, scale, alpha) {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 2, 64, 64, 64);
    gr.addColorStop(0, 'rgba(205,155,255,' + alpha + ')');
    gr.addColorStop(0.4, 'rgba(130,50,255,' + alpha * 0.5 + ')');
    gr.addColorStop(1, 'rgba(50,8,150,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
    const sp = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: new THREE.CanvasTexture(c),
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    sp.position.copy(PATH.getPoint(t));
    sp.scale.setScalar(scale);
    stroke.add(sp);
    return sp;
  }
  const sprites = [
    glowSprite(0.2, 3.0, 0.16),
    glowSprite(0.48, 3.4, 0.18),
    glowSprite(0.8, 2.2, 0.48) /* the turn burns brightest */,
  ];
  /* the first two are the soft haze pooling BELOW the arc */
  sprites[0].position.y -= 0.7;
  sprites[1].position.y -= 0.8;

  /* --- ABOUT US ----------------------------------------------------------- */
  const WORD = 'ABOUT US';
  const LETTER_SIZE = 0.36;
  const LETTER_GAP = 0.4;
  const WORD_WIDTH = (WORD.length - 1) * LETTER_GAP;

  const letters = [];
  [...WORD].forEach((ch, i) => {
    if (ch === ' ') return;
    letters.push(
      makeLetter(
        wordGroup,
        ch,
        'rgba(240,236,250,0.95)',
        null,
        LETTER_SIZE,
        -WORD_WIDTH / 2 + i * LETTER_GAP,
        1.05,
        0.25 + Math.sin(i * 1.7) * 0.06,
        false
      )
    );
  });
  /* the coloured strays, as in the reference */
  const echoes = [
    makeLetter(wordGroup, 'B', '#4653f0', 'rgba(70,83,240,0.9)', 0.42, -1.65, 0.42, -0.2, true),
    makeLetter(wordGroup, 'S', '#8a4bff', 'rgba(138,75,255,0.9)', 0.4, 1.95, 1.72, -0.3, true),
  ];
  /* The row's local y, which resize() offsets the whole group against. */
  const WORD_LOCAL_Y = 1.05;
  /* makeLetter only stashes baseY; resize() pulls the strays in by x. */
  echoes.forEach((m) => {
    m.userData.baseX = m.position.x;
  });

  /* --- resize / pointer / loop -------------------------------------------- */
  /*
   * The stroke's true extent from the origin, in world units — read off the
   * built geometry's bounding boxes, not off the path.
   *
   * The path alone spans x -6.8..6.1 and y -1.05..3.6, but the widest of the
   * three ribbon passes is the soft under-glow at widthMul 2.4, which pushes
   * the mesh out by up to 3.6 units perpendicular. Sizing the fit off the path
   * clipped the glow.
   */
  const STROKE_HALF_X = 7.7;
  const STROKE_HALF_Y = 3.7;
  /* Half the word's own width, echoes excluded: WORD_WIDTH/2 + a half glyph. */
  const WORD_HALF = WORD_WIDTH / 2 + LETTER_SIZE / 2;
  const TAN_HALF_FOV = Math.tan(((45 / 2) * Math.PI) / 180);
  /* The camera z the sketch was drawn for, and the apparent size everything
     else is held against. */
  const DESIGN_Z = 7.2;

  const cardEl = document.querySelector('.about-us-card');

  function resize() {
    const w = host.clientWidth;
    const h = host.clientHeight;
    if (!w || !h) return;

    renderer.setSize(w, h, false);
    const a = w / h;
    camera.aspect = a;

    /*
     * On a narrow frame the stroke is turned to run down the long axis.
     *
     * The sketch is a landscape sweep, 13.8 world units wide against 5.8 tall,
     * and the old code framed it head-on at a fixed z with a token pullback
     * below aspect 1. In a portrait box that leaves no good distance: close
     * enough to read and you see a magnified slice of the middle — the fat
     * purple band that made this look broken — and far enough back to fit all
     * 13.8 and it is a thread in an empty frame. Turning it lets the stroke's
     * long axis use the frame's long side, so it stays a sweep at any shape.
     *
     * Wide frames keep the sketch's own crop untouched: at aspect 1.25 and up
     * the turn is zero and z is still 7.2, because there the stroke running off
     * both sides is the intended composition, not a bug.
     */
    const turn = Math.min(1, Math.max(0, (1.25 - a) / 0.65));
    stroke.rotation.z = (-turn * Math.PI) / 2;

    const c = Math.abs(Math.cos(stroke.rotation.z));
    const s = Math.abs(Math.sin(stroke.rotation.z));
    const halfX = STROKE_HALF_X * c + STROKE_HALF_Y * s;
    const halfY = STROKE_HALF_X * s + STROKE_HALF_Y * c;

    /* Whichever of width and height binds, plus a little air — then blended in
       by `turn`, so the change is continuous instead of stepping at 1.25. */
    const fitZ = Math.max(halfY / TAN_HALF_FOV, halfX / (TAN_HALF_FOV * a)) * 1.04;
    camera.position.z = DESIGN_Z + (fitZ - DESIGN_Z) * turn;
    camera.updateProjectionMatrix();

    /*
     * The stroke is nudged down as it turns, so its thick bright entry — which
     * runs along the top once turned — is not sitting straight on the card's
     * first lines. It still crosses the glass lower down, as every field on
     * this site does behind its copy.
     */
    const halfFrameH = TAN_HALF_FOV * camera.position.z;
    stroke.position.y = -turn * halfFrameH * 0.22;

    /*
     * The word does not turn with the stroke, and it is scaled back up by
     * however far the camera pulled away, so ABOUT US reads the same size on a
     * phone as on a desktop instead of shrinking into the artwork.
     *
     * Capped so it cannot outgrow the frame: undoing a 2.4x pullback on a
     * narrow frame made the row wider than the frustum, and ABOUT US rendered
     * as "BOUT U" with both ends cut off.
     */
    const halfFrameW = halfFrameH * a;
    const zoom = Math.min(camera.position.z / DESIGN_Z, (halfFrameW * 0.92) / WORD_HALF);
    wordGroup.scale.setScalar(zoom);

    /*
     * The strays sit further out than the word does, so the same cap would have
     * had to shrink the row to keep them in. They get pulled in instead —
     * they are decoration, and their exact x is not load-bearing.
     */
    echoes.forEach((m) => {
      const limit = (halfFrameW * 0.94) / zoom - m.geometry.parameters.width / 2;
      m.position.x = Math.sign(m.userData.baseX) * Math.min(Math.abs(m.userData.baseX), limit);
    });

    /*
     * And it is placed off the card rather than at the sketch's fixed y=1.05.
     * The card is bottom-aligned and grows as it reflows, so on a narrow frame
     * the fixed row ended up printing straight through the copy. No bisection
     * needed here, unlike the other fields: this camera has no lookAt tilt, so
     * screen position is linear in world y.
     */
    const rect = host.getBoundingClientRect();
    let frac = 0.32; /* the sketch's own position, for when there is no card */
    if (cardEl) {
      const gap = 0.055 * rect.height; /* half a glyph, plus air */
      frac = (cardEl.getBoundingClientRect().top - rect.top - gap) / rect.height;
    }
    frac = Math.min(Math.max(frac, 0.1), 0.5);
    wordGroup.position.y = (0.5 - frac) * 2 * halfFrameH - WORD_LOCAL_Y * zoom;

    if (prefersReducedMotion) renderer.render(scene, camera);
  }
  /* Observed rather than measured once: the section is still pre-layout when
     this runs, exactly as the other fields were. */
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
  let frameId = null;
  let onScreen = false;

  function frame() {
    frameId = requestAnimationFrame(frame);
    const t = prefersReducedMotion ? 0 : clock.getElapsedTime();

    ribbons.forEach((m) => {
      m.material.uniforms.uTime.value = t;
    });

    ptr.x += (target.x - ptr.x) * 0.05;
    ptr.y += (target.y - ptr.y) * 0.05;

    world.rotation.y = ptr.x * 0.14;
    world.rotation.x = -ptr.y * 0.09;

    if (!prefersReducedMotion) {
      world.position.y = Math.sin(t * 0.28) * 0.05;
      letters.forEach((m, i) => {
        m.position.y = m.userData.baseY + Math.sin(t * 0.55 + i * 0.6) * 0.015;
      });
    }

    renderer.render(scene, camera);
  }

  let entrancePlayed = false;
  let entranceCtx = null;

  /*
   * Held until the section is on screen. Fired on load, the stroke would have
   * finished painting itself long before anyone scrolled this far down.
   */
  function playEntrance() {
    if (entrancePlayed) return;
    entrancePlayed = true;
    entranceCtx = gsap.context(entranceSequence);
  }

  /*
   * Rewound whenever the section leaves the screen, so scrolling back to it
   * starts the sequence from black instead of dropping you into a scene that
   * finished minutes ago. The context is what makes that safe: it collects
   * every tween the sequence creates — including the infinite float and
   * breathe loops, which would otherwise stack a fresh copy on each visit —
   * and revert() both kills them and restores the values they started from.
   *
   * A hidden tab only pauses; it does not rewind. Coming back to a tab is not
   * arriving at the section.
   */
  function resetEntrance() {
    if (entranceCtx) entranceCtx.revert();
    entranceCtx = null;
    entrancePlayed = false;
  }

  function entranceSequence() {

    /* the stroke paints itself across the dark, then the fold ignites */
    const tl = gsap.timeline({ defaults: { ease: 'power2.inOut' } });

    ribbons.forEach((m, i) => {
      tl.to(m.material.uniforms.uReveal, { value: 1, duration: 2.6 }, 0.15 + i * 0.12);
    });

    sprites.forEach((s, i) => {
      tl.to(s.material, { opacity: 1, duration: 1.4, ease: 'power2.out' }, 1.3 + i * 0.2);
    });

    /* then the word settles in, letter by letter, left to right */
    letters.forEach((m, i) => {
      tl.fromTo(
        m.position,
        { y: m.userData.baseY - 0.2 },
        { y: m.userData.baseY, duration: 1.0, ease: 'power3.out' },
        2.1 + i * 0.09
      );
      tl.to(m.material, { opacity: 0.95, duration: 0.8, ease: 'power2.out' }, 2.1 + i * 0.09);
    });
    echoes.forEach((m, i) => {
      tl.fromTo(
        m.scale,
        { x: 0.7, y: 0.7 },
        { x: 1, y: 1, duration: 1.1, ease: 'back.out(1.6)' },
        2.9 + i * 0.25
      );
      tl.to(m.material, { opacity: 0.55, duration: 1.0 }, 2.9 + i * 0.25);
    });

    /* the bloom keeps breathing once the entrance has landed */
    sprites.forEach((s, i) => {
      gsap.to(s.material, {
        opacity: 0.55,
        duration: 3.4 + i * 0.5,
        repeat: -1,
        yoyo: true,
        ease: 'sine.inOut',
        delay: 4,
      });
    });
    echoes.forEach((m, i) => {
      gsap.to(m.position, {
        y: '+=0.10',
        x: i ? '-=0.05' : '+=0.05',
        duration: 6 + i,
        repeat: -1,
        yoyo: true,
        ease: 'sine.inOut',
        delay: 4.5,
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
    ribbons.forEach((m) => {
      m.material.uniforms.uReveal.value = 1;
    });
    sprites.forEach((s) => {
      s.material.opacity = 1;
    });
    /* No entrance to play, so the word is placed at its settled values. */
    letters.forEach((m) => {
      m.material.opacity = 0.95;
    });
    echoes.forEach((m) => {
      m.material.opacity = 0.55;
    });
    renderer.render(scene, camera);
    return;
  }

  new IntersectionObserver(
    ([entry]) => {
      onScreen = entry.isIntersecting;
      if (!onScreen) resetEntrance();
      sync();
    },
    { rootMargin: '200px' }
  ).observe(host);

  document.addEventListener('visibilitychange', sync);
}

/* -------------------------------------------------------------------------
 * Built by Makers background — soft-focus orbs + THE TEAM
 *
 * Both of the supplied sketch's passes, ported from three r128:
 *
 *   1. the orbs — one giant violet disc lit from the left with a glowing rim
 *      hugging its lower edge, two dark spheres receding out of the corners,
 *      and a vignette, all breathing on a slow sine;
 *   2. THE TEAM — thin tracked letters, each a real object at its own depth,
 *      with two additive coloured echoes drifting off the row.
 *
 * Two scenes, two cameras, one renderer with autoClear off: the orbs fill the
 * frame from an orthographic quad, then the depth buffer is cleared and the
 * lettering draws over them from a perspective camera that parallaxes off the
 * cursor. The letters are canvas textures, so they are decoration only — the
 * section's real heading lives in the card, where a screen reader can find it.
 *
 * The card is placed clear of the letters rather than over them; see the
 * geometry note on #makers in the stylesheet.
 * ---------------------------------------------------------------------- */
const ORB_FRAGMENT_SHADER = `
  precision highp float;
  uniform vec2  uRes, uPtr;
  uniform float uTime, uReveal, uGlow;

  void main(){
    vec2 uv = (gl_FragCoord.xy - 0.5*uRes)/min(uRes.x,uRes.y)*2.0;

    /* deep purple-black field, faintly warmer toward the orb */
    vec3 col = mix(vec3(0.030,0.018,0.055), vec3(0.055,0.032,0.095),
                   smoothstep(1.2,-1.2, uv.x + uv.y*0.4));

    float breathe = 1.0 + 0.012*sin(uTime*0.4);

    /* ---- the giant violet orb, upper-left ---- */
    vec2  C1 = vec2(-0.42, 0.52) + uPtr*0.045;
    float R1 = 1.08 * breathe;
    vec2  q  = (uv - C1)/R1;
    float d1 = length(q) - 1.0;
    float inside = 1.0 - smoothstep(-0.015, 0.045, d1);

    /* body: lavender-bright toward the left, sinking dark centre-right */
    float lit = smoothstep(0.95, -0.95, q.x + q.y*0.20);
    vec3 body = mix(vec3(0.115,0.070,0.200), vec3(0.545,0.430,0.850), pow(lit, 1.7));

    /* the glowing inner rim hugging the LOWER edge of the disc */
    float nearEdge = smoothstep(0.60, 0.97, length(q)) * (1.0 - smoothstep(0.97, 1.03, length(q)));
    float lowerArc = smoothstep(-0.15, 0.75, -q.y);
    body += vec3(0.560,0.360,0.980) * nearEdge * lowerArc * 1.25 * uGlow;
    body += vec3(0.760,0.620,1.000) * pow(nearEdge,3.0) * lowerArc * 0.55 * uGlow;

    col = mix(col, body, inside);

    /* soft violet haze bleeding just OUTSIDE the lower edge */
    float dOut = max(d1, 0.0) * R1;
    col += vec3(0.400,0.240,0.780) * exp(-pow(dOut*5.5, 1.35)) * lowerArc * (1.0-inside) * 0.55 * uGlow;

    /* ---- dark sphere, bottom-right ---- */
    vec2  C2 = vec2(0.66, -1.02) + uPtr*0.075;
    float R2 = 0.78 * breathe;
    vec2  q2 = (uv - C2)/R2;
    float d2 = length(q2) - 1.0;
    float in2 = 1.0 - smoothstep(-0.02, 0.06, d2);
    float top2 = smoothstep(-0.4, 1.0, q2.y);
    vec3 body2 = mix(vec3(0.040,0.024,0.070), vec3(0.120,0.075,0.190), pow(top2,1.5));
    col = mix(col, body2, in2);

    /* ---- dark arc grazing the top-right corner ---- */
    vec2  C3 = vec2(1.16, 0.82) + uPtr*0.055;
    float R3 = 0.66;
    float d3 = length(uv - C3) - R3;
    float in3 = 1.0 - smoothstep(-0.02, 0.08, d3);
    col = mix(col, vec3(0.036,0.022,0.062), in3*0.85);
    col += vec3(0.20,0.13,0.34) * exp(-pow(abs(d3)*9.0, 2.0)) * 0.35;

    /* vignette + grain dither */
    col *= 1.0 - 0.30*pow(length(uv*vec2(0.55,0.55)), 2.2);
    col += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898,78.233)))*43758.5453)-0.5)/255.0;
    gl_FragColor = vec4(col * uReveal, 1.0);
  }
`;

function initMakersField() {
  const host = document.querySelector('#makers-field');
  if (!host) return;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  } catch (error) {
    console.error('Makers field: no WebGL context', error);
    return;
  }

  /*
   * Same r128 grade as the other fields. The shader writes its own linear
   * ramps and dithers by hand at 1/255; an sRGB transfer on top would lift
   * the near-black field into a muddy grey and swallow the dither.
   */
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  /* The disc's antialiased edge is the whole image, so it gets the full cap. */
  renderer.setPixelRatio(pixelRatioFor(2, 1.25));
  /* Pass 2 draws on top of pass 1, so the frame is cleared by hand in draw(). */
  renderer.autoClear = false;
  host.appendChild(renderer.domElement);

  /* ---- pass 1: the orbs ---- */
  const bgScene = new THREE.Scene();
  const bgCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const uni = {
    uRes: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 },
    uPtr: { value: new THREE.Vector2(0, 0) },
    uReveal: { value: 0 },
    uGlow: { value: 0 },
  };

  bgScene.add(
    new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        uniforms: uni,
        vertexShader: 'void main(){ gl_Position = vec4(position,1.0); }',
        fragmentShader: ORB_FRAGMENT_SHADER,
      })
    )
  );

  /* ---- pass 2: THE TEAM ---- */
  const txScene = new THREE.Scene();
  const txCam = new THREE.PerspectiveCamera(40, 1, 0.1, 50);
  txCam.position.z = 6;

  const WORD = 'THE TEAM';
  const LETTER_SIZE = 0.44;
  const LETTER_GAP = 0.46;
  const WORD_WIDTH = (WORD.length - 1) * LETTER_GAP;
  /* Half the row's extent at scale 1, glyph plane included — resize() needs it
     to work out how far the word has to shrink to fit a narrow frame. */
  const WORD_HALF = WORD_WIDTH / 2 + LETTER_SIZE / 2;

  const letters = [];
  [...WORD].forEach((ch, i) => {
    if (ch === ' ') return;
    letters.push(
      makeLetter(
        txScene,
        ch,
        'rgba(240,236,250,0.95)',
        null,
        LETTER_SIZE,
        -WORD_WIDTH / 2 + i * LETTER_GAP,
        -0.12,
        Math.sin(i * 1.7) * 0.1,
        false
      )
    );
  });
  const echoes = [
    makeLetter(txScene, 'T', '#7a4bff', 'rgba(122,75,255,0.9)', 0.5, -2.15, -0.85, -0.4, true),
    makeLetter(txScene, 'M', '#4653f0', 'rgba(70,83,240,0.9)', 0.46, 2.3, 0.55, -0.5, true),
  ];

  function draw() {
    renderer.clear();
    renderer.render(bgScene, bgCam);
    renderer.clearDepth();
    renderer.render(txScene, txCam);
  }

  function resize() {
    const w = host.clientWidth;
    const h = host.clientHeight;
    if (!w || !h) return;

    renderer.setSize(w, h, false);
    uni.uRes.value.set(w * renderer.getPixelRatio(), h * renderer.getPixelRatio());

    txCam.aspect = w / h;
    txCam.updateProjectionMatrix();

    /*
     * The sketch's own term is `Math.max(0.62, Math.min(1, w / h / 0.9))`, and
     * that floor of 0.62 crops the word on a portrait box — see fitScale() for
     * the full note. Keeping the sketch's term as the upper bound means every
     * landscape width still resolves to exactly 1, bit-for-bit the original.
     */
    txScene.scale.setScalar(Math.min(1, w / h / 0.9, fitScale(txCam, w / h, WORD_HALF)));

    /* Under reduced motion there is no frame loop, so re-issuing the single
       static frame here is the only thing that redraws on a resize. */
    if (prefersReducedMotion) draw();
  }
  /* Observed, not measured once — this section is still pre-layout here. */
  resize();
  new ResizeObserver(resize).observe(host);

  const target = { x: 0, y: 0 };
  /*
   * The field is pointer-events:none so the copy stays selectable, so the
   * cursor is read off the section and converted against the field's own box.
   */
  const section = host.closest('section') || host;
  function fromEvent(e) {
    const r = host.getBoundingClientRect();
    const p = e.touches ? e.touches[0] : e;
    target.x = ((p.clientX - r.left) / r.width - 0.5) * 2;
    target.y = -((p.clientY - r.top) / r.height - 0.5) * 2;
  }
  section.addEventListener('pointermove', fromEvent);
  section.addEventListener('touchmove', fromEvent, { passive: true });
  section.addEventListener('pointerleave', () => {
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
    p.x += (target.x - p.x) * 0.045;
    p.y += (target.y - p.y) * 0.045;

    /* the lettering parallaxes by moving the camera, not the letters */
    txCam.position.x = p.x * 0.3;
    txCam.position.y = p.y * 0.22;
    txCam.lookAt(0, 0, 0);

    letters.forEach((m, i) => {
      m.position.y = m.userData.baseY + Math.sin(t * 0.5 + i * 0.7) * 0.012;
    });

    draw();
  }

  let entrancePlayed = false;
  let entranceCtx = null;

  /*
   * Held until the section is on screen. Fired on load, the field would have
   * finished breathing up from black long before anyone scrolled this far.
   */
  function playEntrance() {
    if (entrancePlayed) return;
    entrancePlayed = true;
    entranceCtx = gsap.context(entranceSequence);
  }

  /*
   * Rewound whenever the section leaves the screen, so scrolling back to it
   * starts the sequence from black instead of dropping you into a scene that
   * finished minutes ago. The context is what makes that safe: it collects
   * every tween the sequence creates — including the infinite float and
   * breathe loops, which would otherwise stack a fresh copy on each visit —
   * and revert() both kills them and restores the values they started from.
   *
   * A hidden tab only pauses; it does not rewind. Coming back to a tab is not
   * arriving at the section.
   */
  function resetEntrance() {
    if (entranceCtx) entranceCtx.revert();
    entranceCtx = null;
    entrancePlayed = false;
  }

  function entranceSequence() {

    /*
     * The field lifts out of black, the rim ignites along the lower edge, then
     * THE TEAM settles in letter by letter, left to right, and the two echoes
     * pop in behind the row.
     */
    const tl = gsap.timeline({ defaults: { ease: 'power2.inOut' } });
    tl.to(uni.uReveal, { value: 1, duration: 1.8 }, 0).to(
      uni.uGlow,
      { value: 1, duration: 2.2, ease: 'power2.out' },
      0.8
    );

    letters.forEach((m, i) => {
      tl.fromTo(
        m.position,
        { y: m.userData.baseY - 0.22 },
        { y: m.userData.baseY, duration: 1.0, ease: 'power3.out' },
        1.6 + i * 0.09
      );
      tl.to(m.material, { opacity: 0.95, duration: 0.8, ease: 'power2.out' }, 1.6 + i * 0.09);
    });
    echoes.forEach((m, i) => {
      tl.fromTo(
        m.scale,
        { x: 0.7, y: 0.7 },
        { x: 1, y: 1, duration: 1.1, ease: 'back.out(1.6)' },
        2.5 + i * 0.25
      );
      tl.to(m.material, { opacity: 0.5, duration: 1.0 }, 2.5 + i * 0.25);
    });

    /* and the rim keeps breathing once the entrance has landed */
    gsap.to(uni.uGlow, {
      value: 0.82,
      duration: 4.2,
      repeat: -1,
      yoyo: true,
      ease: 'sine.inOut',
      delay: 3.6,
    });
    echoes.forEach((m, i) => {
      gsap.to(m.position, {
        y: '+=0.10',
        x: i ? '-=0.06' : '+=0.06',
        duration: 6 + i,
        repeat: -1,
        yoyo: true,
        ease: 'sine.inOut',
        delay: 4,
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
    uni.uGlow.value = 1;
    /* No entrance to play, so the letters are placed at their settled values. */
    letters.forEach((m) => {
      m.material.opacity = 0.95;
    });
    echoes.forEach((m) => {
      m.material.opacity = 0.5;
    });
    draw();
    return;
  }

  new IntersectionObserver(
    ([entry]) => {
      onScreen = entry.isIntersecting;
      if (!onScreen) resetEntrance();
      sync();
    },
    { rootMargin: '200px' }
  ).observe(host);

  document.addEventListener('visibilitychange', sync);
}

/* -------------------------------------------------------------------------
 * Contact background — the halftone sheet
 *
 * Vertex and fragment shaders from the supplied "Deliver tracks" sketch, kept
 * byte for byte. A grid of points is displaced by layered waves whose sum runs
 * live in the vertex shader, sized and coloured by the light on its own slope,
 * sunk into darkness around a central crater, and clipped to a wavy blob
 * silhouette rather than a square sheet edge.
 *
 * These live up here beside the other field shaders, as the liquid they
 * replaced did, rather than inside the initialiser.
 * ---------------------------------------------------------------------- */
const SHEET_VERTEX_SHADER = `
  uniform float uTime, uReveal, uHole, uSize;
  varying float vB, vA;

  float wave(vec2 p, float t){
    float h = 0.0;
    h += 0.42*sin(p.x*1.15 + t*0.50);
    h += 0.36*sin(p.y*1.35 - t*0.42 + 1.7);
    h += 0.25*sin((p.x + p.y)*0.90 + t*0.35 + 3.1);
    h += 0.18*sin(p.x*1.9 - p.y*1.3 + t*0.62 + 0.6);
    h += 0.10*sin(p.x*3.1 + p.y*2.3 - t*0.80);
    /* the crater: the sheet sinks toward the centre */
    float cr = length(p)/uHole;
    h -= 1.15*exp(-cr*cr*1.35);
    return h;
  }

  void main(){
    vec2 p = position.xy;
    float t = uTime;
    float r = length(p);

    float h  = wave(p, t);
    float hx = wave(p + vec2(0.09, 0.0), t);
    float hy = wave(p + vec2(0.0, 0.09), t);

    /* light on the slope, from the upper-left front */
    vec3 n = normalize(vec3(-(hx-h)/0.09, -(hy-h)/0.09, 0.42));
    vec3 L = normalize(vec3(-0.42, 0.62, 0.72));
    float lit = pow(max(dot(n, L), 0.0), 1.35);
    float bright = clamp(0.10 + 0.95*lit + 0.28*h, 0.0, 1.6);

    /* darkness spiralling into the crater */
    float dark = smoothstep(uHole*2.3, uHole*0.92, r);
    bright *= 1.0 - 0.90*dark;

    /* the hole itself: dots vanish where the word lives */
    float holeFade = smoothstep(uHole*0.55, uHole*1.05, r);

    /* wavy blob silhouette instead of a square sheet edge */
    float wob = 0.55*sin(atan(p.y,p.x)*3.0 + 1.2) + 0.35*sin(atan(p.y,p.x)*5.0 - 0.7);
    float sil = 1.0 - smoothstep(3.35 + wob*0.55, 4.05 + wob*0.55, r);

    /* entrance: the dots bloom outward from the crater rim */
    float edge = uHole*0.8 + uReveal*6.2;
    float rev = 1.0 - smoothstep(edge - 0.55, edge + 0.15, r);

    float vis = holeFade * sil * rev;
    vB = bright;
    vA = vis;

    vec3 wp = vec3(p, h*0.62);
    vec4 mv = modelViewMatrix * vec4(wp, 1.0);
    gl_PointSize = uSize * (2.2 + 15.5*bright) * vis * (10.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

const SHEET_FRAGMENT_SHADER = `
  precision highp float;
  uniform float uGlobal;
  varying float vB, vA;
  void main(){
    float d = length(gl_PointCoord - 0.5);
    float a = 1.0 - smoothstep(0.42, 0.5, d);
    vec3 deep = vec3(0.155, 0.055, 0.300);
    vec3 lav  = vec3(0.810, 0.700, 1.000);
    vec3 col = mix(deep, lav, pow(min(vB,1.0), 1.15));
    col += vec3(1.0,0.97,1.0) * pow(max(vB-0.15,0.0), 3.0) * 0.55;
    gl_FragColor = vec4(col, a * vA * uGlobal);
  }
`;

/* =========================================================================
 * Contact field
 *
 * The halftone sheet behind the two delivery cards: a tilted grid of dots
 * rippling around a crater, with DELIVER TRACKS seated inside it and two
 * coloured echoes drifting either side.
 *
 * Two passes into one buffer, as the sketch draws it — the sheet at its own
 * perspective tilt, then the lettering through a second camera that never
 * tilts, so the word stays flat to the viewer while the sheet lies back.
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

  /*
   * Same r128 grade as the other fields: the fragment shader mixes its own
   * two-colour ramp and adds a hand-rolled specular term, both already in the
   * numbers we want out.
   */
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setPixelRatio(pixelRatioFor(2, 1.25));
  renderer.setClearColor(0x040209, 1);
  /* Two passes into one buffer — the second must not wipe the first. */
  renderer.autoClear = false;
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 60);
  camera.position.set(0, 0, 8.6);

  const sheetGroup = new THREE.Group();
  sheetGroup.rotation.x = -0.92; /* the tilted-fabric perspective */
  sheetGroup.rotation.z = 0.22;
  scene.add(sheetGroup);

  /* --- the sheet ---------------------------------------------------------- */
  const GRID = 96;
  const EXTENT = 4.3;
  const pos = new Float32Array(GRID * GRID * 3);
  for (let i = 0, k = 0; i < GRID; i++) {
    for (let j = 0; j < GRID; j++, k++) {
      pos[k * 3] = (i / (GRID - 1) - 0.5) * EXTENT * 2;
      pos[k * 3 + 1] = (j / (GRID - 1) - 0.5) * EXTENT * 2;
      pos[k * 3 + 2] = 0;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));

  const uni = {
    uTime: { value: 0 },
    uReveal: { value: 0 },
    uGlobal: { value: 0 },
    uHole: { value: 1.3 } /* crater radius — the word lives inside it */,
    uSize: { value: 1 } /* dpr-scaled point size */,
  };

  sheetGroup.add(
    new THREE.Points(
      geo,
      new THREE.ShaderMaterial({
        uniforms: uni,
        transparent: true,
        depthWrite: false,
        vertexShader: SHEET_VERTEX_SHADER,
        fragmentShader: SHEET_FRAGMENT_SHADER,
      })
    )
  );

  /* Soft violet ambience pooling beneath the crater. */
  const haze = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 4, 64, 64, 64);
    gr.addColorStop(0, 'rgba(110,50,210,0.20)');
    gr.addColorStop(1, 'rgba(30,8,80,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(c);
    /* Linear renderer, as with the glyph plates — the canvas values are
       already the numbers we want. */
    tex.colorSpace = THREE.NoColorSpace;
    const sp = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    sp.position.set(0, 0, -1.2);
    sp.scale.setScalar(9);
    scene.add(sp);
    return sp;
  })();

  /* --- DELIVER TRACKS ----------------------------------------------------- */
  /*
   * The sketch's own word, kept. The other ported fields swap in the section
   * heading here; this one does not — the real heading is the visually-hidden
   * h2 in the markup, and the glyph row is decoration.
   */
  const txScene = new THREE.Scene();
  const txCam = new THREE.PerspectiveCamera(40, 1, 0.1, 50);
  txCam.position.z = 6;

  const WORD = 'DELIVER TRACKS';
  const LETTER_SIZE = 0.235;
  const LETTER_GAP = 0.245;
  const WORD_WIDTH = (WORD.length - 1) * LETTER_GAP;
  /* Half the row's own width, echoes excluded: half the span, plus a glyph. */
  const WORD_HALF = WORD_WIDTH / 2 + LETTER_SIZE / 2;
  /* The sketch's own glyph treatment: a light weight over a baked dark plate,
     which is what keeps the row legible where the crater rim brightens. */
  const GLYPH = { weight: 200, plate: 'rgba(6,4,14,0.9)' };

  const letters = [];
  [...WORD].forEach((ch, i) => {
    if (ch === ' ') return;
    letters.push(
      makeLetter(
        txScene,
        ch,
        'rgba(244,238,250,0.96)',
        null,
        LETTER_SIZE,
        -WORD_WIDTH / 2 + i * LETTER_GAP,
        0,
        Math.sin(letters.length * 1.7) * 0.05,
        false,
        GLYPH
      )
    );
  });

  /* The coloured strays, as in the reference. */
  const echoes = [
    makeLetter(txScene, 'D', '#a35bff', 'rgba(163,91,255,0.9)', 0.34, -2.6, 1.55, -0.4, true, GLYPH),
    makeLetter(txScene, 'T', '#4653f0', 'rgba(70,83,240,0.9)', 0.32, 2.65, -1.6, -0.5, true, GLYPH),
  ];
  /* makeLetter only stashes baseY; resize() pulls the strays in by x. */
  echoes.forEach((m) => {
    m.userData.baseX = m.position.x;
  });

  /* --- resize / pointer / loop -------------------------------------------- */
  const DESIGN_Z = 8.6;

  function draw() {
    renderer.clear();
    renderer.render(scene, camera);
    renderer.clearDepth();
    renderer.render(txScene, txCam);
  }

  function resize() {
    const w = host.clientWidth;
    const h = host.clientHeight;
    if (!w || !h) return;

    renderer.setSize(w, h, false);
    uni.uSize.value = renderer.getPixelRatio();

    const a = w / h;
    camera.aspect = a;
    /* The sketch's own pullback on portrait boxes: the blob is round, so it
       only ever needs backing off, never turning. */
    camera.position.z = a < 1 ? DESIGN_Z * (1 + (1 - a) * 0.7) : DESIGN_Z;
    camera.updateProjectionMatrix();

    txCam.aspect = a;
    txCam.updateProjectionMatrix();

    /*
     * The sketch's own term, capped so the row cannot outgrow the frame. Its
     * floor of 0.55 does not keep its promise on a narrow box — the row ends
     * up wider than the frustum and the word renders with both ends cut off.
     */
    const sketch = Math.max(0.55, Math.min(1, a / 1.15));
    txScene.scale.setScalar(Math.min(sketch, fitScale(txCam, a, WORD_HALF)));

    /*
     * The strays sit further out than the row does, so the same cap would have
     * had to shrink the word to keep them in frame. They get pulled in
     * instead — they are decoration, and their exact x is not load-bearing.
     */
    const halfFrameW = Math.tan(((txCam.fov / 2) * Math.PI) / 180) * txCam.position.z * a;
    const limitAt = halfFrameW / txScene.scale.x;
    echoes.forEach((m) => {
      const limit = limitAt * 0.94 - m.geometry.parameters.width / 2;
      m.position.x = Math.sign(m.userData.baseX) * Math.min(Math.abs(m.userData.baseX), limit);
    });

    if (prefersReducedMotion) draw();
  }

  const target = { x: 0, y: 0 };
  const ptr = { x: 0, y: 0 };
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

    ptr.x += (target.x - ptr.x) * 0.05;
    ptr.y += (target.y - ptr.y) * 0.05;

    sheetGroup.rotation.x = -0.92 - ptr.y * 0.1;
    sheetGroup.rotation.z = 0.22 + ptr.x * 0.1 + Math.sin(t * 0.1) * 0.04;

    txCam.position.x = ptr.x * 0.26;
    txCam.position.y = ptr.y * 0.18;
    txCam.lookAt(0, 0, 0);

    letters.forEach((m, i) => {
      m.position.y = m.userData.baseY + Math.sin(t * 0.5 + i * 0.5) * 0.008;
    });

    draw();
  }

  let entrancePlayed = false;
  let entranceCtx = null;

  function playEntrance() {
    if (entrancePlayed) return;
    entrancePlayed = true;
    entranceCtx = gsap.context(entranceSequence);
  }

  /*
   * Rewound whenever the section leaves the screen, so scrolling back to it
   * starts from black instead of dropping you into a scene that finished
   * minutes ago. The context is what makes that safe: it collects every tween
   * the sequence creates — including the infinite stray drifts, which would
   * otherwise stack a fresh copy on each visit — and revert() both kills them
   * and restores the values they started from.
   */
  function resetEntrance() {
    if (entranceCtx) entranceCtx.revert();
    entranceCtx = null;
    entrancePlayed = false;
  }

  function entranceSequence() {
    const tl = gsap.timeline({ defaults: { ease: 'power2.inOut' } });
    tl.to(uni.uGlobal, { value: 1, duration: 0.8 }, 0)
      .to(uni.uReveal, { value: 1, duration: 2.6 }, 0.3)
      .to(haze.material, { opacity: 1, duration: 2, ease: 'power2.out' }, 0.8);

    letters.forEach((m, i) => {
      tl.fromTo(
        m.position,
        { y: m.userData.baseY - 0.16 },
        { y: m.userData.baseY, duration: 0.9, ease: 'power3.out' },
        2.1 + i * 0.05
      );
      tl.to(m.material, { opacity: 0.96, duration: 0.7, ease: 'power2.out' }, 2.1 + i * 0.05);
    });

    echoes.forEach((m, i) => {
      tl.fromTo(m.scale, { x: 0.7, y: 0.7 }, { x: 1, y: 1, duration: 1.1, ease: 'back.out(1.6)' }, 3.3 + i * 0.22);
      tl.to(m.material, { opacity: 0.5, duration: 1 }, 3.3 + i * 0.22);
      gsap.to(m.position, {
        y: '+=0.10',
        x: i ? '-=0.06' : '+=0.06',
        duration: 6 + i,
        repeat: -1,
        yoyo: true,
        ease: 'sine.inOut',
        delay: 4.8,
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

  /* Observed rather than measured once: the section is still pre-layout when
     this runs, exactly as the other fields are. */
  resize();
  new ResizeObserver(resize).observe(host);

  if (prefersReducedMotion) {
    uni.uGlobal.value = 1;
    uni.uReveal.value = 1;
    haze.material.opacity = 1;
    letters.forEach((m) => {
      m.material.opacity = 0.96;
    });
    echoes.forEach((m) => {
      m.material.opacity = 0.5;
    });
    draw();
    return;
  }

  new IntersectionObserver(
    ([entry]) => {
      onScreen = entry.isIntersecting;
      if (!onScreen) resetEntrance();
      sync();
    },
    { rootMargin: '200px' }
  ).observe(host);

  document.addEventListener('visibilitychange', sync);
}

/* -------------------------------------------------------------------------
 * Footer background — the dawn
 *
 * The supplied sketch's fragment shader, kept byte for byte. One quad: a vast
 * analytic planet, its limb drawn as a hairline that opens from the centre
 * outward, the purple dawn blooming up behind it, and pure black below.
 *
 * Normalised by WIDTH rather than height — that is what makes the limb span the
 * frame at any aspect, and it is why the footer needs no fixed height for the
 * composition to hold.
 * ---------------------------------------------------------------------- */
const DAWN_FRAGMENT_SHADER = `
  precision highp float;
  uniform vec2  uRes, uPtr;
  uniform float uTime, uReveal, uLine, uGlow;

  void main(){
    /* normalise by WIDTH so the limb spans the frame at any aspect */
    vec2 uv = (gl_FragCoord.xy - 0.5*uRes)/uRes.x*2.0;
    uv += uPtr * 0.012;

    vec3 col = vec3(0.003, 0.002, 0.005);

    /* the planet: a vast circle whose apex grazes the lower third */
    float R = 7.5;
    vec2  C = vec2(0.0, -0.20 - R);
    float d = length(uv - C);
    float above = d - R;                /* >0 above the limb */

    /* the dawn: a broad purple bloom over the apex, fading up */
    vec2 dawnP = (uv - vec2(0.0, -0.185)) * vec2(1.0, 2.05);
    float dd = length(dawnP);
    float shimmer = 0.94 + 0.06*sin(uTime*0.5);
    vec3 dawn = vec3(0.0);
    dawn += vec3(0.30,0.12,0.55) * exp(-dd*3.4)  * 1.00;   /* purple flood  */
    dawn += vec3(0.56,0.32,0.90) * exp(-dd*7.5)  * 0.85;   /* violet core   */
    dawn += vec3(0.95,0.88,1.00) * exp(-dd*17.0) * 0.90;   /* pale heart    */
    col += dawn * uGlow * shimmer * step(0.0, above);

    /* thin atmosphere breathing just above the limb */
    float atm = exp(-max(above,0.0)*38.0);
    float spread = exp(-pow(uv.x*1.55, 2.0));
    col += vec3(0.46,0.26,0.80) * atm * (0.25 + 0.75*spread) * uGlow;

    /* the razor limb line — drawn from the centre outward */
    float lineMask = 1.0 - smoothstep(uLine*1.15 - 0.04, uLine*1.15 + 0.02, abs(uv.x));
    float tipFade  = 1.0 - smoothstep(0.72, 1.02, abs(uv.x));
    float ripple   = 0.90 + 0.10*sin(uv.x*22.0 - uTime*0.7);
    float line = exp(-pow(above*340.0, 2.0));
    vec3 lineCol = mix(vec3(0.78,0.62,1.00), vec3(1.00,0.98,1.00), spread);
    col += lineCol * line * (0.35 + 1.25*spread) * tipFade * ripple * lineMask;
    /* a soft lift right on top of the line near the centre */
    col += vec3(0.85,0.75,1.0) * exp(-pow(above*90.0,2.0)) * spread * 0.35 * lineMask;

    /* below the limb: the planet's night side — pure black */
    col = mix(col, vec3(0.0), 1.0 - smoothstep(-0.004, 0.002, above));

    col *= uReveal;
    col += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898,78.233)))*43758.5453)-0.5)/255.0;
    gl_FragColor = vec4(col, 1.0);
  }
`;

/* =========================================================================
 * Footer field
 *
 * The dawn behind the footer columns. The sketch also letters a brand line and
 * a nav of its own and fades them in with the same timeline; those are dropped
 * — the footer already has its content and its own scroll reveal in
 * setupScrollAnimations(), and this only supplies the background.
 * ====================================================================== */
function initFooterField() {
  const host = document.querySelector('#footer-field');
  if (!host) return;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  } catch (error) {
    console.error('Footer field: no WebGL context', error);
    return;
  }

  /* Same r128 grade as the other fields — the shader carries its own 1/255
     dither, which an sRGB transfer on the way out would smear. */
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setPixelRatio(pixelRatioFor(1.5, 1));
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const uni = {
    uRes: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 },
    uPtr: { value: new THREE.Vector2(0, 0) },
    uReveal: { value: 0 },
    uLine: { value: 0 } /* the hairline draws from the centre outward */,
    uGlow: { value: 0 } /* the dawn blooms                            */,
  };

  scene.add(
    new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        uniforms: uni,
        vertexShader: 'void main(){ gl_Position = vec4(position,1.0); }',
        fragmentShader: DAWN_FRAGMENT_SHADER,
      })
    )
  );

  function draw() {
    renderer.render(scene, cam);
  }

  function resize() {
    const w = host.clientWidth;
    const h = host.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    uni.uRes.value.set(w * renderer.getPixelRatio(), h * renderer.getPixelRatio());
    if (prefersReducedMotion) draw();
  }
  /* Observed rather than measured once: the footer is still pre-layout here,
     and it also reflows as the columns wrap. */
  resize();
  new ResizeObserver(resize).observe(host);

  /*
   * The cursor is read off the footer, not the canvas: the canvas is behind the
   * columns, so over a link it would never see the pointer at all.
   */
  const section = host.closest('footer') || host;
  const target = { x: 0, y: 0 };
  function fromEvent(e) {
    const r = host.getBoundingClientRect();
    const p = e.touches ? e.touches[0] : e;
    target.x = ((p.clientX - r.left) / r.width - 0.5) * 2;
    target.y = -((p.clientY - r.top) / r.height - 0.5) * 2;
  }
  section.addEventListener('pointermove', fromEvent);
  section.addEventListener('touchmove', fromEvent, { passive: true });
  section.addEventListener('pointerleave', () => {
    target.x = 0;
    target.y = 0;
  });

  const clock = new THREE.Clock();
  let frameId = null;
  let onScreen = false;

  function frame() {
    frameId = requestAnimationFrame(frame);
    uni.uTime.value = clock.getElapsedTime();

    const p = uni.uPtr.value;
    p.x += (target.x - p.x) * 0.05;
    p.y += (target.y - p.y) * 0.05;

    draw();
  }

  let entrancePlayed = false;
  let entranceCtx = null;

  function playEntrance() {
    if (entrancePlayed) return;
    entrancePlayed = true;
    entranceCtx = gsap.context(entranceSequence);
  }

  /*
   * Rewound whenever the footer leaves the screen, so coming back to it draws
   * the limb again from the centre rather than dropping you onto a finished
   * frame. The context collects the infinite breathe tween along with the rest,
   * which is what stops a fresh copy stacking on each visit.
   */
  function resetEntrance() {
    if (entranceCtx) entranceCtx.revert();
    entranceCtx = null;
    entrancePlayed = false;
  }

  function entranceSequence() {
    const tl = gsap.timeline({ defaults: { ease: 'power2.inOut' } });
    tl.to(uni.uReveal, { value: 1, duration: 0.8 }, 0)
      .to(uni.uLine, { value: 1, duration: 1.9, ease: 'power3.inOut' }, 0.3)
      .to(uni.uGlow, { value: 1, duration: 2.4, ease: 'power2.out' }, 1.0);

    /* the dawn keeps breathing */
    gsap.to(uni.uGlow, {
      value: 0.86,
      duration: 4.6,
      repeat: -1,
      yoyo: true,
      ease: 'sine.inOut',
      delay: 4.5,
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
    uni.uLine.value = 1;
    uni.uGlow.value = 1;
    draw();
    return;
  }

  new IntersectionObserver(
    ([entry]) => {
      onScreen = entry.isIntersecting;
      if (!onScreen) resetEntrance();
      sync();
    },
    { rootMargin: '200px' }
  ).observe(host);

  document.addEventListener('visibilitychange', sync);
}
