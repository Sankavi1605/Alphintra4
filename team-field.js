import * as THREE from 'three';
import gsap from 'gsap';

import { pixelRatioFor } from './render-quality.js';
import { makeLetter, fitScale } from './webgl-letters.js';

/* =========================================================================
 * The team field — one scene for three sections
 *
 * #makers, #about and #contact used to carry three separate WebGL fields: the
 * soft-focus orbs under THE TEAM, the aurora behind the systems panel, and the
 * halftone dot sheet with DELIVER TRACKS in its crater. Three contexts, three
 * entrances, three pictures that each stopped at their section's edge.
 *
 * This is the three of them rewritten as ONE continuous shot, the same way
 * story-field.js joined #concepts, #about-us and #services. The great orb
 * deflates to a point; that point's light disperses into the four glows of the
 * aurora; the glows drain back down into one sinking point; and the halftone
 * wave blooms out of the crater they sank into. Nothing is cut — the scroll is
 * the playhead.
 *
 * WHY ONE FIXED CANVAS RATHER THAN THREE HOSTS
 *
 * Same reason as the story field: a morph between two scenes cannot be drawn
 * by two elements that stop at a section boundary, because the moment of change
 * lands exactly on the seam, which is the one place neither host can paint. One
 * viewport-sized canvas behind all three has no seam to land on, and costs one
 * context where the old arrangement cost three.
 *
 * Fixed rather than position: sticky, again because body carries
 * overflow-x: hidden, which is a well-known way to silently break sticky
 * depending on how the browser propagates overflow to the viewport.
 *
 * WHAT THIS DROPPED FROM THE THREE IT REPLACED
 *
 * - The About tagline. It used to be lettered in WebGL by the field this
 *   replaced, and the middle beat of this story is the aurora behind a glass
 *   card and is deliberately wordless — so it became real copy in the markup,
 *   and has since been dropped from the section altogether. #about carries its
 *   heading on the panel, which is what labels the section.
 * - The contact field's grab cursor. That host sat inside its section and could
 *   take pointer events; a fixed canvas spanning three sections cannot without
 *   swallowing every click on all three, so the parallax reads the pointer off
 *   window instead. It still follows the cursor; it just no longer advertises
 *   itself as draggable, which it never actually was.
 * ====================================================================== */

/* The three sections the story is told across, in order. p reaches 0, 1 and 2
   as each one's top reaches the top of the viewport. */
const TEAM_SECTIONS = ['#makers', '#about', '#contact'];

/*
 * The background: all three scenes in one fragment shader, cross-faded by uP.
 *
 * Verbatim from the supplied sketch. The two collapse points are the whole
 * trick — ORBPT is where the orb dies and the aurora is born, CRATER is where
 * the aurora drains and the wave blooms — so the transitions are one light
 * being handed on rather than two pictures dissolving into each other.
 */
const TEAM_FRAGMENT_SHADER = `
  precision highp float;
  uniform vec2  uRes, uPtr;
  uniform float uTime, uReveal, uIntro, uP;

  const vec2 ORBPT  = vec2(-0.105, 0.13);   /* where the orb dies    */
  const vec2 CRATER = vec2( 0.00, -0.10);   /* where the light sinks */

  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }

  float blobG(vec2 p, vec2 c, float s){
    vec2 d = p - c;
    return exp(-dot(d,d)/(s*s));
  }

  void main(){
    vec2 uv = (gl_FragCoord.xy - 0.5*uRes)/min(uRes.x,uRes.y)*2.0;
    uv += uPtr * 0.020;
    float t = uTime;
    float p = uP;

    vec3 col = vec3(0.006, 0.004, 0.012);

    /* ---------------- story weights ---------------- */
    float wA       = 1.0 - smoothstep(0.10, 0.50, p);
    float flashA   = exp(-pow((p - 0.50)/0.055, 2.0));
    float disperse = smoothstep(0.50, 0.90, p);
    float growB    = smoothstep(0.55, 0.95, p);
    float colB     = smoothstep(1.04, 1.40, p);
    float wAur     = growB * (1.0 - smoothstep(1.26, 1.48, p));
    float flashC   = exp(-pow((p - 1.40)/0.055, 2.0));
    float wC       = smoothstep(1.38, 1.86, p);

    /* ============ SCENE A — THE TEAM orbs ============ */
    if(wA > 0.002){
      float shrink = 0.05 + 0.95*wA;
      float rimAmp = 1.0 + 2.2*(1.0 - wA);

      vec2  C1 = vec2(-0.42, 0.52) * (0.25 + 0.75*shrink) + uPtr*0.045;
      float R1 = 1.08 * shrink;
      vec2  q  = (uv - C1)/max(R1, 0.001);
      float rq = length(q);
      float inside = (1.0 - smoothstep(0.995, 1.012, rq)) * uIntro;

      if(inside > 0.0){
        float lit = smoothstep(0.95, -0.95, q.x + q.y*0.20);
        vec3 body = mix(vec3(0.115,0.070,0.200), vec3(0.545,0.430,0.850), pow(lit, 1.7));
        float nearEdge = smoothstep(0.60, 0.97, rq) * (1.0 - smoothstep(0.97, 1.03, rq));
        float lowerArc = smoothstep(-0.15, 0.75, -q.y);
        body += vec3(0.560,0.360,0.980) * nearEdge * lowerArc * 1.25 * rimAmp;
        body += vec3(0.760,0.620,1.000) * pow(nearEdge,3.0) * lowerArc * 0.55 * rimAmp;
        col = mix(col, body, inside * wA);
      }
      float dOut = max(rq - 1.0, 0.0) * max(R1, 0.001);
      float lowerArc2 = smoothstep(-0.15, 0.75, -q.y);
      col += vec3(0.400,0.240,0.780) * exp(-pow(dOut*5.5, 1.35)) * lowerArc2 * 0.55 * wA * uIntro;

      float fadeCo = wA*wA;
      vec2  q2 = (uv - (vec2(0.66,-1.02) + uPtr*0.075))/0.78;
      float in2 = 1.0 - smoothstep(0.98, 1.06, length(q2));
      col = mix(col, mix(vec3(0.040,0.024,0.070), vec3(0.120,0.075,0.190),
                         pow(smoothstep(-0.4,1.0,q2.y),1.5)), in2 * fadeCo * uIntro);
      float d3 = length(uv - (vec2(1.16,0.82) + uPtr*0.055)) - 0.66;
      col = mix(col, vec3(0.036,0.022,0.062), (1.0 - smoothstep(-0.02,0.08,d3)) * 0.85 * fadeCo * uIntro);
    }
    col += vec3(0.80,0.66,1.00) * flashA
           * (exp(-dot(uv - ORBPT, uv - ORBPT)*70.0)*1.4
            + exp(-dot(uv, uv)*7.0)*0.40);

    /* ============ SCENE B — the dark aurora + glass ============ */
    if(disperse > 0.002 && wAur + colB*(1.0-wC) > 0.002){
      /* the base sinks into the poster's navy-black */
      vec3 base = mix(vec3(0.016,0.013,0.058), vec3(0.005,0.004,0.020),
                      smoothstep(0.2, 1.4, length(uv - vec2(-0.5,-0.5))));
      col = mix(col, base, wAur*0.88);

      /* the orb's light DISPERSES into four glows, each flying
         from the collapse point to its home — then all of them
         DRAIN down into the sinking point */
      vec2 H0 = vec2( 0.55,  0.55);
      vec2 H1 = vec2(-0.15,  0.15);
      vec2 H2 = vec2(-0.45, -0.35);
      vec2 H3 = vec2( 0.62, -0.42);

      float e0 = smoothstep(0.0, 1.0, clamp(disperse*1.45,        0.0, 1.0));
      float e1 = smoothstep(0.0, 1.0, clamp(disperse*1.45 - 0.12, 0.0, 1.0));
      float e2 = smoothstep(0.0, 1.0, clamp(disperse*1.45 - 0.24, 0.0, 1.0));
      float e3 = smoothstep(0.0, 1.0, clamp(disperse*1.45 - 0.36, 0.0, 1.0));

      float s0 = smoothstep(0.0, 1.0, clamp(colB*1.45,        0.0, 1.0));
      float s1 = smoothstep(0.0, 1.0, clamp(colB*1.45 - 0.10, 0.0, 1.0));
      float s2 = smoothstep(0.0, 1.0, clamp(colB*1.45 - 0.20, 0.0, 1.0));
      float s3 = smoothstep(0.0, 1.0, clamp(colB*1.45 - 0.30, 0.0, 1.0));

      vec2 drift0 = 0.030*vec2(sin(t*0.19), cos(t*0.15));
      vec2 drift1 = 0.040*vec2(cos(t*0.13), sin(t*0.17));
      vec2 drift2 = 0.045*vec2(sin(t*0.11+2.0), cos(t*0.14+1.0));
      vec2 drift3 = 0.038*vec2(cos(t*0.16+4.0), sin(t*0.12+3.0));

      vec2 c0 = mix(mix(ORBPT, H0, e0) + drift0, CRATER, s0);
      vec2 c1 = mix(mix(ORBPT, H1, e1) + drift1, CRATER, s1);
      vec2 c2 = mix(mix(ORBPT, H2, e2) + drift2, CRATER, s2);
      vec2 c3 = mix(mix(ORBPT, H3, e3) + drift3, CRATER, s3);

      float shrink2 = 1.0 - 0.55*colB;
      vec3 aur = vec3(0.0);
      aur += vec3(0.300,0.190,0.720) * blobG(uv, c0, 0.42*shrink2) * 0.70 * e0;
      aur += vec3(0.330,0.130,0.600) * blobG(uv, c1, 0.50*shrink2) * 0.65 * e1;
      aur += vec3(0.220,0.100,0.520) * blobG(uv, c2, 0.56*shrink2) * 0.55 * e2;
      aur += vec3(0.050,0.140,0.820) * blobG(uv, c3, 0.46*shrink2) * 0.90 * e3;

      /* the black pockets, alive only while the aurora holds */
      aur *= 1.0 - 0.80*blobG(uv, vec2(-0.40, 0.62) + drift1*1.2, 0.34) * wAur;
      aur *= 1.0 - 0.65*blobG(uv, vec2( 0.30,-0.55) + drift3*1.1, 0.40) * wAur;

      aur = aur / (1.0 + aur*0.28);
      col += aur * (0.35 + 0.65*wAur) * (1.0 - wC);

      /* the poster's living film grain */
      float g = hash(uv*uRes.xy*0.4 + fract(t)*vec2(37.0, 17.0));
      col += (g - 0.5) * 0.055 * wAur;
    }
    col += vec3(0.72,0.62,1.00) * flashC
           * (exp(-dot(uv - CRATER, uv - CRATER)*70.0)*1.4
            + exp(-dot(uv, uv)*7.0)*0.40);

    col *= 1.0 - 0.26*pow(length(uv*vec2(0.58,0.55)), 2.4);
    col += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898,78.233)))*43758.5453)-0.5)/255.0;
    gl_FragColor = vec4(col * uReveal, 1.0);
  }`;

/*
 * Scene C's sheet: 9,216 points on a tilted plane, the wave evaluated per
 * vertex so the dots are sized and lit by the slope they sit on rather than by
 * anything the CPU has to keep up with.
 */
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

    vec3 n = normalize(vec3(-(hx-h)/0.09, -(hy-h)/0.09, 0.42));
    vec3 L = normalize(vec3(-0.42, 0.62, 0.72));
    float lit = pow(max(dot(n, L), 0.0), 1.35);
    float bright = clamp(0.10 + 0.95*lit + 0.28*h, 0.0, 1.6);

    float dark = smoothstep(uHole*2.3, uHole*0.92, r);
    bright *= 1.0 - 0.90*dark;

    float holeFade = smoothstep(uHole*0.55, uHole*1.05, r);

    float wob = 0.55*sin(atan(p.y,p.x)*3.0 + 1.2) + 0.35*sin(atan(p.y,p.x)*5.0 - 0.7);
    float sil = 1.0 - smoothstep(3.35 + wob*0.55, 4.05 + wob*0.55, r);

    float edge = uHole*0.8 + uReveal*6.2;
    float rev = 1.0 - smoothstep(edge - 0.55, edge + 0.15, r);

    float vis = holeFade * sil * rev;
    vB = bright;
    vA = vis;

    vec3 wp = vec3(p, h*0.62);
    vec4 mv = modelViewMatrix * vec4(wp, 1.0);
    gl_PointSize = uSize * (2.2 + 15.5*bright) * vis * (10.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }`;

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
  }`;

const GRID = 96;
const EXTENT = 4.3;

const ss = (a, b, x) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

export function initTeamField() {
  const host = document.querySelector('#team-field');
  if (!host) return;

  const sections = TEAM_SECTIONS.map((s) => document.querySelector(s));
  if (sections.some((s) => !s)) return;

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

  /*
   * #about's glass card is this module's responsibility, not just the backdrop.
   *
   * .systems-panel ships at opacity 0 with a 56px offset and is raised by
   * script — that entrance used to live in the about field, so it has to live
   * here or the card never appears at all. The sketch animates its own glass
   * card the same way, which is where the tilt and the pointer-tracked specular
   * below come from.
   *
   * What is deliberately NOT ported is the sketch's scroll-out: it fades its
   * card away again on the way past, which is fine for an empty prop and wrong
   * for a panel carrying real copy. This one rises once and stays.
   */
  const panel = document.querySelector('#systems-panel');

  let renderer;
  try {
    /*
     * No multisampling, and no stencil. MSAA only antialiases polygon edges,
     * and everything here is a shader quad, glyph planes, points or a sprite —
     * textured or analytic, none with a geometric edge for MSAA to find — so it
     * bought nothing and cost a 4x multisampled colour and depth buffer.
     */
    renderer = new THREE.WebGLRenderer({ antialias: false, stencil: false, alpha: false });
  } catch (error) {
    /*
     * No context, but the card is still real content. It ships at opacity 0
     * expecting to be raised by script, so it has to be raised here too or a
     * machine with no WebGL loses the whole About panel rather than just its
     * backdrop.
     */
    console.error('Team field: no WebGL context', error);
    if (panel) {
      panel.style.opacity = 1;
      panel.style.transform = 'none';
    }
    return;
  }
  renderer.setPixelRatio(pixelRatioFor(1.5, 1.25));
  /* Three passes into one buffer — the later ones must not wipe the earlier. */
  renderer.autoClear = false;
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  host.appendChild(renderer.domElement);

  /* --- the background: all three scenes --------------------------------- */
  const bgScene = new THREE.Scene();
  const bgCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const uni = {
    uRes: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 },
    uPtr: { value: new THREE.Vector2(0, 0) },
    uReveal: { value: 0 },
    uIntro: { value: 0 },
    uP: { value: 0 },
  };

  bgScene.add(
    new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        uniforms: uni,
        vertexShader: 'void main(){ gl_Position = vec4(position,1.0); }',
        fragmentShader: TEAM_FRAGMENT_SHADER,
      })
    )
  );

  /* --- scene C's halftone sheet ----------------------------------------- */
  const dotScene = new THREE.Scene();
  const dotCam = new THREE.PerspectiveCamera(45, 1, 0.1, 60);
  dotCam.position.set(0, 0, 8.6);

  const sheetGroup = new THREE.Group();
  sheetGroup.rotation.x = -0.92; /* the tilted-fabric perspective */
  sheetGroup.rotation.z = 0.22;
  dotScene.add(sheetGroup);

  const dotUni = {
    uTime: { value: 0 },
    uReveal: { value: 0 },
    uGlobal: { value: 0 },
    uHole: { value: 1.3 },
    uSize: { value: 1 },
  };

  {
    const pos = new Float32Array(GRID * GRID * 3);
    for (let i = 0, k = 0; i < GRID; i += 1) {
      for (let j = 0; j < GRID; j += 1, k += 1) {
        pos[k * 3] = (i / (GRID - 1) - 0.5) * EXTENT * 2;
        pos[k * 3 + 1] = (j / (GRID - 1) - 0.5) * EXTENT * 2;
        pos[k * 3 + 2] = 0;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));

    sheetGroup.add(
      new THREE.Points(
        geo,
        new THREE.ShaderMaterial({
          uniforms: dotUni,
          transparent: true,
          depthWrite: false,
          vertexShader: SHEET_VERTEX_SHADER,
          fragmentShader: SHEET_FRAGMENT_SHADER,
        })
      )
    );
  }

  /* The violet ambience pooling under the crater, so the sheet's dark middle
     is a hollow with light in it rather than a hole cut out of the frame. */
  const haze = (() => {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 4, 64, 64, 64);
    gr.addColorStop(0, 'rgba(110,50,210,0.20)');
    gr.addColorStop(1, 'rgba(30,8,80,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.NoColorSpace;
    const s = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    s.position.set(0, 0, -1.2);
    s.scale.setScalar(9);
    dotScene.add(s);
    return s;
  })();

  /* --- the two headings -------------------------------------------------- */
  /*
   * Two, not three. The middle beat is the aurora behind a glass card and is
   * wordless by design; #about's heading lives on the panel itself.
   */
  const txScene = new THREE.Scene();
  const txCam = new THREE.PerspectiveCamera(40, 1, 0.1, 50);
  txCam.position.z = 6;

  const gA = new THREE.Group();
  const gC = new THREE.Group();
  txScene.add(gA, gC);
  const lA = [];
  const lC = [];

  /* The site's shared glyph helper, so these rows are the same canvas-texture
     planes every other lettered field uses. */
  function add(group, list, ch, color, glow, size, x, y, z, base, additive) {
    const m = makeLetter(group, ch, color, glow, size, x, y, z, additive);
    m.userData.base = base;
    m.userData.intro = 1;
    list.push(m);
    return m;
  }

  function row(group, list, word, y, size, gap) {
    const width = (word.length - 1) * gap;
    [...word].forEach((ch, i) => {
      if (ch === ' ') return;
      add(group, list, ch, 'rgba(242,238,248,0.95)', null, size,
          -width / 2 + i * gap, y, Math.sin(list.length * 1.7) * 0.05, 0.95, false);
    });
  }

  row(gA, lA, 'THE TEAM', -0.12, 0.44, 0.46);
  add(gA, lA, 'T', '#7a4bff', 'rgba(122,75,255,0.9)', 0.5, -2.15, -0.85, -0.4, 0.5, true);
  add(gA, lA, 'M', '#4653f0', 'rgba(70,83,240,0.9)', 0.46, 2.3, 0.55, -0.5, 0.5, true);

  row(gC, lC, 'DELIVER TRACKS', 0, 0.235, 0.245);
  add(gC, lC, 'D', '#a35bff', 'rgba(163,91,255,0.9)', 0.34, -2.6, 1.55, -0.4, 0.5, true);
  add(gC, lC, 'T', '#4653f0', 'rgba(70,83,240,0.9)', 0.32, 2.65, -1.6, -0.5, 0.5, true);

  /* Half-widths of each group's row, for the fit cap below. One gap wider than
     the row actually measures, which is the margin the glows need. */
  const HALF_A = (8 * 0.46) / 2 + 0.44 / 2;
  const HALF_C = (14 * 0.245) / 2 + 0.235 / 2;

  function resize() {
    const w = host.clientWidth;
    const h = host.clientHeight;
    if (!w || !h) return;

    renderer.setSize(w, h, false);
    uni.uRes.value.set(w * renderer.getPixelRatio(), h * renderer.getPixelRatio());
    dotUni.uSize.value = renderer.getPixelRatio();

    const a = w / h;

    txCam.aspect = a;
    txCam.updateProjectionMatrix();

    /*
     * The sketch's own term first, then the frame as a hard cap.
     *
     * The sketch scales the text scene by aspect, which is right on a landscape
     * box and spills on a portrait one. fitScale returns the scale at which a
     * row exactly spans the frame less a margin, so the smaller of the two keeps
     * the sketch's proportions wherever they fit and only pulls narrow cases in.
     */
    const sketch = Math.max(0.52, Math.min(1, a / 1.3));
    txScene.scale.setScalar(Math.min(sketch, fitScale(txCam, a, HALF_A), fitScale(txCam, a, HALF_C)));

    /*
     * DELIVER TRACKS sits on the crater's axis on a landscape box, where the two
     * contact cards stand either side of it and the middle of the frame is clear.
     * Below square the pair stacks full width and fills the screen, so the row
     * would print straight through the copy; the stylesheet opens a band above
     * the cards at that width and this lifts the row into it.
     */
    const halfFrameH = Math.tan(((txCam.fov / 2) * Math.PI) / 180) * txCam.position.z;
    gC.position.y = a < 1 ? halfFrameH * 0.62 : 0;

    dotCam.aspect = a;
    dotCam.updateProjectionMatrix();
    /* Pull back on a portrait box, or the sheet's silhouette is wider than the
       frustum and the wave arrives cropped to a band. */
    dotCam.position.z = a < 1 ? 8.6 * (1 + (1 - a) * 0.35) : 8.6;
  }
  resize();
  new ResizeObserver(resize).observe(host);

  /* --- the playhead ------------------------------------------------------ */

  /*
   * p, from the sections themselves rather than from scrollY / viewport.
   *
   * The sketch reads progress as scrollY / innerHeight because its track is
   * three screens of nothing. Here the three sections are real content of
   * unequal height, so a fixed divisor would drift the story out of step with
   * the section it is telling. Measuring the boundaries pins p to 0, 1 and 2 at
   * the three tops however tall they happen to be.
   */
  function teamProgress() {
    const tops = sections.map((s) => s.getBoundingClientRect().top);
    if (tops[0] > 0) return 0;
    for (let i = 0; i < tops.length - 1; i += 1) {
      if (tops[i + 1] > 0) {
        const span = tops[i + 1] - tops[i];
        return span > 0 ? i + (0 - tops[i]) / span : i;
      }
    }
    return tops.length - 1;
  }

  /*
   * Confine the fixed canvas to the three sections' real extent, and say whether
   * any of it is on screen at all.
   *
   * A clip rather than a fade: the canvas is viewport-sized and fixed, so on the
   * way in and out it hangs over the tail of #disciplines and the head of #faq,
   * and fading it there would wash those sections in a violet haze for a third
   * of a screen instead of leaving them alone.
   *
   * One rect pair per frame, and the same read decides whether to draw at all.
   */
  let shown = false;
  let lastClip = null;
  function clipToField() {
    const vh = window.innerHeight || 1;
    const top = sections[0].getBoundingClientRect().top;
    const bottom = sections[sections.length - 1].getBoundingClientRect().bottom;
    const visible = bottom > 0 && top < vh;

    if (visible !== shown) {
      shown = visible;
      host.style.visibility = visible ? 'visible' : 'hidden';
    }
    if (!visible) return false;

    const t = Math.max(0, Math.round(top));
    const b = Math.max(0, Math.round(vh - bottom));
    /* Only on change. Rounded to whole pixels above, so a page that is not
       moving settles on one string instead of writing a style every frame. */
    const clip = t || b ? `inset(${t}px 0px ${b}px 0px)` : 'none';
    if (clip !== lastClip) {
      lastClip = clip;
      host.style.clipPath = clip;
    }
    return true;
  }

  const target = { x: 0, y: 0 };
  window.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    target.x = (e.clientX / window.innerWidth - 0.5) * 2;
    target.y = -(e.clientY / window.innerHeight - 0.5) * 2;

    /*
     * The specular pool inside the glass, in the panel's own coordinates.
     *
     * Clamped, because this listener is on window rather than on the panel's
     * own section. The field it replaced bound to a host inside #about, so the
     * cursor was always within a box a little larger than the panel and the
     * percentages stayed near range. From window they are written wherever the
     * reader's pointer is, including two screens above — which resolved to
     * --my: -1762% and put the highlight nowhere. A little overshoot either
     * side is worth keeping: it is what makes the light read as coming from
     * the side the cursor is on.
     */
    if (panel) {
      const pr = panel.getBoundingClientRect();
      if (pr.width && pr.height) {
        const px = Math.min(140, Math.max(-40, ((e.clientX - pr.left) / pr.width) * 100));
        const py = Math.min(140, Math.max(-40, ((e.clientY - pr.top) / pr.height) * 100));
        panel.style.setProperty('--mx', `${px.toFixed(1)}%`);
        panel.style.setProperty('--my', `${py.toFixed(1)}%`);
      }
    }
  }, { passive: true });

  /*
   * Half rate, like every other field on this page.
   *
   * Dropping this was a real regression. The loops in main.js and
   * horizon-field.js all cap at 30fps, and the comment there says why: these
   * are ambient drifts redrawn as a full-viewport fragment shader, so on a
   * 120Hz panel an uncapped loop is four times the shading the artwork needs,
   * and it "is what had the fans running". Running on gsap.ticker instead of a
   * private rAF made it easy to forget, and these two fields now cover six
   * sections between them - one with a 9,216-point pass on top of its quad.
   *
   * 30 divides evenly into both 60 and 120, so the cadence stays regular rather
   * than juddering. The hero stays deliberately uncapped: it carries the
   * scroll-scrubbed motion, where a dropped frame reads as a stutter.
   */
  const FRAME_INTERVAL_MS = 1000 / 30;
  let lastFrameAt = 0;

  const clock = new THREE.Clock();
  let smoothP = teamProgress();
  let entranceRun = false;
  let liveClassSet = false;
  let panelRun = false;
  let panelEntered = false;

  /*
   * The card rises as its own section arrives, not when the field mounts.
   *
   * The host sits before #makers, so the field builds a screen and a half
   * before #about is looked at; running the card's entrance then would spend it
   * off screen and leave the panel simply present when the reader got there.
   * 0.72 is inside the orbs' dissolve, so the card is settled by the time the
   * aurora it sits on has formed.
   */
  function panelEntrance() {
    if (panelRun || !panel) return;
    panelRun = true;
    if (reduced.matches) {
      panel.style.opacity = 1;
      panel.style.transform = 'none';
      return;
    }
    gsap.fromTo(panel,
      { opacity: 0, y: 56, scale: 0.97 },
      {
        opacity: 1,
        y: 0,
        scale: 1,
        duration: 1.1,
        ease: 'power3.out',
        /*
         * Only then may the loop write transform.
         *
         * The tilt sets panel.style.transform every frame and this tween writes
         * the same property; without the latch the loop overwrites it and the
         * card never rises.
         */
        onComplete() { panelEntered = true; },
      });
  }

  function entrance() {
    if (entranceRun) return;
    entranceRun = true;
    if (reduced.matches) {
      uni.uReveal.value = 1;
      uni.uIntro.value = 1;
      return;
    }
    lA.forEach((m) => { m.userData.intro = 0; });
    const tl = gsap.timeline({ defaults: { ease: 'power2.inOut' } });
    tl.to(uni.uReveal, { value: 1, duration: 1.2 }, 0)
      .to(uni.uIntro, { value: 1, duration: 1.8, ease: 'power2.out' }, 0.3);
    lA.forEach((m, i) => {
      const o = { v: 0 };
      tl.to(o, {
        v: 1, duration: 0.8, ease: 'power2.out',
        onUpdate() { m.userData.intro = o.v; },
      }, 1.3 + i * 0.05);
    });
  }

  /*
   * `visible`, not just opacity.
   *
   * three draws a transparent mesh whatever its alpha, so an opacity of 0 still
   * costs a full draw call per glyph. Every heading is built up front and only
   * one of them is on screen at a time, which measured at about 52 draw calls a
   * frame with two thirds of them painting nothing. Turning the off-screen rows
   * off leaves only the row being read, and skips its per-glyph position maths
   * with it.
   */
  function drive(list, o) {
    const t = uni.uTime.value;
    list.forEach((m, i) => {
      const opacity = m.userData.base * o * m.userData.intro;
      m.material.opacity = opacity;
      m.visible = opacity > 0.001;
      if (!m.visible) return;
      const bob = reduced.matches ? 0 : Math.sin(t * 0.5 + i * 0.5) * 0.008;
      m.position.y = m.userData.baseY + bob - (1 - o) * 0.16;
    });
  }

  const ptr = { x: 0, y: 0 };

  function frame() {
    /* The clip is not throttled: two rect reads and, on change, one style
       write. It has to track the scroll every frame, or the canvas overhangs
       its sections between draws. */
    if (!clipToField()) return;

    const now = performance.now();
    if (now - lastFrameAt < FRAME_INTERVAL_MS) return;
    lastFrameAt = now;

    entrance();

    const t = reduced.matches ? 0 : clock.getElapsedTime();
    uni.uTime.value = t;

    const raw = teamProgress();
    /*
     * 0.16, not the sketch's 0.075.
     *
     * section-scroll.js moves the page a whole section per gesture, so p arrives
     * as a ramp rather than as the continuous drip a free scroll gives. At 0.075
     * the scene was still catching up well after the page had stopped, which
     * reads as the background lagging the content it belongs to. 0.16 settles in
     * about 100ms, so it stays under the step itself at any step duration.
     */
    smoothP += (raw - smoothP) * (reduced.matches ? 1 : 0.16);
    uni.uP.value = smoothP;

    if (smoothP > 0.72) panelEntrance();

    ptr.x += (target.x - ptr.x) * 0.045;
    ptr.y += (target.y - ptr.y) * 0.045;
    uni.uPtr.value.set(ptr.x, ptr.y);

    /* #about carries perspective: 1500px, which is what makes these read as a
       tilt rather than a squash. */
    if (panelEntered && !reduced.matches) {
      panel.style.transform =
        `rotateY(${(ptr.x * 4).toFixed(2)}deg) rotateX(${(ptr.y * 3).toFixed(2)}deg)`;
    }

    txCam.position.x = ptr.x * 0.24;
    txCam.position.y = ptr.y * 0.16;
    txCam.lookAt(0, 0, 0);

    /* The sheet only exists for the story's third act. */
    const wC = ss(1.38, 1.86, smoothP);
    dotUni.uTime.value = t;
    dotUni.uGlobal.value = wC;
    dotUni.uReveal.value = wC;
    haze.material.opacity = wC;
    sheetGroup.rotation.x = -0.92 - ptr.y * 0.1;
    sheetGroup.rotation.z = 0.22 + ptr.x * 0.1 + (reduced.matches ? 0 : Math.sin(t * 0.1) * 0.04);
    dotCam.position.x = ptr.x * 0.28;
    dotCam.position.y = ptr.y * 0.2;
    dotCam.lookAt(0, 0, 0);

    drive(lA, 1 - ss(0.08, 0.38, smoothP));
    drive(lC, ss(1.8, 1.98, smoothP));

    renderer.clear();
    renderer.render(bgScene, bgCam);
    if (wC > 0.003) {
      renderer.clearDepth();
      renderer.render(dotScene, dotCam);
    }
    renderer.clearDepth();
    renderer.render(txScene, txCam);

    /*
     * Take the backdrop off the three sections, now that there is demonstrably
     * something behind them.
     *
     * All three paint an opaque black gradient by default, and since they sit at
     * z-index 3 — above this canvas, and each its own stacking context — that
     * black would cover the scene entirely. This canvas is alpha:false and its
     * quad fills the frame, so it is opaque across exactly the band clipToField()
     * just measured and can stand in for those gradients.
     *
     * After the first render rather than at init, so the fallback survives
     * everything that can go wrong before a pixel exists: no WebGL context, a
     * shader that will not compile, a module that never mounts.
     */
    if (!liveClassSet) {
      liveClassSet = true;
      document.documentElement.classList.add('team-field-live');
    }
  }

  gsap.ticker.add(frame);
}
