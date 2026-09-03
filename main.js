import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

import { pixelRatioFor } from './render-quality.js';
// Canvas-texture glyph rows. Featured Work is the only lettered field left in
// this file; the rest are in story-field.js and team-field.js.
import { makeLetter, fitScale } from './webgl-letters.js';
// The hero's purple-horizon background; also used on the Careers page.
import { initHorizonField } from './horizon-field.js';
// The scroll-driven scene behind #concepts, #about-us and #services.
import { initStoryField } from './story-field.js';
// The scroll-driven scene behind #makers, #about and #contact. Also raises and
// tilts #about's glass panel, which ships hidden and has no other driver.
import { initTeamField } from './team-field.js';
// One gesture, one scene. Replaces the CSS scroll-snap this page used to use.
import { initSectionScroll } from './section-scroll.js';
// The fanned discipline deck in #disciplines. GSAP only — no WebGL.
import { initCardStack } from './card-stack.js';
// The cursor-tracked tilt and sheen on the hero's testimonial card. Also
// GSAP-free: pointer events and CSS custom properties, nothing else.
import { initHolographicCard } from './holographic-card.js';
// The pointer-driven light on the loader's logo outline. No WebGL, no GSAP.
import { initLoaderFlare } from './loader-flare.js';

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

/*
 * Armed at module scope, not inside a boot branch.
 *
 * The overlay is already on screen by the time this runs — a module script is
 * deferred, so the markup is parsed — and it is the one piece of UI that is
 * guaranteed to be visible right now. Waiting for the GLTF branches below
 * would hand the light to the pointer at roughly the moment the loader stops
 * existing.
 */
initLoaderFlare();

/*
 * An extra beat on the loader before it goes.
 *
 * Once the models resolve this used to fire immediately, and on a warm cache
 * that is fast enough that none of the mark registers — the overlay is up for
 * a few hundred milliseconds and reads as a flicker rather than as anything
 * deliberate. Two seconds is long enough to take it in, and long enough for a
 * pointer to actually reach it.
 *
 * The wait holds the whole of releaseLoader, not just the fade: the overlay
 * covers the page, so dropping the scroll lock and refreshing ScrollTrigger
 * underneath it would let the reader scroll a page they cannot see.
 */
const LOADER_HOLD_MS = 2000;

function hideLoader() {
  if (loaderHidden) return;
  /* Latched here rather than after the wait, so the 8s ceiling and the model
     callbacks racing each other cannot queue two holds. */
  loaderHidden = true;
  setTimeout(releaseLoader, LOADER_HOLD_MS);
}

function releaseLoader() {
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
  /* One field for #concepts, #about-us and #services — see story-field.js.
     Mounted against the first of the three, because it is the one whose
     arrival puts the story on screen. */
  mountWhenNear('#story-field', initStoryField);
  /* Likewise one field for #makers, #about and #contact — see team-field.js. */
  mountWhenNear('#team-field', initTeamField);
  mountWhenNear('#projects-field', initProjectsField);
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
  /* One field for #concepts, #about-us and #services — see story-field.js.
     Mounted against the first of the three, because it is the one whose
     arrival puts the story on screen. */
  mountWhenNear('#story-field', initStoryField);
  /* Likewise one field for #makers, #about and #contact — see team-field.js. */
  mountWhenNear('#team-field', initTeamField);
  mountWhenNear('#projects-field', initProjectsField);
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
   * The heading is still not animated here — it is lettered in WebGL by the
   * story field, which fades it in against its own scroll position. The four
   * cards are animated, now that they are all on screen together: there is no
   * cross-fade left to fight over opacity, so they come in as a stagger across
   * the row.
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
   * The heading is not animated here any more. The panel's own h2 is the
   * section's heading, and team-field.js raises the panel it sits on.
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
   * page â€” and hides the arrows, which would then have nothing to step through.
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
