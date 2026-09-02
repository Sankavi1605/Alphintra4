import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

import { pixelRatioFor, SMALL_SCREEN } from './render-quality.js';
// Canvas-texture glyph rows, shared by the Makers and Featured Work fields.
import { makeLetter, fitScale, fitMargin } from './webgl-letters.js';
// The hero's purple-horizon background; also used on the Careers page.
import { initHorizonField } from './horizon-field.js';
// One gesture, one scene. Replaces the CSS scroll-snap this page used to use.
import { initSectionScroll } from './section-scroll.js';
// The fanned discipline deck in #disciplines. GSAP only — no WebGL.
import { initCardStack } from './card-stack.js';
// The cursor-tracked tilt and sheen on the hero's testimonial card. Also
// GSAP-free: pointer events and CSS custom properties, nothing else.
import { initHolographicCard } from './holographic-card.js';

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

/* Scene-to-scene stepping. Bails out on its own under reduced motion. */
initSectionScroll();

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

/*
 * Field mounts wait here until the loader comes down. Nothing below the fold
 * can be reached before then — the body carries .is-loading and the document
 * does not scroll — and until then the pinned scroll scenes have not been laid
 * out, so any measurement taken now is of a page that does not exist yet.
 */
const pendingMounts = [];

/*
 * Drained on a microtask, never straight through. In the reduced-motion branch
 * hideLoader() is called while module evaluation is still on the stack, and a
 * trigger created there fires onEnter immediately — into field initialisers
 * that read shader consts declared further down this file, still in their
 * temporal dead zone. Same reason the boot branch below uses queueMicrotask.
 */
function drainMounts() {
  queueMicrotask(() => {
    while (pendingMounts.length) pendingMounts.shift()();
  });
}

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

  /* Only now is there a real page to measure the fields against. */
  drainMounts();

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

/*
 * Every field is a full-viewport fragment shader. Fill cost — and drawing
 * buffer memory — scale with the square of the pixel ratio, so dropping the
 * desktop cap from 2 to 1.5 takes 44% off both. What these draw is smooth
 * gradient artwork and soft-edged glyph planes, neither of which has detail at
 * that scale to lose; the phone cap is untouched.
 */
const FIELD_PIXEL_CAP = 1.5;

/*
 * The hero shades a 493k-triangle MeshPhysicalMaterial with clearcoat over the
 * whole viewport, with 4x multisampling on top, and it runs for the entire
 * pinned opening sequence. Same square-law cost: the old cap of 2 was doing
 * 1.8x the shading of this one on any HiDPI laptop, which is where the fans
 * were coming from. At 1.5 with MSAA still on, the chrome silhouette holds up.
 *
 * Declared up here with the field cap, not down beside initHeroScene: the boot
 * branch calls that function above this point in the file, so a const declared
 * there is still in its temporal dead zone when it runs.
 */
const HERO_PIXEL_CAP = 1.5;

/* -------------------------------------------------------------------------
 * The shared playhead
 *
 * Every field ran on its own THREE.Clock, started whenever that field happened
 * to mount — so the eight scenes had eight unrelated timebases. The artwork
 * above a join and the artwork below it sat at unrelated points in their own
 * loops, drifting at unrelated phases, and crossing the join meant crossing
 * between two animations that had nothing to do with each other. Shortening the
 * mask ramps (see the note on the scrollytelling block in the stylesheet) made
 * them touch; it could not make them agree.
 *
 * So the page's scroll offset is added to every one of those clocks. It is the
 * same number for all of them at any instant, and that is the whole mechanism:
 * the scene being left and the scene being arrived at wind forward by exactly
 * the same amount over the same 620ms, so their motion matches across the
 * boundary instead of merely abutting it.
 *
 * It also makes position the playhead. Standing still, each scene drifts on its
 * own clock as before; travelling, all eight wind on together, and scrolling
 * back winds them back — the state of the backgrounds is a function of where the
 * reader is, not of when the field happened to be built.
 *
 * Deliberately additive rather than a replacement: a scene has to keep breathing
 * while the reader stands still and reads the card in front of it.
 * ---------------------------------------------------------------------- */

/*
 * Seconds of animation per screen scrolled.
 *
 * At 3, one section step — 620ms — winds every scene on by three seconds, which
 * is plainly visible as travel without the scenes reading as fast-forwarded once
 * the reader stops. Their ambient loops run on periods of ten seconds and up, so
 * this is a fraction of a cycle per section rather than a spin through several.
 */
const SCROLL_SECONDS_PER_SCREEN = 3;

function sharedPhase() {
  return (window.scrollY / (window.innerHeight || 1)) * SCROLL_SECONDS_PER_SCREEN;
}

/* -------------------------------------------------------------------------
 * Field mounting
 *
 * Nine fields, nine WebGLRenderers, nine live GL contexts. Building them all at
 * boot pinned every one for the life of the page — tens of megabytes of driver
 * memory each — on a page that only ever shows one scene at a time. Browsers
 * also cap live contexts (mobile Safari at eight), and past the cap the oldest
 * is silently killed, which is why a scene occasionally came back black.
 *
 * Each field is now built the first time its host comes within a screen of the
 * viewport, and only once: the observer disconnects itself on the first hit, so
 * this never double-binds a field's own observers or entrance.
 *
 * A screen of margin, not zero, so the context and its first frame are ready
 * before the section is actually looked at.
 *
 * The hero and its horizon stay eager — both are on screen at load.
 * ---------------------------------------------------------------------- */
function mountWhenNear(selector, init) {
  const host = document.querySelector(selector);
  if (!host) return;

  /*
   * A ScrollTrigger rather than a bare IntersectionObserver. An observer
   * reports against whatever layout exists when it happens to deliver, and an
   * observer bound at parse time delivers against a page whose pinned scroll
   * scenes have not been spread apart yet — so fields that end up thousands of
   * pixels down read as near and build a context anyway. Which ones did varied
   * run to run.
   *
   * ScrollTrigger measures on refresh and re-measures on every relayout, which
   * is why the rest of this file already leans on it. The creation is queued
   * until hideLoader() has refreshed against the finished page, because a
   * trigger measures itself the moment it is created and would inherit exactly
   * the same bad layout otherwise.
   *
   * "top bottom+=100%" is the one-screen lead this wants: the context and its
   * first frame are ready before the section is actually looked at.
   */
  const create = () =>
    ScrollTrigger.create({
      trigger: host,
      start: 'top bottom+=100%',
      once: true,
      onEnter: init,
    });

  pendingMounts.push(create);
  if (loaderHidden) drainMounts();
}

/* -------------------------------------------------------------------------
 * Reduced motion: skip the WebGL work entirely.
 * The stylesheet lays the hero out as a normal stacked section in this mode.
 * ---------------------------------------------------------------------- */
if (prefersReducedMotion) {
  /* Still paint one static frame so those sections are not empty — mounted on
     approach, same as the motion path, so an unvisited section costs nothing.
     Queued before hideLoader(), which is what releases them. */
  mountWhenNear('#about-field', initAboutField);
  mountWhenNear('#capability-field', initCapabilityField);
  mountWhenNear('#about-us-field', initAboutUsField);
  mountWhenNear('#services-field', initServicesField);
  mountWhenNear('#makers-field', initMakersField);
  mountWhenNear('#projects-field', initProjectsField);
  mountWhenNear('#contact-field', initContactField);
  mountWhenNear('#footer-field', initFooterField);
  /* Neither depends on the hero model, and the carousel drives itself off a
     GSAP loop rather than ScrollTrigger, so both run here instead of in
     setupScrollAnimations — which only fires once the GLTF has resolved. */
  queueMicrotask(setupProjectsCarousel);
  queueMicrotask(setupWorkGlass);
  queueMicrotask(setupServiceDeck);
  /* Same reasoning as the three above — it is GSAP and DOM, so it neither waits
     on the GLTF nor holds a GL context, and its own ResizeObserver picks up the
     stage's real width once the loader has released the layout. */
  queueMicrotask(() => initCardStack('#disciplines-stack'));
  /* Pointer listeners on one card: no GL context, no GSAP timeline, nothing to
     measure. It only ever responds once the hero's zoom has set
     .cards-container's pointer-events to auto, so binding early costs nothing. */
  queueMicrotask(() => initHolographicCard('.testimonial-card'));
  /* Last, so the queued mounts measure a page that is already wired. */
  hideLoader();
} else {
  initHeroScene();

  /*
   * A module script is deferred, so readyState is already "interactive" here.
   * Calling straight through would run this while module evaluation is still
   * on the stack, and the shader consts it reads are declared further down the
   * file — still in their temporal dead zone. A microtask lets evaluation finish.
   */
  queueMicrotask(initHorizonField);
  mountWhenNear('#about-field', initAboutField);
  mountWhenNear('#capability-field', initCapabilityField);
  mountWhenNear('#about-us-field', initAboutUsField);
  mountWhenNear('#services-field', initServicesField);
  mountWhenNear('#makers-field', initMakersField);
  mountWhenNear('#projects-field', initProjectsField);
  mountWhenNear('#contact-field', initContactField);
  mountWhenNear('#footer-field', initFooterField);
  /* Neither depends on the hero model, and the carousel drives itself off a
     GSAP loop rather than ScrollTrigger, so both run here instead of in
     setupScrollAnimations — which only fires once the GLTF has resolved. */
  queueMicrotask(setupProjectsCarousel);
  queueMicrotask(setupWorkGlass);
  queueMicrotask(setupServiceDeck);
  /* Same reasoning as the three above — it is GSAP and DOM, so it neither waits
     on the GLTF nor holds a GL context, and its own ResizeObserver picks up the
     stage's real width once the loader has released the layout. */
  queueMicrotask(() => initCardStack('#disciplines-stack'));
  /* Pointer listeners on one card: no GL context, no GSAP timeline, nothing to
     measure. It only ever responds once the hero's zoom has set
     .cards-container's pointer-events to auto, so binding early costs nothing. */
  queueMicrotask(() => initHolographicCard('.testimonial-card'));
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
    renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      /*
       * No multisampling, even here.
       *
       * This is the largest single allocation on the page: 4x multisampled
       * colour and depth over the full viewport measured 55.9MB at a device
       * pixel ratio of 1, and it scales with the square of that ratio — about
       * 126MB on a 150%-scaled display, which was a third of the whole tab.
       * Without it the same buffer is 28MB.
       *
       * The model still gets edge treatment: rendering at a 1.5 pixel ratio and
       * letting the compositor scale down is supersampling, which is what
       * actually cleans up a chrome silhouette. If the edges read as too hard,
       * this is the one line to put back.
       *
       * powerPreference is gone from every renderer on the page too. It was
       * 'high-performance', which on a laptop with switchable graphics asks the
       * browser for the discrete GPU — for the whole tab, since one process
       * picks one adapter. Nine ambient background shaders do not need it, and
       * it is the difference between the integrated chip idling and the fans
       * spinning up. The default lets the browser choose.
       */
      antialias: false,
      stencil: false,
    });
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

  /*
   * The other end of the same problem. A short landscape window — a laptop with
   * two browser toolbars, anything past about 16:9 — gives the hero far less
   * height than the model was posed for, while the wordmark above it is sized
   * off vw and so keeps growing. The model ends up filling the frame bottom to
   * apex with its feet flush against the edge and nothing between it and the
   * letters.
   *
   * Easing the camera back shrinks the model toward the centre of the frame,
   * which lifts the feet off the bottom edge. Ramped by aspect rather than
   * applied flat, because at 3:2 and taller the original framing is right.
   */
  const WIDE_RAMP_START = 1.3;
  const WIDE_RAMP_END = 2.3;
  const WIDE_PULLBACK = 0.2;

  function frameCamera() {
    const aspect = window.innerWidth / window.innerHeight;
    camera.aspect = aspect;
    if (aspect >= 1) {
      const t = Math.min(1, Math.max(0, (aspect - WIDE_RAMP_START) / (WIDE_RAMP_END - WIDE_RAMP_START)));
      camera.position.z = BASE_CAMERA_Z * (1 + t * WIDE_PULLBACK);
    } else {
      camera.position.z = Math.min(MAX_CAMERA_Z, BASE_CAMERA_Z * (1 + (1 / aspect - 1) * PORTRAIT_PULLBACK));
    }
    camera.updateProjectionMatrix();
  }
  frameCamera();

  renderer.setPixelRatio(pixelRatioFor(HERO_PIXEL_CAP, HERO_PIXEL_CAP));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  // Environment map for metallic reflections
  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
  /*
   * The generator holds a render target and a full set of blur materials, and
   * it is finished with the moment the environment texture exists — the texture
   * itself survives disposal. Left undisposed it pinned all of that for the life
   * of the page for one call at boot.
   */
  pmremGenerator.dispose();

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

  /*
   * Both requests go out together. model4's load used to be nested inside
   * model's callback, so its 4.7MB did not begin downloading until model's
   * 1.8MB had finished and been parsed, and the loader sat there for the sum of
   * the two. Nothing in model4's setup reads model, so they fetch side by side
   * and the wait becomes the slower one rather than both.
   */
  const heroModel = loader.loadAsync('./assets/model.glb');
  const worldModel = loader.loadAsync('./assets/model4.glb').catch((error) => {
    console.error('Error loading model4.glb:', error);
    return null;
  });

  heroModel
    .then((gltf) => {
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
       * -2.35, raised again once the wordmark moved to Moonwalk at three quarters
       * of its old size: shorter caps left the apex 13px clear of them, and the
       * overlap is wanted. One world unit is ~131px at this depth on a 1920x862
       * hero, so this lifts the model about 30px and the tip crosses ~17px into
       * the bottom of the letters. The canvas is z 2 and the wordmark z 1, so it
       * passes in front. The rest of the lift at
       * short landscape sizes, where it was worst, comes from the wide-aspect
       * pullback in frameCamera() rather than from here — the scroll timeline
       * animates position.y, so it cannot be owned in a resize handler.
       */
      model.position.y = -2.35;
      model.rotation.x = 0.1;
      model.rotation.y = 0;

      // The world model used for the background zoom section
      return worldModel;
    })
    .then((gltf3) => {
      if (gltf3) {
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
      }

      /* model3 stays null if that one failed; the timeline handles it. */
      setupScrollAnimations(model, model3 || null);
      hideLoader();
    })
    .catch((error) => {
      console.error('Error loading model.glb:', error);
      hideLoader();
    });

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

  /*
   * Sizing the hero's buffer, in one place so play() can restore what pause()
   * gives back.
   */
  function sizeToViewport() {
    renderer.setPixelRatio(pixelRatioFor(HERO_PIXEL_CAP, HERO_PIXEL_CAP));
    renderer.setSize(window.innerWidth, window.innerHeight);
  }

  /*
   * The hero is the most expensive buffer on the page: it is the one context
   * that keeps antialias, so its colour and depth are 4x multisampled, and it
   * measured 55.9MB at a device pixel ratio of 1 — more than four fields put
   * together, and over 120MB on a 150%-scaled display. Once you have scrolled
   * well past the hero it is holding all of that for a scene nobody can see.
   *
   * Released on its own wide margin rather than with the render gate, for the
   * same reason the fields do it that way: reallocating a 56MB multisampled
   * buffer in the middle of a scroll is a visible hitch, and the hero's gate
   * sits only 100px out. The model, its environment map and the compiled
   * programs survive either way.
   */
  let bufferLive = true;

  function releaseBuffer() {
    if (!bufferLive) return;
    bufferLive = false;
    renderer.setSize(1, 1, false);
  }

  function restoreBuffer() {
    if (bufferLive) return;
    bufferLive = true;
    sizeToViewport();
  }

  // Don't burn battery rendering to a tab nobody is looking at.
  function play() {
    restoreBuffer();
    if (frameId === null) tick();
  }
  function pause() {
    if (frameId !== null) {
      window.cancelAnimationFrame(frameId);
      frameId = null;
    }
    if (document.hidden) releaseBuffer();
  }

  /*
   * Render only while the hero is actually on screen. It used to run a
   * full-viewport 3D scene every frame for the entire page, which starved
   * the particle sphere further down.
   */
  let heroOnScreen = true;
  const sync = () => (heroOnScreen && !document.hidden ? play() : pause());

  const heroSection =
    canvas.parentElement?.querySelector('#hero') || document.querySelector('#hero') || canvas;

  new IntersectionObserver(
    ([entry]) => {
      heroOnScreen = entry.isIntersecting;
      sync();
    },
    { rootMargin: '100px' }
  ).observe(heroSection);

  /* Memory only — see the note on releaseBuffer(). */
  new IntersectionObserver(
    ([entry]) => (entry.isIntersecting ? restoreBuffer() : releaseBuffer()),
    { rootMargin: '150%' }
  ).observe(heroSection);

  document.addEventListener('visibilitychange', sync);
  play();

  // 5. Resize
  window.addEventListener('resize', () => {
    frameCamera();
    /* Only while it is the live size — otherwise this would undo pause(). */
    if (frameId !== null) sizeToViewport();
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
        /*
         * 0.55, down from 0.9, and envMapIntensity halved with it.
         *
         * This is the one place on the page where white copy sits over the model
         * at full size, and the model wins: its daylit face clipped to white and
         * no treatment behind the text could recover it. Opacity caps the
         * composite — the world blends over a near-black scene, so 0.55 puts a
         * ceiling of ~140 on it — while the envMap term is what was clipping in
         * the first place, so halving that stops the highlights blowing out
         * rather than just fading the result.
         */
        tl.to(child.material, { opacity: 0.55, duration: 2 }, 2);
        tl.to(child.material, { envMapIntensity: 2.0, duration: 2 }, 2);
      }
    });
    tl.to(model3.scale, { x: 6.5, y: 6.5, z: 6.5, duration: 5 }, 2);
    tl.to(model3.position, { x: 0, y: 0, z: -0.5, duration: 5 }, 2);
  }

  // --- "See For Yourself" reveal, scrubbed with the zoom ---
  /*
   * The pad leads the copy by a beat and then stays. Tweened separately from
   * .hole-text on purpose: it used to be a child of it and inherited its
   * opacity, so at every rest position short of the end of the timeline the pad
   * was as faint as the text it was supposed to be backing.
   */
  tl.to('.hole-scrim', { opacity: 1, duration: 1.2 }, 1.2);
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
   * The heading is still not animated here — it is lettered in WebGL and faded
   * in by initCapabilityField's own entrance. The four cards are, now that they
   * are all on screen together: there is no cross-fade left to fight over
   * opacity, so they come in as a stagger across the row.
   *
   * fromTo, so the from-state is written by GSAP rather than sitting in the
   * stylesheet — the cards stay visible if this script never runs.
   */
  gsap.fromTo(
    '.concept-card',
    { opacity: 0, y: 28, filter: 'blur(6px)' },
    {
      scrollTrigger: { trigger: '.concepts-deck', start: 'top 82%' },
      opacity: 1,
      y: 0,
      filter: 'blur(0px)',
      duration: 0.8,
      ease: 'power3.out',
      stagger: 0.12,
    }
  );

  const at = { trigger: '.concepts-action', start: 'top 90%' };
  reveal('.concepts-action-text', at, { y: 20, blur: 4 }, { duration: 0.6 });
  reveal(
    '.concepts-action .btn-outline',
    at,
    { y: 25, scale: 0.9 },
    { duration: 0.7, ease: 'back.out(1.4)', delay: 0.15 }
  );

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
  gsap.fromTo(
    aboutParagraphs,
    { opacity: 0, y: 25, filter: 'blur(5px)' },
    {
      scrollTrigger: aboutBody,
      opacity: 1,
      y: 0,
      filter: 'blur(0px)',
      duration: 0.8,
      stagger: 0.18,
      delay: 0.45,
    }
  );

  reveal(
    '.about-content .project-link',
    aboutBody,
    { x: -20, blur: 4 },
    { duration: 0.6, delay: 0.45 + aboutParagraphs.length * 0.18 + 0.2 }
  );

  // 3. CONTACT
  // The heading is drawn in the WebGL field now, so there is no h2 or subtext
  // to reveal here — the two cards come in from their own side of the crater.
  gsap.fromTo(
    '.contact-card',
    { opacity: 0, y: 30, filter: 'blur(6px)' },
    {
      scrollTrigger: { trigger: '.contact-inner', start: 'top 70%' },
      opacity: 1,
      y: 0,
      filter: 'blur(0px)',
      duration: 0.9,
      ease: 'power3.out',
      stagger: 0.15,
    }
  );

  // 4. CLOSING CALL TO ACTION
  // The card comes in as one piece — its own heading no longer needs a
  // separate reveal, and animating both left the h2 lagging inside the glass.
  gsap.fromTo(
    '.cta-card',
    { opacity: 0, y: 35, filter: 'blur(6px)' },
    {
      scrollTrigger: { trigger: '.faq-inner', start: 'top 75%' },
      opacity: 1,
      y: 0,
      filter: 'blur(0px)',
      duration: 0.9,
      ease: 'power3.out',
    }
  );

  // 5. FOOTER
  const footerCols = document.querySelectorAll('.footer-col');
  const footerAt = { trigger: 'footer', start: 'top 80%' };

  gsap.fromTo(
    footerCols,
    { opacity: 0, y: 45, filter: 'blur(6px)' },
    {
      scrollTrigger: footerAt,
      opacity: 1,
      y: 0,
      filter: 'blur(0px)',
      duration: 0.8,
      stagger: 0.18,
    }
  );

  footerCols.forEach((col, index) => {
    gsap.fromTo(
      col.querySelectorAll('a'),
      { opacity: 0, y: 15, filter: 'blur(3px)' },
      {
        scrollTrigger: footerAt,
        opacity: 1,
        y: 0,
        filter: 'blur(0px)',
        duration: 0.5,
        stagger: 0.06,
        delay: 0.1 + index * 0.18,
      }
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
  const prev = document.querySelector('.projects-arrow-prev');
  const next = document.querySelector('.projects-arrow-next');
  if (!stage || slides.length === 0) return;

  /*
   * Under reduced motion the CSS lifts the cards out of the absolute stack and
   * lays all three down the page, and hides the arrows with them.
   *
   * No breakpoint gate here any more. It used to return below 769px on the
   * grounds that the cards flow at that width — they do not; only reduced
   * motion un-stacks them. So on a phone the conveyor never started and the
   * track showed card 01 for ever, with 02 and 03 stacked invisibly underneath
   * and unreachable.
   */
  if (prefersReducedMotion) return;

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

  const HOLD = 2.6; /* seconds a card sits before the next one is pulled in */
  const SWEEP = 1.15; /* the unhurried automatic sweep */
  const STEP = 0.62; /* a click wants an answer sooner than that */

  let current = 0;
  let cycle = null;
  let timer = null;
  let held = false;

  /*
   * inert, not hidden: all three keep their box because they share one track,
   * but the two off-stage must not be tab stops — each carries an "Explore
   * Project" link, and while they were merely at opacity 0 all three were
   * reachable and announced.
   */
  function mark() {
    slides.forEach((slide, i) => {
      slide.inert = i !== current;
      slide.setAttribute('aria-hidden', i === current ? 'false' : 'true');
    });
  }

  function schedule() {
    if (timer) timer.kill();
    timer = gsap.delayedCall(HOLD, () => go(1, false));
    if (held) timer.pause();
  }

  function go(dir, quick) {
    /*
     * A click mid-sweep finishes the running one rather than being dropped.
     * Ignoring it instead makes the arrows feel dead when pressed twice
     * quickly, and leaves the deck a step behind the clicks.
     */
    if (cycle) cycle.progress(1).kill();
    /*
     * After that, not before: forcing the running cycle to its end fires its
     * onComplete, which schedules a fresh advance. Killing the timer first left
     * that one alive and pending behind the step just requested.
     */
    if (timer) timer.kill();

    const from = slides[current];
    current = (current + dir + slides.length) % slides.length;
    const to = slides[current];
    mark();

    /* Entering card on top of the one leaving. */
    stage.appendChild(to);

    /* Signed by direction, so going back sweeps back the way it came. */
    const d = quick ? STEP : SWEEP;
    cycle = gsap
      .timeline({
        onComplete() {
          cycle = null;
          schedule();
        },
      })
      .to(
        from,
        {
          x: -travel() * dir,
          opacity: 0,
          rotateY: -14 * dir,
          filter: 'blur(8px)',
          duration: d,
          ease: 'power3.in',
        },
        0
      )
      .fromTo(
        to,
        {
          x: travel() * dir,
          opacity: 0,
          rotateY: 14 * dir,
          filter: 'blur(8px)',
        },
        {
          x: 0,
          opacity: 1,
          rotateY: 0,
          filter: 'blur(0px)',
          duration: d,
          ease: 'power3.out',
        },
        0
      );
  }

  /*
   * Hover and focus hold the advance, not the animation.
   *
   * The conveyor itself used to be paused, which meant catching it mid-sweep
   * froze two half-faded cards over each other for as long as the pointer
   * stayed. Pausing only the timer keeps the promise that matters — the card
   * you are reading will not leave — and lets whatever is in flight land.
   */
  const hold = () => {
    held = true;
    if (timer) timer.pause();
  };
  const release = () => {
    if (stage.matches(':hover') || stage.contains(document.activeElement)) return;
    held = false;
    if (timer) timer.resume();
  };
  stage.addEventListener('pointerenter', hold);
  stage.addEventListener('pointerleave', release);
  stage.addEventListener('focusin', hold);
  stage.addEventListener('focusout', release);

  if (prev) prev.addEventListener('click', () => go(-1, true));
  if (next) next.addEventListener('click', () => go(1, true));

  /*
   * Left/right on the track itself, so the cards can be stepped without hunting
   * for the arrows once focus is already inside them.
   */
  stage.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      go(1, true);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      go(-1, true);
    }
  });

  gsap.set(slides, { opacity: 0 });
  mark();
  gsap.fromTo(
    slides[0],
    { x: travel(), opacity: 0, rotateY: 14, filter: 'blur(8px)' },
    {
      x: 0,
      opacity: 1,
      rotateY: 0,
      filter: 'blur(0px)',
      duration: SWEEP,
      ease: 'power3.out',
      onComplete: schedule,
    }
  );
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
    renderer = new THREE.WebGLRenderer({
      /*
       * No multisampling, and no stencil.
       *
       * MSAA only antialiases polygon edges. Every field draws full-screen
       * shader quads, glyph planes, points and sprites — all of them textured
       * or analytic, none with a geometric edge for MSAA to find — so it was
       * buying nothing and costing a 4x multisampled colour and depth buffer
       * per context. On a 1890x862 window that is roughly 52MB a field rather
       * than 13MB, and the page runs nine of them. Nothing here uses stencil
       * either. The hero keeps antialias: it is the one scene with real
       * geometry whose silhouette MSAA actually cleans up.
       */
      antialias: false,
      stencil: false,
    });
  } catch (error) {
    console.error('Projects field: no WebGL context', error);
    return;
  }

  /* Same grade as the other fields — the shader writes its own linear ramps
     and dithers by hand at 1/255, both of which an sRGB transfer would eat. */
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setPixelRatio(pixelRatioFor(FIELD_PIXEL_CAP, 1.25));
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

  /*
   * Half rate. These are ambient drifts — orbiting lights, a breathing ring, a
   * slow parallax — redrawn as a full-viewport fragment shader every refresh.
   * On a 120Hz panel that is four times the shading the artwork needs, and it
   * is what had the fans running. 30 divides evenly into both 60 and 120, so
   * the cadence stays regular rather than juddering.
   *
   * The hero is deliberately not capped: it carries the scroll-scrubbed motion,
   * where a dropped frame reads as a stutter.
   */
  const FRAME_INTERVAL_MS = 1000 / 30;
  let lastFrameAt = 0;

  function frame(now) {
    frameId = requestAnimationFrame(frame);
    /* Called straight through the first time, with no timestamp — always draw
       that one, or the section shows an empty canvas until the next tick. */
    if (now !== undefined) {
      if (now - lastFrameAt < FRAME_INTERVAL_MS) return;
      lastFrameAt = now;
    }
    const t = clock.getElapsedTime() + sharedPhase();
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

  /*
   * The drawing buffer, held separately from the render gate.
   *
   * A full-viewport context costs a colour and a depth buffer at the canvas
   * size — about 12MB each on an 1890x862 window — and the page holds ten of
   * them once you have scrolled to the bottom. Measured: 162MB of buffers
   * alone, and that scales with the square of the device pixel ratio, so it is
   * nearer 360MB on a 150%-scaled display.
   *
   * Collapsing the backing store to 1x1 gives nearly all of that back, and it
   * costs nothing to undo: the context, its compiled programs and its textures
   * all survive, so returning is a resize rather than a rebuild. updateStyle is
   * false, so the canvas keeps its CSS box and no layout moves.
   *
   * This is deliberately NOT driven by the same observer as the render gate.
   * That one fires 200px out, which during a normal scroll means reallocating
   * a 12MB buffer and running resize()'s layout reads in the middle of the
   * gesture — the stutter that bought. The release observer below is a screen
   * and a half out instead, so ordinary scrolling never touches it and the
   * buffer is back long before the section is looked at.
   */
  let bufferLive = true;

  function releaseBuffer() {
    if (!bufferLive) return;
    bufferLive = false;
    renderer.setSize(1, 1, false);
  }

  function restoreBuffer() {
    if (bufferLive) return;
    bufferLive = true;
    resize();
  }

  function sync() {
    const shouldRun = onScreen && !document.hidden;
    if (shouldRun) {
      restoreBuffer();
      playEntrance();
      if (frameId === null) frame();
      return;
    }

    if (frameId !== null) {
      cancelAnimationFrame(frameId);
      frameId = null;
    }

    /* A backgrounded tab is not coming back mid-gesture, so it can pay the
       realloc on return. */
    if (document.hidden) releaseBuffer();
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

  /* Memory only — see the note on releaseBuffer(). */
  new IntersectionObserver(
    ([entry]) => (entry.isIntersecting ? restoreBuffer() : releaseBuffer()),
    { rootMargin: '150%' }
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
 * We Think In Systems background — the aurora
 *
 * The supplied sketch, ported from three r128 to r185. Four lights — peach,
 * magenta, violet and blue — orbit forever on their own paths, three dark
 * pockets drift among them swallowing colour where they pass, a soft-focus
 * rolloff melts the overlaps instead of clipping them, and film grain sits
 * over the lot.
 *
 * This replaces the planet that used to letter ENGINEERING STUDIO / FOR
 * SCALABLE PRODUCTS across its lower field. The copy is real text on the glass
 * panel now, so there is no second perspective pass here — only the field.
 *
 * The panel itself is CSS (see .systems-panel); this drives its entrance, its
 * tilt, and the parallax of the aurora behind it.
 * ---------------------------------------------------------------------- */
const AURORA_BLOB_COUNT = 4;

const AURORA_FRAGMENT_SHADER = `
  precision highp float;
  uniform vec2  uRes, uPtr;
  uniform float uTime, uGrain;
  uniform float uBloom[${AURORA_BLOB_COUNT}];
  varying vec2 vUv;

  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }

  float blob(vec2 uv, vec2 c, float s, float aspect){
    vec2 d = (uv - c) * vec2(aspect, 1.0);
    return exp(-dot(d,d)/(s*s));
  }

  void main(){
    vec2 uv = vUv;
    float aspect = uRes.x/uRes.y;
    float t = uTime;

    /* the gradient parallaxes INSIDE the glass as the panel tilts */
    vec2 par = uPtr * 0.035;

    /* deep navy base, sinking darker toward the lower-left */
    vec3 col = mix(vec3(0.016,0.013,0.058), vec3(0.005,0.004,0.020),
                   smoothstep(0.2, 1.3, length(uv - vec2(0.15, 0.15))));

    /* the four lights, each orbiting slowly on its own path */
    vec2 cPeach = vec2(0.76, 0.84) + 0.030*vec2(sin(t*0.19), cos(t*0.15)) - par*1.3;
    vec2 cMag   = vec2(0.44, 0.64) + 0.040*vec2(cos(t*0.13), sin(t*0.17)) - par;
    vec2 cVio   = vec2(0.28, 0.42) + 0.045*vec2(sin(t*0.11+2.0), cos(t*0.14+1.0)) - par*0.8;
    vec2 cBlue  = vec2(0.80, 0.26) + 0.038*vec2(cos(t*0.16+4.0), sin(t*0.12+3.0)) - par*1.15;

    col += vec3(0.300,0.190,0.720) * blob(uv, cPeach, 0.300, aspect) * 0.70 * uBloom[0];
    col += vec3(0.330,0.130,0.600) * blob(uv, cMag,   0.360, aspect) * 0.65 * uBloom[1];
    col += vec3(0.220,0.100,0.520) * blob(uv, cVio,   0.420, aspect) * 0.55 * uBloom[2];
    col += vec3(0.050,0.140,0.820) * blob(uv, cBlue,  0.330, aspect) * 0.90 * uBloom[3];

    /* BLACK POCKETS: dark voids drifting among the lights,
       swallowing colour where they pass */
    vec2 cDk1 = vec2(0.30, 0.82) + 0.050*vec2(sin(t*0.10+1.0), cos(t*0.13+2.0)) + par*0.6;
    vec2 cDk2 = vec2(0.60, 0.12) + 0.055*vec2(cos(t*0.12+4.0), sin(t*0.09+0.5)) + par*0.9;
    vec2 cDk3 = vec2(0.10, 0.30) + 0.040*vec2(sin(t*0.11+3.0), cos(t*0.10+1.5)) + par*0.5;
    col *= 1.0 - 0.80*blob(uv, cDk1, 0.260, aspect) * uBloom[2];
    col *= 1.0 - 0.70*blob(uv, cDk2, 0.300, aspect) * uBloom[2];
    col *= 1.0 - 0.60*blob(uv, cDk3, 0.240, aspect) * uBloom[2];

    /* soft-focus tone rolloff so overlaps melt instead of clip */
    col = col / (1.0 + col*0.28);

    /* the reference's film grain, alive */
    float g = hash(vUv*uRes.xy*0.5 + fract(t)*vec2(37.0, 17.0));
    col += (g - 0.5) * 0.075 * uGrain;

    /* gentle corner shading, like a lit poster */
    col *= 1.0 - 0.22*pow(length((uv - 0.5)*vec2(1.15,1.35)), 2.2);

    gl_FragColor = vec4(col, 1.0);
  }
`;

function initAboutField() {
  const host = document.querySelector('#about-field');
  if (!host) return;

  const panel = document.querySelector('#systems-panel');
  const floor = document.querySelector('#systems-floor');

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      /*
       * No multisampling, and no stencil.
       *
       * MSAA only antialiases polygon edges. Every field draws full-screen
       * shader quads, glyph planes, points and sprites — all of them textured
       * or analytic, none with a geometric edge for MSAA to find — so it was
       * buying nothing and costing a 4x multisampled colour and depth buffer
       * per context. On a 1890x862 window that is roughly 52MB a field rather
       * than 13MB, and the page runs nine of them. Nothing here uses stencil
       * either. The hero keeps antialias: it is the one scene with real
       * geometry whose silhouette MSAA actually cleans up.
       */
      antialias: false,
      stencil: false,
    });
  } catch (error) {
    console.error('About field: no WebGL context', error);
    return;
  }

  /*
   * Same r128 grade as the other fields: the shader hand-rolls its own tone
   * rolloff and grain, and an sRGB transfer on the way out would lift the navy
   * base and crush the four lights into one another.
   */
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setPixelRatio(pixelRatioFor(FIELD_PIXEL_CAP, 1.25));
  /* Aurora then lettering into one buffer, so the clear is driven by hand. */
  renderer.autoClear = false;
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  /* One array, written in place by the entrance — the uniform holds the
     reference, so there is nothing to re-upload per tween. */
  const bloomArr = new Array(AURORA_BLOB_COUNT).fill(0);

  const uni = {
    uRes: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 },
    uPtr: { value: new THREE.Vector2(0, 0) },
    uGrain: { value: 0 },
    uBloom: { value: bloomArr },
  };

  scene.add(
    new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        uniforms: uni,
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position,1.0); }',
        fragmentShader: AURORA_FRAGMENT_SHADER,
      })
    )
  );

  /* --- pass 2: the tagline, in the space beside the panel ------------------
   *
   * The panel moved to the left column on a wide box (see .about-inner), and
   * this fills the right one. It is drawn in this field's renderer rather than
   * a canvas of its own: a tenth WebGL context for three rows of type would
   * cost more driver memory than everything else in the section put together.
   *
   * The real text is the visually-hidden .about-tagline in the markup, so the
   * outline, search and selection do not depend on a canvas. Below the split
   * breakpoint that element becomes visible copy and this pass draws nothing.
   * -------------------------------------------------------------------- */
  const txScene = new THREE.Scene();
  const txCam = new THREE.PerspectiveCamera(40, 1, 0.1, 50);
  txCam.position.z = 6;

  /*
   * Two row breaks. On a wide box the strip beside the panel is ~950px and the
   * line fits in three rows; at 1280 the same strip is 570px and that set has
   * to shrink to 28px glyphs to fit — thin enough to read as a mistake. The
   * four-row break is 12 glyphs at its widest instead of 18, so it holds its
   * size instead. Whichever one keeps the type large is the one built.
   */
  const TAG_WIDE = ['ENGINEERING STUDIO', 'FOR SCALABLE', 'PRODUCTS'];
  const TAG_NARROW = ['ENGINEERING', 'STUDIO', 'FOR SCALABLE', 'PRODUCTS'];
  const TAG_SIZE = 0.26;
  const TAG_GAP = 0.255;
  const TAG_LEAD = 0.34;
  /* Below this the wide set is too small and the narrow one takes over. */
  const TAG_MIN_SCALE = 0.8;
  const TAG_MARGIN_PX = 40;
  /* Below this the panel is centred again and there is no second column. */
  const TAG_SPLIT_PX = 1100;

  const tagGroup = new THREE.Group();
  txScene.add(tagGroup);
  let tagLetters = [];
  let tagLayout = null;
  let tagVisible = false;
  /*
   * Declared here rather than beside the entrance because buildTagRows() reads
   * it, and resize() — which can rebuild the rows — runs first.
   */
  let entrancePlayed = false;

  /* Half the widest row, in scene units at scale 1. */
  function tagHalf(rows) {
    return (Math.max(...rows.map((w) => w.length - 1)) * TAG_GAP) / 2 + TAG_SIZE / 2;
  }

  /* A swapped layout that only dropped the old meshes would leak their geometry
     and materials on every rebuild.

     The map is deliberately left alone: letterTexture() shares one texture per
     distinct glyph across the whole page, so disposing it here would pull the
     image out from under every other plane drawing the same character. */
  function disposeTagRows() {
    tagLetters.forEach((mesh) => {
      tagGroup.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    });
    tagLetters = [];
  }

  function buildTagRows(rows) {
    disposeTagRows();
    tagLayout = rows;
    rows.forEach((word, r) => {
      const y = (rows.length - 1) * TAG_LEAD * 0.5 - r * TAG_LEAD;
      const width = (word.length - 1) * TAG_GAP;
      [...word].forEach((ch, i) => {
        /* The gap still advances; a blank glyph plane would only cost a texture. */
        if (ch === ' ') return;
        const mesh = makeLetter(
          tagGroup,
          ch,
          'rgba(240,236,250,0.95)',
          /* A dark halo, as the halo field does: these rows cross the aurora's
             lights, and a bare hairline glyph loses its edge over one. */
          'rgba(0,0,0,0.95)',
          TAG_SIZE,
          -width / 2 + i * TAG_GAP,
          y,
          0,
          false
        );
        /* Rebuilt after the entrance has already run — placed lit, because no
           tween is coming for these. */
        if (entrancePlayed) mesh.material.opacity = 0.95;
        tagLetters.push(mesh);
      });
    });
  }

  /*
   * Centred in whatever is left to the right of the panel, measured rather
   * than assumed — the panel's width is a min() of a cap and a viewport
   * fraction, so where its right edge lands is not a number this can hold.
   */
  function placeTag(w, h) {
    tagVisible = w >= TAG_SPLIT_PX && !!panel;
    tagGroup.visible = tagVisible;
    if (!tagVisible) return;

    const fieldRect = host.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();

    const halfHeight = Math.tan(((txCam.fov / 2) * Math.PI) / 180) * txCam.position.z;
    const pxPerUnit = h / 2 / halfHeight;

    const freeLeft = panelRect.right - fieldRect.left + TAG_MARGIN_PX;
    const freeRight = w - TAG_MARGIN_PX;
    const freeWidth = freeRight - freeLeft;
    if (freeWidth <= 0) {
      tagVisible = false;
      tagGroup.visible = false;
      return;
    }

    /* 0.88 of the strip, not all of it: at full width the outer glyphs came
       within 5px of the panel on one side and the section edge on the other. */
    const usable = freeWidth * 0.88;
    const fit = (rows) => Math.min(1, usable / (2 * tagHalf(rows) * pxPerUnit));

    const rows = fit(TAG_WIDE) >= TAG_MIN_SCALE ? TAG_WIDE : TAG_NARROW;
    if (rows !== tagLayout) buildTagRows(rows);

    tagGroup.scale.setScalar(fit(rows));
    /* Centre of the free strip, converted from px across the field to world x. */
    tagGroup.position.x = (freeLeft + freeWidth / 2 - w / 2) / pxPerUnit;
  }

  function resize() {
    const w = host.clientWidth;
    const h = host.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    uni.uRes.value.set(w * renderer.getPixelRatio(), h * renderer.getPixelRatio());
    txCam.aspect = w / h;
    txCam.updateProjectionMatrix();
    placeTag(w, h);
  }
  resize();
  new ResizeObserver(resize).observe(host);

  /* --- pointer: the panel tilts, the aurora parallaxes behind it ---------- */
  const target = { x: 0, y: 0 };
  const ptr = { x: 0, y: 0 };
  /*
   * The field is pointer-events:none so the panel keeps its own hover and the
   * link stays clickable, so the cursor is read off the section instead and
   * converted against the field's own box.
   */
  const section = host.closest('section') || host;

  function fromEvent(e) {
    const rect = host.getBoundingClientRect();
    const p = e.touches ? e.touches[0] : e;
    target.x = ((p.clientX - rect.left) / rect.width - 0.5) * 2;
    target.y = -((p.clientY - rect.top) / rect.height - 0.5) * 2;
    if (panel) {
      /* the specular pool inside the glass follows the cursor */
      const pr = panel.getBoundingClientRect();
      panel.style.setProperty('--mx', (((p.clientX - pr.left) / pr.width) * 100).toFixed(1) + '%');
      panel.style.setProperty('--my', (((p.clientY - pr.top) / pr.height) * 100).toFixed(1) + '%');
    }
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
  /*
   * The tilt writes panel.style.transform every frame and the entrance tweens
   * the same property, so the tilt is held back until the entrance has landed.
   * Without this the panel never rises — the loop overwrites the tween.
   */
  let entered = false;

  /*
   * Half rate. These are ambient drifts — orbiting lights, a breathing ring, a
   * slow parallax — redrawn as a full-viewport fragment shader every refresh.
   * On a 120Hz panel that is four times the shading the artwork needs, and it
   * is what had the fans running. 30 divides evenly into both 60 and 120, so
   * the cadence stays regular rather than juddering.
   *
   * The hero is deliberately not capped: it carries the scroll-scrubbed motion,
   * where a dropped frame reads as a stutter.
   */
  const FRAME_INTERVAL_MS = 1000 / 30;
  let lastFrameAt = 0;

  function frame(now) {
    frameId = requestAnimationFrame(frame);
    /* Called straight through the first time, with no timestamp — always draw
       that one, or the section shows an empty canvas until the next tick. */
    if (now !== undefined) {
      if (now - lastFrameAt < FRAME_INTERVAL_MS) return;
      lastFrameAt = now;
    }
    if (!prefersReducedMotion) uni.uTime.value = clock.getElapsedTime() + sharedPhase();

    ptr.x += (target.x - ptr.x) * 0.06;
    ptr.y += (target.y - ptr.y) * 0.06;
    uni.uPtr.value.set(ptr.x, ptr.y);

    if (entered && panel && !prefersReducedMotion) {
      panel.style.transform =
        'translateY(0px) scale(1) rotateY(' +
        (ptr.x * 4).toFixed(2) +
        'deg) rotateX(' +
        (ptr.y * 3).toFixed(2) +
        'deg)';
    }

    renderer.clear();
    renderer.render(scene, cam);
    /* The aurora quad wrote depth at the far plane; without this the glyphs,
       which sit in front of nothing, fail the test and never appear. */
    renderer.clearDepth();
    if (tagVisible) renderer.render(txScene, txCam);
  }

  let entranceCtx = null;

  function playEntrance() {
    if (entrancePlayed) return;
    entrancePlayed = true;
    entranceCtx = gsap.context(entranceSequence);
  }

  /*
   * Rewound whenever the section leaves the screen, so scrolling back to it
   * starts from the dark instead of dropping you into a lit poster. The context
   * collects every tween — including the floor glow's infinite breathe, which
   * would otherwise stack a fresh copy on each visit.
   */
  function resetEntrance() {
    if (entranceCtx) entranceCtx.revert();
    entranceCtx = null;
    entrancePlayed = false;
    entered = false;
    bloomArr.fill(0);
    uni.uGrain.value = 0;
    /* revert() restores the tween's own start values; the per-frame tilt is not
       a tween, so its inline transform has to be cleared by hand. */
    if (panel) panel.style.transform = '';
    /* Rows rebuilt after the entrance were placed lit by hand rather than by a
       tween, so revert() does not know about them. */
    tagLetters.forEach((mesh) => {
      mesh.material.opacity = 0;
    });
  }

  function entranceSequence() {
    const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });

    if (panel) {
      tl.to(
        panel,
        {
          opacity: 1,
          y: 0,
          scale: 1,
          duration: 1.4,
          ease: 'power2.out',
          onComplete() {
            entered = true;
          },
        },
        0.15
      );
    }

    /* the lights bloom on one after another — peach, magenta, violet, blue */
    for (let i = 0; i < AURORA_BLOB_COUNT; i++) {
      const o = { v: 0 };
      tl.to(
        o,
        {
          v: 1,
          duration: 1.6,
          ease: 'power2.inOut',
          onUpdate() {
            bloomArr[i] = o.v;
          },
        },
        0.8 + i * 0.3
      );
    }

    /*
     * The rows land after the panel, one glyph at a time, drifting in from the
     * right so the eye is carried out of the card and into them.
     */
    if (tagVisible) {
      tagLetters.forEach((mesh, i) => {
        const at = 1.0 + i * 0.028;
        tl.fromTo(
          mesh.position,
          { x: mesh.position.x + 0.5 },
          { x: mesh.position.x, duration: 1.1, ease: 'power3.out' },
          at
        );
        tl.to(mesh.material, { opacity: 0.95, duration: 0.8, ease: 'power2.out' }, at);
      });
    }

    tl.to(uni.uGrain, { value: 1, duration: 1.2, ease: 'power2.out' }, 1.4);
    if (floor) {
      tl.to(floor, { opacity: 0.75, duration: 1.6, ease: 'power2.out' }, 1.8);
      /* the floor glow breathes with the screen */
      gsap.to(floor, {
        opacity: 0.5,
        duration: 4.2,
        repeat: -1,
        yoyo: true,
        ease: 'sine.inOut',
        delay: 4,
      });
    }
  }

  /*
   * The drawing buffer, held separately from the render gate.
   *
   * A full-viewport context costs a colour and a depth buffer at the canvas
   * size — about 12MB each on an 1890x862 window — and the page holds ten of
   * them once you have scrolled to the bottom. Measured: 162MB of buffers
   * alone, and that scales with the square of the device pixel ratio, so it is
   * nearer 360MB on a 150%-scaled display.
   *
   * Collapsing the backing store to 1x1 gives nearly all of that back, and it
   * costs nothing to undo: the context, its compiled programs and its textures
   * all survive, so returning is a resize rather than a rebuild. updateStyle is
   * false, so the canvas keeps its CSS box and no layout moves.
   *
   * This is deliberately NOT driven by the same observer as the render gate.
   * That one fires 200px out, which during a normal scroll means reallocating
   * a 12MB buffer and running resize()'s layout reads in the middle of the
   * gesture — the stutter that bought. The release observer below is a screen
   * and a half out instead, so ordinary scrolling never touches it and the
   * buffer is back long before the section is looked at.
   */
  let bufferLive = true;

  function releaseBuffer() {
    if (!bufferLive) return;
    bufferLive = false;
    renderer.setSize(1, 1, false);
  }

  function restoreBuffer() {
    if (bufferLive) return;
    bufferLive = true;
    resize();
  }

  function sync() {
    const shouldRun = onScreen && !document.hidden;
    if (shouldRun) {
      restoreBuffer();
      playEntrance();
      if (frameId === null) frame();
      return;
    }

    if (frameId !== null) {
      cancelAnimationFrame(frameId);
      frameId = null;
    }

    /* A backgrounded tab is not coming back mid-gesture, so it can pay the
       realloc on return. */
    if (document.hidden) releaseBuffer();
  }

  if (prefersReducedMotion) {
    /* No entrance to play, so everything is placed at its settled values. */
    bloomArr.fill(1);
    uni.uGrain.value = 1;
    if (panel) {
      panel.style.opacity = 1;
      panel.style.transform = 'none';
    }
    if (floor) floor.style.opacity = 0.75;
    /* .about-field is display:none in this mode and .about-tagline becomes real
       copy, so only the one settled frame is drawn and the rows stay dark. */
    renderer.clear();
    renderer.render(scene, cam);
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

  /* Memory only — see the note on releaseBuffer(). */
  new IntersectionObserver(
    ([entry]) => (entry.isIntersecting ? restoreBuffer() : releaseBuffer()),
    { rootMargin: '150%' }
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
    renderer = new THREE.WebGLRenderer({
      /*
       * No multisampling, and no stencil.
       *
       * MSAA only antialiases polygon edges. Every field draws full-screen
       * shader quads, glyph planes, points and sprites — all of them textured
       * or analytic, none with a geometric edge for MSAA to find — so it was
       * buying nothing and costing a 4x multisampled colour and depth buffer
       * per context. On a 1890x862 window that is roughly 52MB a field rather
       * than 13MB, and the page runs nine of them. Nothing here uses stencil
       * either. The hero keeps antialias: it is the one scene with real
       * geometry whose silhouette MSAA actually cleans up.
       */
      antialias: false,
      stencil: false,
    });
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
  renderer.setPixelRatio(pixelRatioFor(FIELD_PIXEL_CAP, 1.25));
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
  /* Half a row band in scene units: half a glyph plus the half-gap to the other
     row's centre. rowY() needs it to know how much vertical room the pair takes. */
  const BAND_HALF = 0.155 + LETTER_SIZE / 2;

  /* Laid out around y=0; resize() places the whole row group. */
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

  /*
   * Where the row band sits: the middle of the halo when the cards leave the
   * middle clear, above them when they do not.
   *
   * The four cards stand off the halo's sides on a wide box, so the centre is
   * free and the word belongs at y = 0, which is where the rings are drawn.
   * Below about 1100px the corridor between the two columns closes (see the CSS)
   * and the cards cross the centre, where a centred word would simply be behind
   * two of them. So the corridor is measured rather than assumed, and the word
   * holds the centre only while it actually fits there.
   *
   * The fallback is what this did before: put the band's bottom a margin above
   * the deck's top edge, clamped so it cannot climb into the field's own top
   * mask, which would draw the word at a fraction of its alpha — worse than not
   * drawing it, because it reads as a mistake. That ramp is only the first 4%
   * now: it was widened to 12% to fade the artwork out before the section's
   * edge, and it is short again so the halo meets the scene above instead.
   */
  const CORRIDOR_MARGIN_PX = 28;
  const DECK_GAP_PX = 56;

  function rowY(scale, fieldRect) {
    const deck = document.querySelector('.concepts-deck');
    if (!deck) return 0;

    const halfHeight = Math.tan(((txCam.fov / 2) * Math.PI) / 180) * txCam.position.z;
    const halfPx = fieldRect.height / 2;
    /* One world unit in px. The aspect cancels, so this holds on both axes. */
    const pxPerUnit = halfPx / halfHeight;

    const mid = fieldRect.width / 2;
    const cards = [...document.querySelectorAll('.concept-card')].map((c) => {
      const r = c.getBoundingClientRect();
      return { left: r.left - fieldRect.left, right: r.right - fieldRect.left };
    });
    const leftEdges = cards.filter((c) => c.right <= mid).map((c) => c.right);
    const rightEdges = cards.filter((c) => c.left >= mid).map((c) => c.left);
    /* No cards either side of the middle — one column, on a phone — means none. */
    const corridor =
      leftEdges.length && rightEdges.length ? Math.min(...rightEdges) - Math.max(...leftEdges) : 0;

    const wordPx = 2 * WORD_HALF * scale * pxPerUnit;
    if (corridor >= wordPx + CORRIDOR_MARGIN_PX * 2) return 0;

    const deckTopPx = deck.getBoundingClientRect().top - fieldRect.top;
    const wantBottom = ((halfPx - (deckTopPx - DECK_GAP_PX)) / halfPx) * halfHeight;
    const lift = wantBottom / scale + BAND_HALF;

    /* The 4% ramp, plus a little headroom so the row does not sit in its tail. */
    const maskFloorPx = fieldRect.height * 0.06;
    const maxLift = (((halfPx - maskFloorPx) / halfPx) * halfHeight) / scale - BAND_HALF;
    return Math.max(0, Math.min(lift, maxLift));
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
    const scale = Math.min(1, (haloDiameter * 0.82) / (WORD_HALF * 2), fitScale(txCam, w / h, WORD_HALF));
    txScene.scale.setScalar(scale);
    rows.position.y = rowY(scale, host.getBoundingClientRect());
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

  /*
   * Half rate. These are ambient drifts — orbiting lights, a breathing ring, a
   * slow parallax — redrawn as a full-viewport fragment shader every refresh.
   * On a 120Hz panel that is four times the shading the artwork needs, and it
   * is what had the fans running. 30 divides evenly into both 60 and 120, so
   * the cadence stays regular rather than juddering.
   *
   * The hero is deliberately not capped: it carries the scroll-scrubbed motion,
   * where a dropped frame reads as a stutter.
   */
  const FRAME_INTERVAL_MS = 1000 / 30;
  let lastFrameAt = 0;

  function frame(now) {
    frameId = requestAnimationFrame(frame);
    /* Called straight through the first time, with no timestamp — always draw
       that one, or the section shows an empty canvas until the next tick. */
    if (now !== undefined) {
      if (now - lastFrameAt < FRAME_INTERVAL_MS) return;
      lastFrameAt = now;
    }
    const t = prefersReducedMotion ? 0 : clock.getElapsedTime() + sharedPhase();
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

  /*
   * The drawing buffer, held separately from the render gate.
   *
   * A full-viewport context costs a colour and a depth buffer at the canvas
   * size — about 12MB each on an 1890x862 window — and the page holds ten of
   * them once you have scrolled to the bottom. Measured: 162MB of buffers
   * alone, and that scales with the square of the device pixel ratio, so it is
   * nearer 360MB on a 150%-scaled display.
   *
   * Collapsing the backing store to 1x1 gives nearly all of that back, and it
   * costs nothing to undo: the context, its compiled programs and its textures
   * all survive, so returning is a resize rather than a rebuild. updateStyle is
   * false, so the canvas keeps its CSS box and no layout moves.
   *
   * This is deliberately NOT driven by the same observer as the render gate.
   * That one fires 200px out, which during a normal scroll means reallocating
   * a 12MB buffer and running resize()'s layout reads in the middle of the
   * gesture — the stutter that bought. The release observer below is a screen
   * and a half out instead, so ordinary scrolling never touches it and the
   * buffer is back long before the section is looked at.
   */
  let bufferLive = true;

  function releaseBuffer() {
    if (!bufferLive) return;
    bufferLive = false;
    renderer.setSize(1, 1, false);
  }

  function restoreBuffer() {
    if (bufferLive) return;
    bufferLive = true;
    resize();
  }

  function sync() {
    const shouldRun = onScreen && !document.hidden;
    if (shouldRun) {
      restoreBuffer();
      playEntrance();
      if (frameId === null) frame();
      return;
    }

    if (frameId !== null) {
      cancelAnimationFrame(frameId);
      frameId = null;
    }

    /* A backgrounded tab is not coming back mid-gesture, so it can pay the
       realloc on return. */
    if (document.hidden) releaseBuffer();
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

  /* Memory only — see the note on releaseBuffer(). */
  new IntersectionObserver(
    ([entry]) => (entry.isIntersecting ? restoreBuffer() : releaseBuffer()),
    { rootMargin: '150%' }
  ).observe(host);

  document.addEventListener('visibilitychange', sync);
}

/* -------------------------------------------------------------------------
 * Services background — the warp burst
 *
 * The supplied sketch, ported from three r128 to r185. Comets streaming
 * outward from a vortex: each an analytic curved trail with a bright head and
 * a tapering tail, respawning at the centre and flying out forever. A handful
 * of hero comets flare wide and carry a luminous head halo; bokeh sparks drift
 * between them. Two passes share one renderer, so `renderer.autoClear` is off
 * and the clear is driven by hand.
 *
 * The sketch drove its own clock at a fixed rate. Here the rate is a plain JS
 * object the entrance ramps with GSAP, and initServicesField accumulates it
 * into uWarpT by frame delta — so the stream spools up from stillness on
 * arrival and cannot jump when a throttled or backgrounded frame lands late.
 * ---------------------------------------------------------------------- */

/*
 * How many comets each layer draws.
 *
 * The sketch ran 60 trail evaluations a pixel, every one of them a handful of
 * exp and pow calls, as a full-viewport fragment shader. That is affordable on
 * its own; this page runs nine WebGL fields, so the counts are injected as
 * defines and halved on phones rather than baked into the source. Desktop keeps
 * a near-full swarm, and the 30fps cap the other fields use applies here too.
 */
const WARP_LAYERS_DESKTOP = { FAR: 8, SWARM: 22, LINERS: 8, HEROES: 5, SPARKS: 9 };
const WARP_LAYERS_MOBILE = { FAR: 4, SWARM: 11, LINERS: 4, HEROES: 3, SPARKS: 5 };

const WARP_FRAGMENT_SHADER = `
  precision highp float;
  uniform vec2  uRes, uPtr, uCentre;
  uniform float uWarpT, uTime, uReveal, uHero, uReach;

  const float TAU = 6.28318530718;

  float hash(float n){ return fract(sin(n*127.1)*43758.5453); }
  float angDiff(float a, float b){ return atan(sin(a-b), cos(a-b)); }

  /*
   * One comet: an analytic curved trail radiating from the vortex. Returns the
   * trail plus its bloom, and for the heroes a luminous head halo on top.
   *
   * Everything is solved in "progress" space: s is how far along its journey
   * this pixel sits, prog is where the comet's head has got to, and the trail
   * exists only over the tail behind it. So the whole swarm is one closed-form
   * evaluation per pixel with no particles to simulate and nothing to store.
   */
  vec3 comet(vec2 p, float thPix, float rPix, float k, float t,
             float widthMul, float ampMul, float tailMul, float haloAmp, float pxUV){
    float a0    = hash(k*1.7) * TAU + t*0.004*(hash(k*8.1)-0.5);
    float speed = 0.050 + 0.075*hash(k*2.3);
    float bend  = (hash(k*3.1) - 0.5) * 0.9;
    float tail  = (0.20 + 0.22*hash(k*4.7)) * tailMul;
    float prog  = fract(hash(k*5.3) + t*speed);

    /* palette by lot: blue / violet / purple / pink / white */
    float c = hash(k*6.9);
    vec3 tint = c < 0.28 ? vec3(0.25,0.45,1.00)
              : c < 0.52 ? vec3(0.55,0.35,1.00)
              : c < 0.74 ? vec3(0.72,0.42,1.00)
              : c < 0.90 ? vec3(1.00,0.56,0.70)
                         : vec3(0.92,0.90,1.00);

    vec3 acc = vec3(0.0);
    float lifeFade = 1.0 - smoothstep(0.80, 0.99, prog);

    /* the trail */
    float s = pow(clamp(rPix/uReach, 0.0, 1.0), 1.0/1.35);
    if(s <= prog && s >= prog - tail){
      float along = (s - (prog - tail)) / tail;
      float aHere = a0 + bend * s;
      float dAng  = angDiff(thPix, aHere);
      float lat   = abs(dAng) * max(rPix, 0.05);

      /* Never thinner than a pixel and a half, or a trail crossing the frame
         breaks into a dotted line as the derivative outruns the sample grid. */
      float wCore = max(0.0042*widthMul, pxUV*1.6);
      float core = exp(-pow(lat/wCore, 2.0));
      float glowW= exp(-pow(lat/(wCore*3.4), 2.0)) * 0.30;

      float body = pow(along, 2.3);
      float head = exp(-pow((s - prog)/0.030, 2.0)) * 1.6;

      vec3 trailTint = mix(tint, vec3(1.0,0.98,1.0), pow(along, 5.0)*0.55);
      float born = smoothstep(0.028, 0.095, s);
      acc += trailTint * (body + head) * (core + glowW) * born * lifeFade * ampMul;
    }

    /* The head halo. Gated on a literal 0.0 for every layer but the heroes, so
       the compiler drops this whole block from their programs. */
    if(haloAmp > 0.001){
      float rHead = uReach * pow(prog, 1.35);
      float aHead = a0 + bend * prog;
      vec2  hp = rHead * vec2(cos(aHead), sin(aHead));
      float hd = dot(p - hp, p - hp);
      float bornH = smoothstep(0.06, 0.16, prog);
      acc += mix(tint, vec3(1.0), 0.45)
             * (exp(-hd*900.0)*1.1 + exp(-hd*160.0)*0.30)
             * haloAmp * bornH * lifeFade;
    }
    return acc;
  }

  void main(){
    vec2 uv = (gl_FragCoord.xy - 0.5*uRes)/min(uRes.x,uRes.y)*2.0;
    float pxUV = 2.0 / min(uRes.x, uRes.y);

    /* resize() parks the vanishing point; the pointer only nudges it. */
    vec2 C = uCentre + uPtr*0.035;
    vec2 p = uv - C;
    float rPix  = length(p);
    float thPix = atan(p.y, p.x);

    vec3 col = vec3(0.004, 0.004, 0.008);

    /* far layer: faint thin streaks, for depth */
    for(int i=0;i<FAR;i++){
      col += comet(p, thPix, rPix, float(i)+301.0, uWarpT*1.15, 0.62, 0.24, 1.0, 0.0, pxUV);
    }
    /* the swarm */
    for(int i=0;i<SWARM;i++){
      col += comet(p, thPix, rPix, float(i)+1.0, uWarpT, 1.0, 0.85, 1.0, 0.0, pxUV);
    }
    /* the liners: ultra-long thin lines spanning the frame */
    for(int i=0;i<LINERS;i++){
      col += comet(p, thPix, rPix, float(i)*3.3+201.0, uWarpT*0.62, 0.72, 0.42, 3.6, 0.0, pxUV);
    }
    /* the heroes: wide, brilliant, with luminous head halos */
    for(int i=0;i<HEROES;i++){
      float k = float(i)*7.77 + 101.0;
      col += comet(p, thPix, rPix, k, uWarpT*0.8, 3.4, 2.0, 1.0, 0.85*uHero, pxUV) * (0.35 + 0.65*uHero);
    }

    /* bokeh sparks drifting outward slowly */
    for(int i=0;i<SPARKS;i++){
      float k = float(i)+61.0;
      float a = hash(k*1.3)*TAU;
      float rr = 0.15 + fract(hash(k*2.9) + uWarpT*0.018) * 1.1;
      vec2 sp = rr*vec2(cos(a), sin(a));
      float tw = 0.55 + 0.45*sin(uTime*(1.0+hash(k)*2.0) + k);
      col += vec3(0.85,0.72,0.95) * exp(-dot(p-sp,p-sp)*9000.0) * tw * 0.55;
    }

    /* the vortex: tiny faint rings at the vanishing point */
    col += vec3(0.35,0.30,0.75) * exp(-pow((rPix-0.022)*220.0,2.0)) * 0.35;
    col += vec3(0.30,0.24,0.65) * exp(-pow((rPix-0.042)*180.0,2.0)) * 0.22;
    col += vec3(0.45,0.40,0.95) * exp(-rPix*rPix*160.0) * 0.35;

    /*
     * Quiet band across the bottom, where the heading lives. Kept on the
     * unscaled uv, like the eclipse this replaced: the row is placed against
     * the frame, so the band it needs must not move with the vortex.
     * Heavier than the eclipse's 0.20 because a comet is a hard bright edge
     * rather than a soft limb, and the glyph plates alone do not cover it.
     */
    col *= 1.0 - 0.30*smoothstep(0.42, 0.95, -uv.y);
    col *= 1.0 - 0.28*pow(length(uv*vec2(0.60,0.55)), 2.4);
    col += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898,78.233)))*43758.5453)-0.5)/255.0;
    gl_FragColor = vec4(col * uReveal, 1.0);
  }
`;

function initServicesField() {
  const host = document.querySelector('#services-field');
  if (!host) return;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      /*
       * No multisampling, and no stencil.
       *
       * MSAA only antialiases polygon edges. Every field draws full-screen
       * shader quads, glyph planes, points and sprites — all of them textured
       * or analytic, none with a geometric edge for MSAA to find — so it was
       * buying nothing and costing a 4x multisampled colour and depth buffer
       * per context. On a 1890x862 window that is roughly 52MB a field rather
       * than 13MB, and the page runs nine of them. Nothing here uses stencil
       * either. The hero keeps antialias: it is the one scene with real
       * geometry whose silhouette MSAA actually cleans up.
       */
      antialias: false,
      stencil: false,
    });
  } catch (error) {
    console.error('Services field: no WebGL context', error);
    return;
  }

  /*
   * Same r128 grade as the other fields: the shader hand-rolls its trail, bloom
   * and halo terms and adds a 1/255 dither, and an sRGB transfer on the way out
   * would crush the three into one flat glare.
   */
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setPixelRatio(pixelRatioFor(FIELD_PIXEL_CAP, 1.25));
  renderer.autoClear = false;
  host.appendChild(renderer.domElement);

  /* --- pass 1: the warp burst --------------------------------------------- */
  const bgScene = new THREE.Scene();
  const bgCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const uni = {
    uRes: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 },
    uPtr: { value: new THREE.Vector2(0, 0) },
    uReveal: { value: 0 },
    uWarpT: { value: 0 } /* the warp clock; the loop drives it   */,
    uHero: { value: 0 } /* the big flare comets bloom in        */,
    uCentre: { value: new THREE.Vector2(0, 0) } /* the vanishing point */,
    uReach: { value: 2.4 } /* how far a trail flies before it dies */,
  };

  /*
   * The rate the warp clock advances at. A plain object rather than a uniform
   * because GSAP ramps it and the loop integrates it — see the note on the
   * shader, and playEntrance below.
   */
  const warp = { speed: 0 };

  bgScene.add(
    new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        uniforms: uni,
        defines: SMALL_SCREEN.matches ? WARP_LAYERS_MOBILE : WARP_LAYERS_DESKTOP,
        vertexShader: 'void main(){ gl_Position = vec4(position,1.0); }',
        fragmentShader: WARP_FRAGMENT_SHADER,
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
  /* How far the row's right edge stops short of the frame edge, as a fraction. */
  const RIGHT_MARGIN = 0.045;

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
      /* Its place within the row. resize() adds the row's own offset to this. */
      letters[letters.length - 1].userData.baseX = -width / 2 + i * LETTER_GAP;
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
    /* Not 1: past this the row runs into the field's own bottom mask and would
       be drawn at half alpha. That ramp starts at 96% now rather than 90% —
       shortened so the warp reaches the section's edge and meets the scene
       below — so the row has a little more room than it used to. */
    return Math.min(Math.max(f, 0.6), 0.95);
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
     * Where the vortex sits, in the shader's own uv — which spans plus or minus
     * the aspect across and plus or minus one down.
     *
     * The sketch parked it just off centre, which it could: it had nothing in
     * frame but the word. Here .services-inner gives the copy the left column
     * and leaves the right one to the artwork, so the vanishing point follows
     * the aspect out to the right — the dense end of the stream, the rings and
     * the hero halos all clear the card, and the card only ever sees thin
     * outbound streaks. Capped, or an ultrawide window would push it into the
     * bezel; barely offset at all on a portrait phone, where there is no second
     * column to aim at.
     */
    const aspect = w / h;
    uni.uCentre.value.set(aspect > 1 ? Math.min(0.3 * aspect, 0.62) : 0, aspect > 1 ? 0.18 : 0.1);

    /*
     * And how far a trail flies before it fades. The sketch hard-coded 1.55,
     * which stops short of the corners on anything wider than about 4:3 — fine
     * for a frame that was all artwork, but here it would leave the far side of
     * a desktop window empty. Solved against the actual corner instead, so the
     * stream always spans the whole field however it is shaped.
     *
     * Measured off the SHORT side, which is what the shader normalises uv by —
     * not off the aspect. Getting that wrong is only invisible in landscape,
     * where the short side is the height and the two agree: on a 375x812 phone
     * the frame is 2.16 uv units tall, an aspect-derived reach came out at 1.10,
     * and every trail died less than halfway up. The section rendered as a black
     * box with a small blob of comets behind the card.
     */
    const short = Math.min(w, h);
    uni.uReach.value = Math.hypot(w / short, h / short) + uni.uCentre.value.length();

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
    const rowWorldY = (lo + hi) / 2;
    const y = rowWorldY / scale;

    /*
     * And the same bisection for x, to park the row against the right edge.
     *
     * Solving it rather than offsetting by a constant because the answer moves
     * with both the frame's aspect and the scale the row was fitted at, and
     * because the row has to end a fixed distance from the edge however wide the
     * frame is. Probed at the row's own y: lookAt(0, -0.35, 0) tilts the view, so
     * a point's depth — and with it the horizontal projection — depends on how
     * high up it sits.
     */
    const targetNdcX = 1 - 2 * RIGHT_MARGIN;
    let xlo = 0;
    let xhi = halfFrame * 8;
    for (let k = 0; k < 40; k++) {
      const mid = (xlo + xhi) / 2;
      probe.set(mid, rowWorldY, 0).project(restCam);
      if (probe.x > targetNdcX) xhi = mid;
      else xlo = mid;
    }
    /* That is where the row's RIGHT edge goes, so back off its half-width. */
    const xOffset = (xlo + xhi) / 2 / scale - WORD_HALF;

    letters.forEach((m) => {
      m.userData.baseY = y;
      m.position.y = y;
      m.position.x = m.userData.baseX + xOffset;
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

  /*
   * Half rate. These are ambient drifts — a streaming swarm, twinkling sparks,
   * a slow parallax — redrawn as a full-viewport fragment shader every refresh.
   * On a 120Hz panel that is four times the shading the artwork needs, and it
   * is what had the fans running. 30 divides evenly into both 60 and 120, so
   * the cadence stays regular rather than juddering.
   *
   * The hero is deliberately not capped: it carries the scroll-scrubbed motion,
   * where a dropped frame reads as a stutter.
   */
  const FRAME_INTERVAL_MS = 1000 / 30;
  let lastFrameAt = 0;
  /*
   * The warp clock's own integrator, held against the elapsed time rather than
   * asking the clock for a delta: getElapsedTime() consumes one itself, so
   * calling both would hand this a delta of nearly zero and the stream would
   * never advance. Clamped, or a frame landing late after a stall would
   * teleport the whole swarm.
   */
  let lastT = 0;
  /*
   * Both ways now, and this is why: t carries the shared playhead, so it is no
   * longer monotonic — scrolling back up hands this a negative delta. Winding
   * the stream back is right, and it is what makes the warp agree with the
   * scenes either side of it. But the delta is proportional to how fast the
   * reader moved, and a fast flick upward would otherwise hand it several
   * seconds in one frame and teleport the swarm backwards — the same failure the
   * upper clamp exists to stop, in the other direction.
   */
  const MAX_STEP = 0.05;

  function frame(now) {
    frameId = requestAnimationFrame(frame);
    /* Called straight through the first time, with no timestamp — always draw
       that one, or the section shows an empty canvas until the next tick. */
    if (now !== undefined) {
      if (now - lastFrameAt < FRAME_INTERVAL_MS) return;
      lastFrameAt = now;
    }
    const t = prefersReducedMotion ? 0 : clock.getElapsedTime() + sharedPhase();
    uni.uTime.value = t;
    uni.uWarpT.value += Math.max(Math.min(t - lastT, MAX_STEP), -MAX_STEP) * warp.speed;
    lastT = t;

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
   * fired on load, the warp would have spooled up to cruise and the heroes
   * finished flaring long before anyone scrolled down to it.
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
     * The sequence: out of pure black the vortex glints, the warp spools up
     * from stillness to cruise as the comets start pouring out of it, the hero
     * flares bloom, then the heading settles in beneath, letter by letter.
     */
    const tl = gsap.timeline({ defaults: { ease: 'power2.inOut' } });
    tl.to(uni.uReveal, { value: 1, duration: 0.9 }, 0)
      .to(warp, { speed: 1, duration: 2.6, ease: 'power2.in' }, 0.3)
      .to(uni.uHero, { value: 1, duration: 1.8, ease: 'power2.out' }, 1.6);

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

    /*
     * Cruise breathes: the stream surges gently, forever. Started after the ramp
     * has landed on 1, and yoyo returns it there, so the two tweens on
     * warp.speed never fight over it.
     */
    gsap.to(warp, {
      speed: 0.78,
      duration: 5,
      repeat: -1,
      yoyo: true,
      ease: 'sine.inOut',
      delay: 4.5,
    });
  }

  /*
   * The drawing buffer, held separately from the render gate.
   *
   * A full-viewport context costs a colour and a depth buffer at the canvas
   * size — about 12MB each on an 1890x862 window — and the page holds ten of
   * them once you have scrolled to the bottom. Measured: 162MB of buffers
   * alone, and that scales with the square of the device pixel ratio, so it is
   * nearer 360MB on a 150%-scaled display.
   *
   * Collapsing the backing store to 1x1 gives nearly all of that back, and it
   * costs nothing to undo: the context, its compiled programs and its textures
   * all survive, so returning is a resize rather than a rebuild. updateStyle is
   * false, so the canvas keeps its CSS box and no layout moves.
   *
   * This is deliberately NOT driven by the same observer as the render gate.
   * That one fires 200px out, which during a normal scroll means reallocating
   * a 12MB buffer and running resize()'s layout reads in the middle of the
   * gesture — the stutter that bought. The release observer below is a screen
   * and a half out instead, so ordinary scrolling never touches it and the
   * buffer is back long before the section is looked at.
   */
  let bufferLive = true;

  function releaseBuffer() {
    if (!bufferLive) return;
    bufferLive = false;
    renderer.setSize(1, 1, false);
  }

  function restoreBuffer() {
    if (bufferLive) return;
    bufferLive = true;
    resize();
  }

  function sync() {
    const shouldRun = onScreen && !document.hidden;
    if (shouldRun) {
      restoreBuffer();
      playEntrance();
      if (frameId === null) frame();
      return;
    }

    if (frameId !== null) {
      cancelAnimationFrame(frameId);
      frameId = null;
    }

    /* A backgrounded tab is not coming back mid-gesture, so it can pay the
       realloc on return. */
    if (document.hidden) releaseBuffer();
  }

  if (prefersReducedMotion) {
    /*
     * No entrance to play, so every stage is placed at its settled value — and
     * the warp clock is parked at a frame mid-flight rather than at 0, where
     * every comet still sits on the vanishing point and the field would render
     * as an empty vortex.
     */
    uni.uReveal.value = 1;
    uni.uHero.value = 1;
    uni.uWarpT.value = 7;
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

  /* Memory only — see the note on releaseBuffer(). */
  new IntersectionObserver(
    ([entry]) => (entry.isIntersecting ? restoreBuffer() : releaseBuffer()),
    { rootMargin: '150%' }
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
 * About Us background — the silk dune, with ABOUT US lettered across it
 *
 * One luminous ridge divides the frame: violet floods below it, near-black navy
 * above, and pale light rides the fold — hottest at the bend, pooling again over
 * the bowl on the right, with a shimmer gliding along the crest forever. A
 * second, dimmer fold grazes the upper-left corner for depth.
 *
 * This replaces the black-hole image the section used to carry as a CSS
 * background, which is why the field is opaque again and back to the two-pass
 * arrangement every other scene section uses: the dune fills the frame from an
 * orthographic quad, then the depth buffer is cleared and ABOUT US draws over it
 * from the perspective camera that parallaxes off the cursor.
 *
 * The glyphs are decoration: the section's real heading is the visually-hidden
 * h2, which stays selectable, searchable and available to screen readers.
 * ---------------------------------------------------------------------- */
const SILK_FRAGMENT_SHADER = `
  precision highp float;
  uniform vec2  uRes, uPtr;
  uniform float uTime, uReveal, uDraw, uFields, uPool;

  /* GLSL ES 1.00 has no tanh. Clamped before the exp, or the flanks overflow to
     inf and the ridge comes back NaN — a black frame rather than a bad one. */
  float tanhA(float x){
    x = clamp(x, -6.0, 6.0);
    float e = exp(2.0*x);
    return (e - 1.0)/(e + 1.0);
  }

  /*
   * The ridge: an S sweeping down from the upper left, through the centre,
   * flattening into the bowl, rising again at the far right — and always,
   * gently, rolling. Two slow sines of different periods, so the roll never
   * repeats on any interval short enough to notice.
   */
  float W(float x, float t){
    float w = -0.04 - 0.50*tanhA((x + 0.10)*1.35);
    w += 0.26*pow(smoothstep(0.45, 1.7, x), 2.0);
    w += 0.030*sin(x*1.5 + t*0.26) + 0.018*sin(x*2.7 - t*0.19);
    return w;
  }

  void main(){
    vec2 uv = (gl_FragCoord.xy - 0.5*uRes)/min(uRes.x,uRes.y)*2.0;
    uv += uPtr * 0.020;

    /*
     * The ridge is written against a frame reaching about 1.75 uv units either
     * side of centre. Taken literally it would run off the end of a desktop
     * window and stop short of a phone's edges: uv is normalised by the SHORT
     * side, so a 375x812 portrait box only reaches 1.0 across and the sweep
     * would end before the bowl and the right-hand rise — half the shape, and
     * the half the pool of light sits in. Rescaling x spans the S across
     * whatever frame it is given, and everything downstream is solved in that
     * same space, so the pool, the shimmer and the second fold travel with it.
     */
    uv.x *= 1.75 / (uRes.x / min(uRes.x, uRes.y));

    float t = uTime;
    float x = uv.x;
    float d = uv.y - W(x, t);

    /* the two silk fields, either side of the fold */
    float aa = smoothstep(-0.004, 0.004, d);
    vec3 colAbove = mix(vec3(0.052,0.046,0.170), vec3(0.008,0.008,0.032),
                        smoothstep(-0.15, 1.25, d + x*0.28));
    vec3 colBelow = mix(vec3(0.300,0.165,0.880), vec3(0.085,0.050,0.340),
                        smoothstep(0.00, 1.45, -d - x*0.22));
    vec3 col = mix(colBelow, colAbove, aa) * uFields;
    col += vec3(0.004, 0.003, 0.010);

    /* the crest draws itself in from the left */
    float edge = -1.9 + uDraw*3.9;
    float drawM = 1.0 - smoothstep(edge - 0.25, edge, x);

    /* Light riding the fold: a razor line and a soft wrap around it, hottest at
       the bend, glowing again over the bowl, with a shimmer gliding along the
       ridge forever. */
    float crest = exp(-pow(d*26.0, 2.0)) + 0.45*exp(-pow(d*9.0, 2.0));
    float along = 0.16
      + 1.05*exp(-pow((x + 0.10)/0.42, 2.0))
      + 0.70*exp(-pow((x - 0.70)/0.48, 2.0));
    along += 0.35*exp(-pow((x - (-1.6 + fract(t*0.055)*3.4))/0.30, 2.0));

    vec3 crestCol = mix(vec3(0.60,0.44,1.00), vec3(0.97,0.93,1.00),
                        clamp(along*0.7, 0.0, 1.0));
    col += crestCol * crest * along * drawM;

    /* the pool of light settling into the bowl */
    float pool = exp(-pow(length((uv - vec2(0.62,-0.44))*vec2(1.0,1.45)), 2.0)*2.2);
    col += vec3(0.55,0.43,1.00) * pool * 0.48 * uPool * (1.0 - aa*0.55);

    /* the second, dimmer fold grazing the top-left corner */
    float d2 = uv.y - (W(x - 0.55, t) + 0.92);
    float m2 = smoothstep(0.25, -0.65, x) * smoothstep(0.05, 0.65, uv.y);
    col += vec3(0.36,0.25,0.86) * exp(-pow(d2*20.0, 2.0)) * 0.30 * m2 * uDraw;
    col += vec3(0.16,0.11,0.44) * exp(-max(-d2, 0.0)*5.0) * 0.18 * m2 * uFields;

    col *= 1.0 - 0.26*pow(length(uv*vec2(0.58,0.60)), 2.4);
    col += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898,78.233)))*43758.5453)-0.5)/255.0;
    gl_FragColor = vec4(col * uReveal, 1.0);
  }
`;

function initAboutUsField() {
  const host = document.querySelector('#about-us-field');
  if (!host) return;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      /*
       * No multisampling, and no stencil.
       *
       * MSAA only antialiases polygon edges. Every field draws full-screen
       * shader quads, glyph planes, points and sprites — all of them textured
       * or analytic, none with a geometric edge for MSAA to find — so it was
       * buying nothing and costing a 4x multisampled colour and depth buffer
       * per context. On a 1890x862 window that is roughly 52MB a field rather
       * than 13MB, and the page runs nine of them. Nothing here uses stencil
       * either. The hero keeps antialias: it is the one scene with real
       * geometry whose silhouette MSAA actually cleans up.
       */
      antialias: false,
      stencil: false,
    });
  } catch (error) {
    console.error('About Us field: no WebGL context', error);
    return;
  }

  /* Same r128 grade as the other fields: the shader hand-rolls its crest, its
     two silk ramps and a 1/255 dither, and the glyph textures are baked at the
     values we want. An sRGB transfer on the way out would lift both. */
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setPixelRatio(pixelRatioFor(FIELD_PIXEL_CAP, 1.25));
  /* Two passes share the one renderer, so the clear is driven by hand. */
  renderer.autoClear = false;
  host.appendChild(renderer.domElement);

  /* --- pass 1: the silk dune ---------------------------------------------- */
  const bgScene = new THREE.Scene();
  const bgCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const uni = {
    uRes: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 },
    uPtr: { value: new THREE.Vector2(0, 0) },
    uReveal: { value: 0 },
    uDraw: { value: 0 } /* the crest draws along its length */,
    uFields: { value: 0 } /* the two colour fields flood in   */,
    uPool: { value: 0 } /* the glow pools into the bowl     */,
  };

  bgScene.add(
    new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        uniforms: uni,
        vertexShader: 'void main(){ gl_Position = vec4(position,1.0); }',
        fragmentShader: SILK_FRAGMENT_SHADER,
      })
    )
  );

  /* --- pass 2: ABOUT US ---------------------------------------------------- */
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 60);
  camera.position.set(0, 0, 7.2);

  const world = new THREE.Group();
  scene.add(world);

  const wordGroup = new THREE.Group();
  world.add(wordGroup);

  const WORD = 'ABOUT US';
  const LETTER_SIZE = 0.36;
  const LETTER_GAP = 0.4;
  const WORD_WIDTH = (WORD.length - 1) * LETTER_GAP;

  /*
   * The plate is what makes the word legible here. The row is centred, and the
   * crest passes through it a little left of centre — that fold is the brightest
   * thing in the frame, near white where it bends — so each glyph carries a
   * blurred near-black copy of itself underneath. Same treatment as the services
   * word over the warp's hero flares. See letterTexture's opts.
   */
  const GLYPH = { weight: 200, plate: 'rgba(6,4,14,0.92)' };

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
        0,
        0.25 + Math.sin(i * 1.7) * 0.06,
        false,
        GLYPH
      )
    );
    /* Its place in the row. The entrance flies each glyph out to this from the
       centre, and makeLetter only stashes baseY. */
    letters[letters.length - 1].userData.baseX = -WORD_WIDTH / 2 + i * LETTER_GAP;
  });
  /* the coloured strays, as in the reference */
  const echoes = [
    makeLetter(wordGroup, 'B', '#4653f0', 'rgba(70,83,240,0.9)', 0.42, -1.65, -0.63, -0.2, true),
    makeLetter(wordGroup, 'S', '#8a4bff', 'rgba(138,75,255,0.9)', 0.4, 1.95, 0.67, -0.3, true),
  ];
  /* makeLetter only stashes baseY; resize() pulls the strays in by x. */
  echoes.forEach((m) => {
    m.userData.baseX = m.position.x;
  });

  /* --- resize / pointer / loop -------------------------------------------- */
  /* Half the word's own width, echoes excluded: WORD_WIDTH/2 + a half glyph. */
  const WORD_HALF = WORD_WIDTH / 2 + LETTER_SIZE / 2;
  const TAN_HALF_FOV = Math.tan(((45 / 2) * Math.PI) / 180);
  /* The camera z the lettering was drawn for, and the apparent size it is held
     against. Fixed now: with the ribbon gone there is no long sweep to refit,
     and the image behind is framed by the stylesheet rather than by this camera. */
  const DESIGN_Z = 7.2;

  function resize() {
    const w = host.clientWidth;
    const h = host.clientHeight;
    if (!w || !h) return;

    renderer.setSize(w, h, false);
    uni.uRes.value.set(w * renderer.getPixelRatio(), h * renderer.getPixelRatio());
    const a = w / h;
    camera.aspect = a;
    camera.position.z = DESIGN_Z;
    camera.updateProjectionMatrix();

    const halfFrameH = TAN_HALF_FOV * camera.position.z;
    const halfFrameW = halfFrameH * a;

    /*
     * Capped so the row cannot outgrow the frame. On a narrow box the word
     * would otherwise be wider than the frustum and render as "BOUT U" with
     * both ends cut off.
     */
    const zoom = Math.min(1, (halfFrameW * fitMargin(a)) / WORD_HALF);
    wordGroup.scale.setScalar(zoom);

    /*
     * The strays sit further out than the word does, so the same cap would have
     * had to shrink the row to keep them in. They get pulled in instead — they
     * are decoration, and their exact x is not load-bearing.
     */
    echoes.forEach((m) => {
      const limit = (halfFrameW * 0.94) / zoom - m.geometry.parameters.width / 2;
      m.position.x = Math.sign(m.userData.baseX) * Math.min(Math.abs(m.userData.baseX), limit);
    });

    /*
     * Dead centre, which is where the dune puts its bend — unless the card is
     * in the way.
     *
     * On a landscape box the card is bottom-aligned and the middle is clear, so
     * the word sits across the fold and the glyph plates are what let it read
     * against the crest rather than beside it. Below 1:1 the section turns into
     * a block, the card moves to the top and is taller for the reflow, and it
     * lands squarely across the centre — a fixed centre would print the word
     * through the copy, which is the failure the card-derived placement exists
     * to avoid.
     *
     * So: centre when the middle is free, and otherwise the middle of whichever
     * clear band is bigger, clamped inside the field's own mask. A row placed
     * inside that fade is drawn at a fraction of its alpha, which reads as a
     * mistake rather than as a choice. The fade is only the outer 4% now — it
     * was 12%, and was shortened so the dune reaches the section's edges and
     * meets the scenes above and below rather than dissolving into black.
     */
    const rect = host.getBoundingClientRect();
    const halfWordPx = ((LETTER_SIZE / 2) * zoom * (rect.height / 2)) / halfFrameH;
    const midPx = rect.height / 2;
    let targetPx = midPx;

    const cardEl = document.querySelector('.about-us-card');
    if (cardEl) {
      const c = cardEl.getBoundingClientRect();
      const cardTop = c.top - rect.top;
      const cardBottom = c.bottom - rect.top;
      const overlaps = midPx + halfWordPx > cardTop && midPx - halfWordPx < cardBottom;
      if (overlaps) {
        const above = cardTop;
        const below = rect.height - cardBottom;
        targetPx = above >= below ? above / 2 : cardBottom + below / 2;
      }
    }
    targetPx = Math.min(Math.max(targetPx, rect.height * 0.05 + halfWordPx), rect.height * 0.95 - halfWordPx);
    wordGroup.position.y = ((midPx - targetPx) / midPx) * halfFrameH;

    if (prefersReducedMotion) draw();
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

  /*
   * Half rate. These are ambient drifts — a rolling ridge, a shimmer gliding
   * along the crest, a slow parallax — redrawn as a full-viewport fragment
   * shader every refresh. On a 120Hz panel that is four times the shading the
   * artwork needs, and it is what had the fans running. 30 divides evenly into
   * both 60 and 120, so the cadence stays regular rather than juddering.
   *
   * The hero is deliberately not capped: it carries the scroll-scrubbed motion,
   * where a dropped frame reads as a stutter.
   */
  const FRAME_INTERVAL_MS = 1000 / 30;
  let lastFrameAt = 0;

  function frame(now) {
    frameId = requestAnimationFrame(frame);
    /* Called straight through the first time, with no timestamp — always draw
       that one, or the section shows an empty canvas until the next tick. */
    if (now !== undefined) {
      if (now - lastFrameAt < FRAME_INTERVAL_MS) return;
      lastFrameAt = now;
    }
    const t = prefersReducedMotion ? 0 : clock.getElapsedTime() + sharedPhase();
    uni.uTime.value = t;

    ptr.x += (target.x - ptr.x) * 0.05;
    ptr.y += (target.y - ptr.y) * 0.05;
    uni.uPtr.value.set(ptr.x, ptr.y);

    world.rotation.y = ptr.x * 0.14;
    world.rotation.x = -ptr.y * 0.09;

    if (!prefersReducedMotion) {
      world.position.y = Math.sin(t * 0.28) * 0.05;
      letters.forEach((m, i) => {
        m.position.y = m.userData.baseY + Math.sin(t * 0.55 + i * 0.6) * 0.015;
      });
    }

    draw();
  }

  /* The dune fills the frame from the orthographic quad, then the depth buffer
     is cleared so the lettering draws over it from its own camera. */
  function draw() {
    renderer.clear();
    renderer.render(bgScene, bgCam);
    renderer.clearDepth();
    renderer.render(scene, camera);
  }

  let entrancePlayed = false;
  let entranceCtx = null;

  /*
   * Held until the section is on screen. Fired on load, the word would have
   * finished settling long before anyone scrolled this far down.
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
   * every tween the sequence creates — including the infinite float loops,
   * which would otherwise stack a fresh copy on each visit — and revert() both
   * kills them and restores the values they started from.
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
     * Out of black the crest draws itself along the ridge from the left, the
     * violet and navy fields flood in on either side of it, the glow pools into
     * the bowl — and only then does the word gather.
     */
    const tl = gsap.timeline({ defaults: { ease: 'power2.inOut' } });
    tl.to(uni.uReveal, { value: 1, duration: 0.7 }, 0)
      .to(uni.uDraw, { value: 1, duration: 2.2 }, 0.3)
      .to(uni.uFields, { value: 1, duration: 2.0 }, 1.1)
      .to(uni.uPool, { value: 1, duration: 1.8, ease: 'power2.out' }, 2.0);

    /*
     * The word gathers out of the bend: every glyph starts collapsed at the
     * centre at a quarter of its size and flies to its place in the row.
     *
     * Ordered by distance from the centre, not by position in the string, so it
     * spreads outward from the fold rather than sweeping left to right across
     * it.
     *
     * x and scale, deliberately — not y. frame() rewrites position.y on every
     * tick for the idle bob, so an entrance that animated y and nothing else was
     * overwritten before it could be seen: the letters simply faded up on the
     * spot. Nothing owns x or scale, so this actually moves.
     */
    const fromCore = [...letters].sort((a, b) => Math.abs(a.userData.baseX) - Math.abs(b.userData.baseX));
    fromCore.forEach((m, i) => {
      const at = 2.5 + i * 0.075;
      tl.fromTo(m.position, { x: 0 }, { x: m.userData.baseX, duration: 1.15, ease: 'power3.out' }, at);
      tl.fromTo(m.scale, { x: 0.25, y: 0.25 }, { x: 1, y: 1, duration: 1.15, ease: 'back.out(1.2)' }, at);
      tl.to(m.material, { opacity: 0.95, duration: 0.85, ease: 'power2.out' }, at);
    });
    /* The strays arrive last, once the row has finished spreading. */
    echoes.forEach((m, i) => {
      tl.fromTo(
        m.scale,
        { x: 0.7, y: 0.7 },
        { x: 1, y: 1, duration: 1.1, ease: 'back.out(1.6)' },
        3.45 + i * 0.25
      );
      tl.to(m.material, { opacity: 0.55, duration: 1.0 }, 3.45 + i * 0.25);
    });

    echoes.forEach((m, i) => {
      gsap.to(m.position, {
        y: '+=0.10',
        x: i ? '-=0.05' : '+=0.05',
        duration: 6 + i,
        repeat: -1,
        yoyo: true,
        ease: 'sine.inOut',
        delay: 4.8,
      });
    });

    /*
     * And the pool keeps breathing. Started after the ramp has landed on 1, and
     * yoyo returns it there, so the two tweens on uPool never fight over it.
     */
    gsap.to(uni.uPool, {
      value: 0.82,
      duration: 4.6,
      repeat: -1,
      yoyo: true,
      ease: 'sine.inOut',
      delay: 3.8,
    });
  }

  /*
   * The drawing buffer, held separately from the render gate.
   *
   * A full-viewport context costs a colour and a depth buffer at the canvas
   * size — about 12MB each on an 1890x862 window — and the page holds ten of
   * them once you have scrolled to the bottom. Measured: 162MB of buffers
   * alone, and that scales with the square of the device pixel ratio, so it is
   * nearer 360MB on a 150%-scaled display.
   *
   * Collapsing the backing store to 1x1 gives nearly all of that back, and it
   * costs nothing to undo: the context, its compiled programs and its textures
   * all survive, so returning is a resize rather than a rebuild. updateStyle is
   * false, so the canvas keeps its CSS box and no layout moves.
   *
   * This is deliberately NOT driven by the same observer as the render gate.
   * That one fires 200px out, which during a normal scroll means reallocating
   * a 12MB buffer and running resize()'s layout reads in the middle of the
   * gesture — the stutter that bought. The release observer below is a screen
   * and a half out instead, so ordinary scrolling never touches it and the
   * buffer is back long before the section is looked at.
   */
  let bufferLive = true;

  function releaseBuffer() {
    if (!bufferLive) return;
    bufferLive = false;
    renderer.setSize(1, 1, false);
  }

  function restoreBuffer() {
    if (bufferLive) return;
    bufferLive = true;
    resize();
  }

  function sync() {
    const shouldRun = onScreen && !document.hidden;
    if (shouldRun) {
      restoreBuffer();
      playEntrance();
      if (frameId === null) frame();
      return;
    }

    if (frameId !== null) {
      cancelAnimationFrame(frameId);
      frameId = null;
    }

    /* A backgrounded tab is not coming back mid-gesture, so it can pay the
       realloc on return. */
    if (document.hidden) releaseBuffer();
  }

  if (prefersReducedMotion) {
    /* No entrance to play, so the dune and the word are placed at their settled
       values and the frame is drawn once. */
    uni.uReveal.value = 1;
    uni.uDraw.value = 1;
    uni.uFields.value = 1;
    uni.uPool.value = 1;
    letters.forEach((m) => {
      m.material.opacity = 0.95;
    });
    echoes.forEach((m) => {
      m.material.opacity = 0.55;
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

  /* Memory only — see the note on releaseBuffer(). */
  new IntersectionObserver(
    ([entry]) => (entry.isIntersecting ? restoreBuffer() : releaseBuffer()),
    { rootMargin: '150%' }
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
    renderer = new THREE.WebGLRenderer({
      /*
       * No multisampling, and no stencil.
       *
       * MSAA only antialiases polygon edges. Every field draws full-screen
       * shader quads, glyph planes, points and sprites — all of them textured
       * or analytic, none with a geometric edge for MSAA to find — so it was
       * buying nothing and costing a 4x multisampled colour and depth buffer
       * per context. On a 1890x862 window that is roughly 52MB a field rather
       * than 13MB, and the page runs nine of them. Nothing here uses stencil
       * either. The hero keeps antialias: it is the one scene with real
       * geometry whose silhouette MSAA actually cleans up.
       */
      antialias: false,
      stencil: false,
    });
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
  renderer.setPixelRatio(pixelRatioFor(FIELD_PIXEL_CAP, 1.25));
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

  /*
   * Half rate. These are ambient drifts — orbiting lights, a breathing ring, a
   * slow parallax — redrawn as a full-viewport fragment shader every refresh.
   * On a 120Hz panel that is four times the shading the artwork needs, and it
   * is what had the fans running. 30 divides evenly into both 60 and 120, so
   * the cadence stays regular rather than juddering.
   *
   * The hero is deliberately not capped: it carries the scroll-scrubbed motion,
   * where a dropped frame reads as a stutter.
   */
  const FRAME_INTERVAL_MS = 1000 / 30;
  let lastFrameAt = 0;

  function frame(now) {
    frameId = requestAnimationFrame(frame);
    /* Called straight through the first time, with no timestamp — always draw
       that one, or the section shows an empty canvas until the next tick. */
    if (now !== undefined) {
      if (now - lastFrameAt < FRAME_INTERVAL_MS) return;
      lastFrameAt = now;
    }
    const t = clock.getElapsedTime() + sharedPhase();
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

  /*
   * The drawing buffer, held separately from the render gate.
   *
   * A full-viewport context costs a colour and a depth buffer at the canvas
   * size — about 12MB each on an 1890x862 window — and the page holds ten of
   * them once you have scrolled to the bottom. Measured: 162MB of buffers
   * alone, and that scales with the square of the device pixel ratio, so it is
   * nearer 360MB on a 150%-scaled display.
   *
   * Collapsing the backing store to 1x1 gives nearly all of that back, and it
   * costs nothing to undo: the context, its compiled programs and its textures
   * all survive, so returning is a resize rather than a rebuild. updateStyle is
   * false, so the canvas keeps its CSS box and no layout moves.
   *
   * This is deliberately NOT driven by the same observer as the render gate.
   * That one fires 200px out, which during a normal scroll means reallocating
   * a 12MB buffer and running resize()'s layout reads in the middle of the
   * gesture — the stutter that bought. The release observer below is a screen
   * and a half out instead, so ordinary scrolling never touches it and the
   * buffer is back long before the section is looked at.
   */
  let bufferLive = true;

  function releaseBuffer() {
    if (!bufferLive) return;
    bufferLive = false;
    renderer.setSize(1, 1, false);
  }

  function restoreBuffer() {
    if (bufferLive) return;
    bufferLive = true;
    resize();
  }

  function sync() {
    const shouldRun = onScreen && !document.hidden;
    if (shouldRun) {
      restoreBuffer();
      playEntrance();
      if (frameId === null) frame();
      return;
    }

    if (frameId !== null) {
      cancelAnimationFrame(frameId);
      frameId = null;
    }

    /* A backgrounded tab is not coming back mid-gesture, so it can pay the
       realloc on return. */
    if (document.hidden) releaseBuffer();
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

  /* Memory only — see the note on releaseBuffer(). */
  new IntersectionObserver(
    ([entry]) => (entry.isIntersecting ? restoreBuffer() : releaseBuffer()),
    { rootMargin: '150%' }
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
    renderer = new THREE.WebGLRenderer({
      /*
       * No multisampling, and no stencil.
       *
       * MSAA only antialiases polygon edges. Every field draws full-screen
       * shader quads, glyph planes, points and sprites — all of them textured
       * or analytic, none with a geometric edge for MSAA to find — so it was
       * buying nothing and costing a 4x multisampled colour and depth buffer
       * per context. On a 1890x862 window that is roughly 52MB a field rather
       * than 13MB, and the page runs nine of them. Nothing here uses stencil
       * either. The hero keeps antialias: it is the one scene with real
       * geometry whose silhouette MSAA actually cleans up.
       */
      antialias: false,
      stencil: false,
    });
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
  renderer.setPixelRatio(pixelRatioFor(FIELD_PIXEL_CAP, 1.25));
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
    const halfFrameH = Math.tan(((txCam.fov / 2) * Math.PI) / 180) * txCam.position.z;
    const halfFrameW = halfFrameH * a;
    const limitAt = halfFrameW / txScene.scale.x;
    echoes.forEach((m) => {
      const limit = limitAt * 0.94 - m.geometry.parameters.width / 2;
      m.position.x = Math.sign(m.userData.baseX) * Math.min(Math.abs(m.userData.baseX), limit);
    });

    /*
     * Vertical placement. On a landscape box the two cards stand either side of
     * the crater and the middle of the frame is clear, so the row stays on the
     * crater's axis where the sketch put it.
     *
     * Below 768px there is no room for that: the pair stacks full width and
     * fills the screen, so the centre is solid card and the row was printing
     * straight through the copy, where neither could be read. The stylesheet
     * opens a band above the cards at that width — the same room .about-us-card
     * makes for its own word — and this lifts the row into it. 0.76 of the half
     * frame puts the row's centre at about 12% of the height, clear of the
     * cards and inside the field's mask, which is pulled back to 5% to match.
     */
    txScene.position.y = a < 1 ? halfFrameH * 0.76 : 0;

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

  /*
   * Half rate. These are ambient drifts — orbiting lights, a breathing ring, a
   * slow parallax — redrawn as a full-viewport fragment shader every refresh.
   * On a 120Hz panel that is four times the shading the artwork needs, and it
   * is what had the fans running. 30 divides evenly into both 60 and 120, so
   * the cadence stays regular rather than juddering.
   *
   * The hero is deliberately not capped: it carries the scroll-scrubbed motion,
   * where a dropped frame reads as a stutter.
   */
  const FRAME_INTERVAL_MS = 1000 / 30;
  let lastFrameAt = 0;

  function frame(now) {
    frameId = requestAnimationFrame(frame);
    /* Called straight through the first time, with no timestamp — always draw
       that one, or the section shows an empty canvas until the next tick. */
    if (now !== undefined) {
      if (now - lastFrameAt < FRAME_INTERVAL_MS) return;
      lastFrameAt = now;
    }
    const t = clock.getElapsedTime() + sharedPhase();
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
      tl.fromTo(
        m.scale,
        { x: 0.7, y: 0.7 },
        { x: 1, y: 1, duration: 1.1, ease: 'back.out(1.6)' },
        3.3 + i * 0.22
      );
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

  /*
   * The drawing buffer, held separately from the render gate.
   *
   * A full-viewport context costs a colour and a depth buffer at the canvas
   * size — about 12MB each on an 1890x862 window — and the page holds ten of
   * them once you have scrolled to the bottom. Measured: 162MB of buffers
   * alone, and that scales with the square of the device pixel ratio, so it is
   * nearer 360MB on a 150%-scaled display.
   *
   * Collapsing the backing store to 1x1 gives nearly all of that back, and it
   * costs nothing to undo: the context, its compiled programs and its textures
   * all survive, so returning is a resize rather than a rebuild. updateStyle is
   * false, so the canvas keeps its CSS box and no layout moves.
   *
   * This is deliberately NOT driven by the same observer as the render gate.
   * That one fires 200px out, which during a normal scroll means reallocating
   * a 12MB buffer and running resize()'s layout reads in the middle of the
   * gesture — the stutter that bought. The release observer below is a screen
   * and a half out instead, so ordinary scrolling never touches it and the
   * buffer is back long before the section is looked at.
   */
  let bufferLive = true;

  function releaseBuffer() {
    if (!bufferLive) return;
    bufferLive = false;
    renderer.setSize(1, 1, false);
  }

  function restoreBuffer() {
    if (bufferLive) return;
    bufferLive = true;
    resize();
  }

  function sync() {
    const shouldRun = onScreen && !document.hidden;
    if (shouldRun) {
      restoreBuffer();
      playEntrance();
      if (frameId === null) frame();
      return;
    }

    if (frameId !== null) {
      cancelAnimationFrame(frameId);
      frameId = null;
    }

    /* A backgrounded tab is not coming back mid-gesture, so it can pay the
       realloc on return. */
    if (document.hidden) releaseBuffer();
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

  /* Memory only — see the note on releaseBuffer(). */
  new IntersectionObserver(
    ([entry]) => (entry.isIntersecting ? restoreBuffer() : releaseBuffer()),
    { rootMargin: '150%' }
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
    renderer = new THREE.WebGLRenderer({
      /*
       * No multisampling, and no stencil.
       *
       * MSAA only antialiases polygon edges. Every field draws full-screen
       * shader quads, glyph planes, points and sprites — all of them textured
       * or analytic, none with a geometric edge for MSAA to find — so it was
       * buying nothing and costing a 4x multisampled colour and depth buffer
       * per context. On a 1890x862 window that is roughly 52MB a field rather
       * than 13MB, and the page runs nine of them. Nothing here uses stencil
       * either. The hero keeps antialias: it is the one scene with real
       * geometry whose silhouette MSAA actually cleans up.
       */
      antialias: false,
      stencil: false,
    });
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

  /*
   * Half rate. These are ambient drifts — orbiting lights, a breathing ring, a
   * slow parallax — redrawn as a full-viewport fragment shader every refresh.
   * On a 120Hz panel that is four times the shading the artwork needs, and it
   * is what had the fans running. 30 divides evenly into both 60 and 120, so
   * the cadence stays regular rather than juddering.
   *
   * The hero is deliberately not capped: it carries the scroll-scrubbed motion,
   * where a dropped frame reads as a stutter.
   */
  const FRAME_INTERVAL_MS = 1000 / 30;
  let lastFrameAt = 0;

  function frame(now) {
    frameId = requestAnimationFrame(frame);
    /* Called straight through the first time, with no timestamp — always draw
       that one, or the section shows an empty canvas until the next tick. */
    if (now !== undefined) {
      if (now - lastFrameAt < FRAME_INTERVAL_MS) return;
      lastFrameAt = now;
    }
    uni.uTime.value = clock.getElapsedTime() + sharedPhase();

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

  /*
   * The drawing buffer, held separately from the render gate.
   *
   * A full-viewport context costs a colour and a depth buffer at the canvas
   * size — about 12MB each on an 1890x862 window — and the page holds ten of
   * them once you have scrolled to the bottom. Measured: 162MB of buffers
   * alone, and that scales with the square of the device pixel ratio, so it is
   * nearer 360MB on a 150%-scaled display.
   *
   * Collapsing the backing store to 1x1 gives nearly all of that back, and it
   * costs nothing to undo: the context, its compiled programs and its textures
   * all survive, so returning is a resize rather than a rebuild. updateStyle is
   * false, so the canvas keeps its CSS box and no layout moves.
   *
   * This is deliberately NOT driven by the same observer as the render gate.
   * That one fires 200px out, which during a normal scroll means reallocating
   * a 12MB buffer and running resize()'s layout reads in the middle of the
   * gesture — the stutter that bought. The release observer below is a screen
   * and a half out instead, so ordinary scrolling never touches it and the
   * buffer is back long before the section is looked at.
   */
  let bufferLive = true;

  function releaseBuffer() {
    if (!bufferLive) return;
    bufferLive = false;
    renderer.setSize(1, 1, false);
  }

  function restoreBuffer() {
    if (bufferLive) return;
    bufferLive = true;
    resize();
  }

  function sync() {
    const shouldRun = onScreen && !document.hidden;
    if (shouldRun) {
      restoreBuffer();
      playEntrance();
      if (frameId === null) frame();
      return;
    }

    if (frameId !== null) {
      cancelAnimationFrame(frameId);
      frameId = null;
    }

    /* A backgrounded tab is not coming back mid-gesture, so it can pay the
       realloc on return. */
    if (document.hidden) releaseBuffer();
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

  /* Memory only — see the note on releaseBuffer(). */
  new IntersectionObserver(
    ([entry]) => (entry.isIntersecting ? restoreBuffer() : releaseBuffer()),
    { rootMargin: '150%' }
  ).observe(host);

  document.addEventListener('visibilitychange', sync);
}
