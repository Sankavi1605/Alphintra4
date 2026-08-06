import * as THREE from 'three';
import gsap from 'gsap';

import { pixelRatioFor } from './render-quality.js';

/* =========================================================================
 * Purple horizon
 *
 * Three passes into one canvas: a sky quad carrying the dawn glow, a field of
 * twinkling stars, and the planet. The planet is analytic — no mesh. Every
 * pixel intersects a ray against the sphere equation, so the limb is an exact
 * circle with sub-pixel antialiasing and the atmosphere is a closed-form
 * falloff, which is why there is no banding anywhere along the terminator.
 *
 * The two Earth maps are real (NASA-derived, from the three.js planet set),
 * decoded out of the sketch into assets/ rather than carried as base64.
 * ====================================================================== */

/* Near-black violet above; the purple dawn floods up from the limb centre. */
const HORIZON_SKY_FRAGMENT_SHADER = `
  precision highp float;
  uniform vec2 uRes; uniform float uReveal, uGlow;
  void main(){
    vec2 uv = (gl_FragCoord.xy - 0.5*uRes)/uRes.y*2.0;   /* y: -1..1 */

    /* deep space above, faint violet wash */
    float up = smoothstep(-0.9, 1.1, uv.y);
    vec3 c = mix(vec3(0.055,0.015,0.10), vec3(0.012,0.004,0.020), up);

    /* the dawn: broad purple bloom rising from the limb centre,
       squashed horizontally so the white spreads along the curve */
    vec2 h = vec2(0.0, -0.98);
    float d = length((uv - h) * vec2(0.48, 1.0));
    c += vec3(0.40,0.13,0.70) * exp(-d*1.9)  * 1.05 * uGlow;   /* purple flood  */
    c += vec3(0.70,0.40,0.98) * exp(-d*4.5)  * 0.85 * uGlow;   /* violet core   */
    c += vec3(1.00,0.95,1.00) * exp(-d*11.0) * 1.30 * uGlow;   /* white-hot rim */

    c += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898,78.233)))*43758.5453)-0.5)/255.0;
    gl_FragColor = vec4(c*uReveal, 1.0);
  }
`;

const HORIZON_STAR_VERTEX_SHADER = `
  attribute float aPhase, aSize;
  uniform float uTime;
  varying float vA;
  void main(){
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float tw = 0.65 + 0.35*sin(uTime*(0.6 + fract(aPhase)*1.4) + aPhase*7.0);
    vA = tw;
    gl_PointSize = aSize * tw * (140.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

const HORIZON_STAR_FRAGMENT_SHADER = `
  precision highp float;
  uniform float uReveal;
  varying float vA;
  void main(){
    vec2 q = gl_PointCoord - 0.5;
    float a = smoothstep(0.5, 0.05, length(q));
    vec3 col = mix(vec3(0.85,0.78,1.0), vec3(1.0), vA); /* faint violet tint */
    gl_FragColor = vec4(col, a * vA * uReveal);
  }
`;

const HORIZON_PLANET_FRAGMENT_SHADER = `
  precision highp float;
  uniform float uTime, uReveal, uAtmo, uFov, uAspect, uRise;
  uniform vec2  uRes, uCamRot;
  uniform vec3  uCenter;
  uniform sampler2D uLights, uWater;

  const float R = 30.0;
  const float PI = 3.14159265;

  vec3 shade(vec3 n, vec3 v){
    /* real equirectangular Earth mapping.
       The longitude offset frames Europe / the Mediterranean at
       the front of the visible cap, matching the reference; the
       tiny uTime term keeps the real Earth turning slowly.      */
    float lon = atan(n.z, n.x) - 1.29 + uTime * 0.006;
    float lat = asin(clamp(n.y, -1.0, 1.0));
    vec2 uvT = vec2(fract(lon / (2.0*PI) + 0.5), lat / PI + 0.5);

    float water  = texture2D(uWater,  uvT).r;      /* white = ocean */
    float mland  = 1.0 - smoothstep(0.18, 0.55, water);
    float lights = texture2D(uLights, uvT).r;      /* real cities   */

    /* distance to the limb drives the light: 1 at the horizon,
       falling to 0 toward the viewer */
    float fres = clamp(1.0 - dot(n, v), 0.0, 1.0);
    float lit  = smoothstep(0.28, 1.0, fres);

    vec3 oceanLit  = vec3(0.52,0.30,0.80);   /* bright lavender near limb */
    vec3 oceanDark = vec3(0.050,0.020,0.095);/* near-black at the bottom  */
    vec3 ocean = mix(oceanDark, oceanLit, lit);

    /* real continents as dark silhouettes, faintly violet where lit */
    vec3 earth = mix(vec3(0.012,0.006,0.028), vec3(0.105,0.052,0.165), lit*0.65);
    vec3 col = mix(ocean, earth, mland);

    /* the actual city-light map — Europe's real glow network */
    float glowL = pow(lights, 1.35);
    col += vec3(0.98,0.92,1.0) * glowL * (0.55 + 0.85*lit) * 1.5;

    /* the crisp bright band right at the horizon */
    col += vec3(0.72,0.48,1.00) * pow(fres, 9.0)  * 1.3 * uAtmo;
    col += vec3(1.00,0.97,1.00) * pow(fres, 28.0) * 2.2 * uAtmo;
    return col;
  }

  void main(){
    vec2 uv = (gl_FragCoord.xy - 0.5*uRes)/uRes * 2.0;

    /* build the exact same perspective ray the star camera uses */
    vec3 rd = normalize(vec3(uv.x*uFov*uAspect, uv.y*uFov, -1.0));
    float cx = cos(uCamRot.x), sx = sin(uCamRot.x);
    float cy = cos(uCamRot.y), sy = sin(uCamRot.y);
    rd.yz = mat2(cx,-sx,sx,cx) * rd.yz;
    rd.xz = mat2(cy,-sy,sy,cy) * rd.xz;

    vec3 ro = vec3(0.0);
    vec3 c  = uCenter + vec3(0.0, uRise, 0.0);

    /* analytic ray-sphere */
    vec3  oc = ro - c;
    float b  = dot(oc, rd);
    float h2 = dot(oc,oc) - b*b;          /* squared distance of ray to centre */
    float bp = sqrt(max(h2, 0.0));        /* impact parameter                  */
    float edge = R - bp;                  /* >0 inside the disc, <0 outside    */

    /* sub-pixel antialiasing width at the sphere's distance */
    float dist = max(-b, 1.0);
    float px = dist * uFov * 2.0 / uRes.y;
    float aa = smoothstep(-px, px, edge);

    vec3 col = vec3(0.0);
    float alpha = 0.0;

    if(edge > -px){ /* surface */
      float t = -b - sqrt(max(R*R - h2, 0.0));
      vec3 p = ro + rd*max(t, 0.0);
      vec3 n = normalize(p - c);
      col = shade(n, -rd);
      alpha = aa;
    }

    /* analytic atmosphere halo — pure exponential falloff, no shell mesh */
    float out_ = max(bp - R, 0.0);
    vec3 halo = vec3(0.55,0.25,0.95) * exp(-out_*1.1) * 0.85
              + vec3(0.85,0.60,1.05) * exp(-out_*3.2) * 0.75
              + vec3(1.00,0.96,1.00) * exp(-out_*9.0) * 0.85;
    /* brighter halo toward the dawn point at the top of the limb */
    float toward = clamp(0.5 + 0.5*normalize(c - ro + rd*max(-b,0.0)).y + 0.9, 0.0, 1.35);
    halo *= (1.0 - aa) * uAtmo * toward;

    col += halo;
    alpha = max(alpha, clamp(max(max(halo.r,halo.g),halo.b), 0.0, 1.0));

    gl_FragColor = vec4(col * uReveal, alpha * uReveal);
  }
`;

export function initHorizonField(selector = '#horizon-field') {
  const host = document.querySelector(selector);
  if (!host) return;

  let renderer;
  try {
    /*
     * No multisampling: the sphere's edge is antialiased analytically inside
     * the shader (see the sub-pixel width above) and the atmosphere is a
     * closed-form falloff, so there is no geometric edge for MSAA to work on —
     * it was costing a 4x colour and depth buffer for nothing. Same call the
     * home page's fields make.
     */
    renderer = new THREE.WebGLRenderer({
      antialias: false,
      stencil: false,
    });
  } catch (error) {
    console.error('Horizon field: no WebGL context', error);
    return;
  }

  /*
   * Same r128 grade as the other two fields: the sky, the rim and the halo are
   * all authored for linear output, and r155+ would push their additive
   * highlights through an sRGB transfer on top and blow the dawn out to white.
   */
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  /* 1.5, matching the home page's fields — see the note there. */
  renderer.setPixelRatio(pixelRatioFor(1.5, 1.25));
  renderer.autoClear = false;
  host.appendChild(renderer.domElement);

  /* --- pass 1: the sky and its dawn --------------------------------------- */
  const bgScene = new THREE.Scene();
  const bgCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const bgUni = {
    uRes: { value: new THREE.Vector2(1, 1) },
    uReveal: { value: 0 },
    /* dawn intensity, GSAP-driven */
    uGlow: { value: 0 },
  };

  bgScene.add(
    new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        uniforms: bgUni,
        vertexShader: 'void main(){ gl_Position = vec4(position,1.0); }',
        fragmentShader: HORIZON_SKY_FRAGMENT_SHADER,
      })
    )
  );

  /* --- pass 2: stars ------------------------------------------------------ */
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
  camera.position.set(0, 0, 0);

  const starUni = { uTime: { value: 0 }, uReveal: { value: 0 } };

  /* 3200 points, with a denser milky-way band running down the middle */
  {
    const N = 3200;
    const pos = new Float32Array(N * 3);
    const phase = new Float32Array(N);
    const size = new Float32Array(N);
    const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;

    for (let i = 0; i < N; i++) {
      const band = i < N * 0.42; /* 42% in the central band */
      pos[i * 3] = band ? gauss() * 9 : (Math.random() - 0.5) * 110;
      pos[i * 3 + 1] = band ? Math.random() * 55 - 8 : Math.random() * 70 - 10;
      pos[i * 3 + 2] = -55 - Math.random() * 35;
      phase[i] = Math.random() * Math.PI * 2;
      size[i] = 0.35 + Math.pow(Math.random(), 3.2) * 2.4; /* few big, many tiny */
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));

    scene.add(
      new THREE.Points(
        g,
        new THREE.ShaderMaterial({
          uniforms: starUni,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          vertexShader: HORIZON_STAR_VERTEX_SHADER,
          fragmentShader: HORIZON_STAR_FRAGMENT_SHADER,
        })
      )
    );
  }

  /* --- pass 3: the analytic planet ---------------------------------------- */
  const planetScene = new THREE.Scene();
  const planetUni = {
    uTime: { value: 0 },
    uReveal: { value: 0 },
    uAtmo: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uFov: { value: Math.tan((50 * Math.PI) / 360) },
    uAspect: { value: 1 },
    /* x: pitch, y: yaw */
    uCamRot: { value: new THREE.Vector2(0, 0) },
    uCenter: { value: new THREE.Vector3(0, -35.5, -20) },
    uRise: { value: 0 },
    /* real Earth city lights (equirect) */
    uLights: { value: null },
    /* real land/water mask (equirect) */
    uWater: { value: null },
  };

  planetScene.add(
    new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        uniforms: planetUni,
        transparent: true,
        depthWrite: false,
        vertexShader: 'void main(){ gl_Position = vec4(position,1.0); }',
        fragmentShader: HORIZON_PLANET_FRAGMENT_SHADER,
      })
    )
  );

  /* --- the real Earth maps ------------------------------------------------ */
  {
    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    const prep = (t) => {
      t.wrapS = THREE.RepeatWrapping; /* seamless across the date line */
      t.wrapT = THREE.ClampToEdgeWrapping;
      if (maxAniso > 1) t.anisotropy = Math.min(8, maxAniso);
      return t;
    };

    /*
     * 1x1 fallbacks so the scene still renders before — or without — the maps:
     * lights black (no cities yet), water white (all ocean, pure lavender).
     */
    const solid = (v) => {
      const t = new THREE.DataTexture(new Uint8Array([v, v, v, 255]), 1, 1, THREE.RGBAFormat);
      t.needsUpdate = true;
      return t;
    };
    planetUni.uLights.value = solid(0);
    planetUni.uWater.value = solid(255);

    const loader = new THREE.TextureLoader();
    loader.load(
      './assets/earth-lights.jpg',
      (t) => {
        planetUni.uLights.value = prep(t);
      },
      undefined,
      () => console.warn('Horizon field: lights map failed, using fallback')
    );
    loader.load(
      './assets/earth-water.jpg',
      (t) => {
        planetUni.uWater.value = prep(t);
      },
      undefined,
      () => console.warn('Horizon field: water map failed, using fallback')
    );
  }

  /* --- resize / pointer / loop -------------------------------------------- */
  function resize() {
    const w = host.clientWidth;
    const h = host.clientHeight;
    if (!w || !h) return;

    renderer.setSize(w, h, false);
    bgUni.uRes.value.set(w * renderer.getPixelRatio(), h * renderer.getPixelRatio());
    planetUni.uRes.value.copy(bgUni.uRes.value);
    planetUni.uAspect.value = w / h;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  new ResizeObserver(resize).observe(host);

  const target = { x: 0, y: 0 };
  const ptr = { x: 0, y: 0 };
  /*
   * The field is pointer-events:none so the button keeps its hover, so the
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

  function draw() {
    renderer.clear();
    renderer.render(bgScene, bgCam);
    renderer.clearDepth();
    renderer.render(scene, camera); /* stars */
    renderer.clearDepth();
    /* the planet last, so its disc occludes the stars below the limb */
    renderer.render(planetScene, bgCam);
  }

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
    const t = clock.getElapsedTime();

    starUni.uTime.value = t;
    planetUni.uTime.value = t;

    ptr.x += (target.x - ptr.x) * 0.04;
    ptr.y += (target.y - ptr.y) * 0.04;

    /* the sky parallaxes more than the planet — gentle depth */
    camera.rotation.y = -ptr.x * 0.035;
    camera.rotation.x = ptr.y * 0.025;
    planetUni.uCamRot.value.set(camera.rotation.x, camera.rotation.y);

    draw();
  }

  let entrancePlayed = false;

  /*
   * The dawn sequence: stars fade up first, the planet rises into frame, then
   * the atmosphere ignites and the purple dawn floods the sky.
   */
  function playEntrance() {
    if (entrancePlayed) return;
    entrancePlayed = true;

    planetUni.uRise.value = -2.4; /* start below frame, rise to 0 */

    const tl = gsap.timeline({ defaults: { ease: 'power2.out' } });
    tl.to(bgUni.uReveal, { value: 1, duration: 1.4, ease: 'power2.inOut' }, 0)
      .to(starUni.uReveal, { value: 1, duration: 2.2 }, 0.3)
      .to(planetUni.uReveal, { value: 1, duration: 2.0 }, 0.8)
      .to(planetUni.uRise, { value: 0, duration: 3.2, ease: 'power3.out' }, 0.8)
      .to(planetUni.uAtmo, { value: 1, duration: 2.0 }, 1.4)
      .to(bgUni.uGlow, { value: 1, duration: 2.6, ease: 'power2.inOut' }, 1.6);

    /* once the dawn has landed, the glow breathes very slowly */
    tl.to(bgUni.uGlow, { value: 0.9, duration: 5, repeat: -1, yoyo: true, ease: 'sine.inOut' }, 5);
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

  new IntersectionObserver(
    ([entry]) => {
      onScreen = entry.isIntersecting;
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
