import * as THREE from 'three';
import gsap from 'gsap';

import { pixelRatioFor } from './render-quality.js';
import { makeLetter, fitScale } from './webgl-letters.js';

/* =========================================================================
 * The story field — one scene for three sections
 *
 * #concepts, #about-us and #services used to carry three separate WebGL
 * fields: a halo of orbiting rings, a silk wave, and a warp of comets. Each
 * built its own context, its own lettering and its own entrance, and each
 * ended at its section's edge — three unrelated pictures with hard seams
 * between them.
 *
 * This is the three of them rewritten as ONE continuous shot. The ring
 * collapses to a point, the point falls into the bowl, the splash ignites the
 * wave, the wave's ridge drains back to a point, and that point opens into the
 * vortex the comets pour out of. Nothing is cut; the scroll is the playhead.
 *
 * WHY ONE FIXED CANVAS RATHER THAN THREE HOSTS
 *
 * A morph between two scenes cannot be drawn by two elements that stop at a
 * section boundary — the moment of change lands exactly on the seam, which is
 * the one place neither host can paint. A single viewport-sized canvas behind
 * all three sections has no seam to land on. It also costs one WebGL context
 * where the old arrangement cost three, on a page that holds ten.
 *
 * Fixed, and not position: sticky. Sticky would confine the canvas to these
 * three sections declaratively, with no JS at all — but body carries
 * overflow-x: hidden, which is a well-known way to silently break sticky
 * depending on how the browser propagates overflow to the viewport. The
 * visibility here is one rect read per frame off a value this module already
 * computes, so the certain thing was cheaper than the elegant one.
 * ====================================================================== */

/* The three sections the story is told across, in order. p reaches 0, 1 and 2
   as each one's top reaches the top of the viewport. */
const STORY_SECTIONS = ['#concepts', '#about-us', '#services'];

const STORY_FRAGMENT_SHADER = `
  precision highp float;
  uniform vec2  uRes, uPtr;
  uniform float uTime, uWarpT, uReveal, uRev, uP;

  const float TAU = 6.28318530718;
  const vec2  BOWL   = vec2(0.62, -0.44);   /* where the light lands  */
  const vec2  VORTEX = vec2(0.05,  0.16);   /* where it drains to     */

  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
  float hash1(float n){ return fract(sin(n*127.1)*43758.5453); }
  float noise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    f = f*f*(3.0-2.0*f);
    return mix(mix(hash(i), hash(i+vec2(1,0)), f.x),
               mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
  }
  float fbm(vec2 p){
    float v = 0.0, a = 0.5;
    for(int k=0;k<3;k++){ v += a*noise(p); p *= 2.05; a *= 0.5; }
    return v;
  }
  float hot(float th, float a, float w){
    float d = abs(atan(sin(th - a), cos(th - a)));
    return exp(-pow(d/w, 2.0));
  }
  float angDiff(float a, float b){ return atan(sin(a-b), cos(a-b)); }
  float tanhA(float x){
    x = clamp(x, -6.0, 6.0);
    float e = exp(2.0*x);
    return (e - 1.0)/(e + 1.0);
  }

  /* the silk ridge from the ABOUT US wave */
  float W(float x, float t){
    float w = -0.04 - 0.50*tanhA((x + 0.10)*1.35);
    w += 0.26*pow(smoothstep(0.45, 1.7, x), 2.0);
    w += 0.030*sin(x*1.5 + t*0.26) + 0.018*sin(x*2.7 - t*0.19);
    return w;
  }

  /* one warp comet from AI AND AUTOMATION */
  vec3 comet(vec2 p, float thPix, float rPix, float k, float t,
             float widthMul, float ampMul, float tailMul, float haloAmp, float pxUV){
    float a0    = hash1(k*1.7) * TAU;
    float speed = 0.050 + 0.075*hash1(k*2.3);
    float bend  = (hash1(k*3.1) - 0.5) * 0.9;
    float tail  = (0.20 + 0.22*hash1(k*4.7)) * tailMul;
    float prog  = fract(hash1(k*5.3) + t*speed);

    float c = hash1(k*6.9);
    vec3 tint = c < 0.28 ? vec3(0.25,0.45,1.00)
              : c < 0.52 ? vec3(0.55,0.35,1.00)
              : c < 0.74 ? vec3(0.72,0.42,1.00)
              : c < 0.90 ? vec3(1.00,0.56,0.70)
                         : vec3(0.92,0.90,1.00);

    vec3 acc = vec3(0.0);
    float lifeFade = 1.0 - smoothstep(0.80, 0.99, prog);

    float s = pow(clamp(rPix/1.55, 0.0, 1.0), 1.0/1.35);
    if(s <= prog && s >= prog - tail){
      float along = (s - (prog - tail)) / tail;
      float aHere = a0 + bend * s;
      float lat   = abs(angDiff(thPix, aHere)) * max(rPix, 0.05);
      float wCore = max(0.0042*widthMul, pxUV*1.6);
      float core  = exp(-pow(lat/wCore, 2.0));
      float glowW = exp(-pow(lat/(wCore*3.4), 2.0)) * 0.30;
      float body  = pow(along, 2.3);
      float head  = exp(-pow((s - prog)/0.030, 2.0)) * 1.6;
      vec3 tt2 = mix(tint, vec3(1.0,0.98,1.0), pow(along, 5.0)*0.55);
      acc += tt2 * (body + head) * (core + glowW)
             * smoothstep(0.028, 0.095, s) * lifeFade * ampMul;
    }
    if(haloAmp > 0.001){
      float rHead = 1.55 * pow(prog, 1.35);
      float aHead = a0 + bend * prog;
      vec2  hp = rHead * vec2(cos(aHead), sin(aHead));
      float hd = dot(p - hp, p - hp);
      acc += mix(tint, vec3(1.0), 0.45)
             * (exp(-hd*900.0)*1.1 + exp(-hd*160.0)*0.30)
             * haloAmp * smoothstep(0.06, 0.16, prog) * lifeFade;
    }
    return acc;
  }

  void main(){
    vec2 uv = (gl_FragCoord.xy - 0.5*uRes)/min(uRes.x,uRes.y)*2.0;
    uv += uPtr * 0.020;
    float t = uTime;
    float p = uP;
    float pxUV = 2.0 / min(uRes.x, uRes.y);

    vec3 col = vec3(0.005, 0.004, 0.010);

    /* ---------------- story weights ---------------- */
    float wA     = 1.0 - smoothstep(0.10, 0.50, p);
    float flashA = exp(-pow((p - 0.50)/0.055, 2.0));
    float tFall  = clamp((p - 0.48)/0.38, 0.0, 1.0);
    float wFall  = smoothstep(0.44, 0.54, p) * (1.0 - smoothstep(0.84, 0.95, p));
    float growB  = smoothstep(0.62, 1.00, p);
    float colB   = smoothstep(1.02, 1.34, p);
    float wB     = growB * (1.0 - smoothstep(1.10, 1.42, p));
    float flashB = exp(-pow((p - 1.34)/0.055, 2.0));
    float wC     = smoothstep(1.36, 1.80, p);

    /* ============ SCENE A — the neon ring ============ */
    if(wA > 0.002){
      float shrink = 0.06 + 0.94*wA;
      float spin   = 1.0 + 8.0*(1.0 - wA);

      vec2  C0[3]; float R0[3]; vec3 T0[3]; float ROT[3]; float A0[3];
      C0[0]=vec2( 0.000, 0.015); R0[0]=0.620; T0[0]=vec3(0.62,0.32,1.00); ROT[0]= 0.12; A0[0]=2.20;
      C0[1]=vec2( 0.014,-0.010); R0[1]=0.598; T0[1]=vec3(0.30,0.42,1.00); ROT[1]=-0.09; A0[1]=5.30;
      C0[2]=vec2(-0.012, 0.012); R0[2]=0.648; T0[2]=vec3(0.55,0.28,0.95); ROT[2]= 0.06; A0[2]=0.60;

      for(int i=0;i<3;i++){
        vec2 c = C0[i]*shrink;
        float r = R0[i]*shrink*(1.0 + 0.008*sin(t*0.5));
        vec2 q = uv - c;
        float e = abs(length(q) - r);
        float th = atan(q.y, q.x);
        float norm = fract((th - A0[i]) / TAU);
        float m = smoothstep(norm - 0.015, norm, uRev);
        float a1 = A0[i] + 0.55 + t*ROT[i]*spin;
        float a2 = A0[i] + 3.60 + t*ROT[i]*1.35*spin;
        float heat = 0.30 + 1.55*hot(th, a1, 0.55) + 1.05*hot(th, a2, 0.42);
        float core = exp(-pow(e*170.0, 2.0));
        float mid  = exp(-pow(e* 46.0, 2.0));
        float halo = exp(-e*8.5);
        col += (T0[i]*mid*heat*0.85 + vec3(1.0,0.96,1.0)*core*heat*1.25
              + T0[i]*halo*(0.22+0.30*heat)*0.32) * m * wA;
      }
    }
    col += vec3(0.86,0.72,1.00) * flashA
           * (exp(-dot(uv - vec2(0.0,0.015), uv - vec2(0.0,0.015))*70.0)*1.5
            + exp(-dot(uv, uv)*8.0)*0.45);

    /* ============ the DOWNFALL into the bowl ============ */
    if(wFall > 0.002){
      vec2 bpPos = vec2(mix(0.0, BOWL.x, pow(tFall, 1.25)),
                        mix(0.015, BOWL.y, tFall) - 0.24*sin(3.14159*tFall));
      vec2 bp = uv - bpPos;
      float bd = dot(bp, bp);
      /* the streak trails back up-left along its arc */
      float streak = exp(-pow((bp.x + bp.y*0.5 + 0.10)*7.0, 2.0))
                   * exp(-pow((bp.y - 0.10)*4.5, 2.0));
      col += vec3(0.80,0.66,1.00) * (exp(-bd*170.0)*1.45 + exp(-bd*36.0)*0.50) * wFall;
      col += vec3(0.50,0.35,0.95) * streak * 0.30 * wFall * tFall;
    }

    /* ============ SCENE B — the silk wave (ABOUT US) ============ */
    if(growB > 0.002 && wB + colB > 0.002){
      float x = uv.x;
      float d = uv.y - W(x, t);

      /* everything grows outward from the SPLASH in the bowl */
      float reach = growB * 3.6;
      float fieldM = 1.0 - smoothstep(reach - 0.55, reach, length(uv - BOWL));

      /* ...and drains toward the vortex as the scene collapses */
      float drainR = (1.0 - colB) * 3.4;
      float drainM = 1.0 - smoothstep(drainR - 0.40, drainR, length(uv - VORTEX));
      float vis = fieldM * drainM;

      float aa = smoothstep(-0.004, 0.004, d);
      vec3 colAbove = mix(vec3(0.052,0.046,0.170), vec3(0.008,0.008,0.032),
                          smoothstep(-0.15, 1.25, d + x*0.28));
      vec3 colBelow = mix(vec3(0.300,0.165,0.880), vec3(0.085,0.050,0.340),
                          smoothstep(0.00, 1.45, -d - x*0.22));
      vec3 silk = mix(colBelow, colAbove, aa);
      col = mix(col, silk, vis * 0.96);

      /* the crest: hottest at the bend, glowing over the bowl,
         surging as it drains */
      float crest = exp(-pow(d*26.0, 2.0)) + 0.45*exp(-pow(d*9.0, 2.0));
      float along = 0.16
        + 1.05*exp(-pow((x + 0.10)/0.42, 2.0))
        + 0.70*exp(-pow((x - 0.70)/0.48, 2.0));
      along += 0.35*exp(-pow((x - (-1.6 + fract(t*0.055)*3.4))/0.30, 2.0));
      vec3 crestCol = mix(vec3(0.60,0.44,1.00), vec3(0.97,0.93,1.00),
                          clamp(along*0.7, 0.0, 1.0));
      col += crestCol * crest * along * vis * (1.0 + 1.4*colB);

      /* the pool — the landed light itself */
      float pool = exp(-pow(length((uv - BOWL)*vec2(1.0,1.45)), 2.0)*2.2);
      col += vec3(0.55,0.43,1.00) * pool * 0.50 * growB * (1.0 - colB) * (1.0 - aa*0.55);
    }
    col += vec3(0.90,0.82,1.00) * flashB
           * (exp(-dot(uv - VORTEX, uv - VORTEX)*70.0)*1.5
            + exp(-dot(uv, uv)*8.0)*0.45);

    /* ============ SCENE C — the warp burst (AI) ============ */
    if(wC > 0.002){
      vec2 pw = uv - VORTEX;
      float rPix  = length(pw);
      float thPix = atan(pw.y, pw.x);
      float tW = uWarpT;

      vec3 burst = vec3(0.0);
      for(int i=0;i<22;i++){
        burst += comet(pw, thPix, rPix, float(i)+1.0, tW, 1.0, 0.85, 1.0, 0.0, pxUV);
      }
      for(int i=0;i<6;i++){
        burst += comet(pw, thPix, rPix, float(i)*3.3+201.0, tW*0.62, 0.72, 0.42, 3.6, 0.0, pxUV);
      }
      for(int i=0;i<4;i++){
        float k = float(i)*7.77 + 101.0;
        burst += comet(pw, thPix, rPix, k, tW*0.8, 3.4, 2.0, 1.0, 0.85*wC, pxUV);
      }
      for(int i=0;i<6;i++){
        float k = float(i)+61.0;
        float a = hash1(k*1.3)*TAU;
        float rr = 0.15 + fract(hash1(k*2.9) + tW*0.018) * 1.1;
        vec2 sp = rr*vec2(cos(a), sin(a));
        float twk = 0.55 + 0.45*sin(t*(1.0+hash1(k)*2.0) + k);
        burst += vec3(0.85,0.72,0.95) * exp(-dot(pw-sp,pw-sp)*9000.0) * twk * 0.55;
      }
      /* the vortex rings — where the wave drained to */
      burst += vec3(0.35,0.30,0.75) * exp(-pow((rPix-0.022)*220.0,2.0)) * 0.35;
      burst += vec3(0.45,0.40,0.95) * exp(-rPix*rPix*160.0) * 0.35;

      col += burst * wC;
    }

    col *= 1.0 - 0.26*pow(length(uv*vec2(0.58,0.55)), 2.4);
    col += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898,78.233)))*43758.5453)-0.5)/255.0;
    gl_FragColor = vec4(col * uReveal, 1.0);
  }`;

const ss = (a, b, x) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

export function initStoryField() {
  const host = document.querySelector('#story-field');
  if (!host) return;

  const sections = STORY_SECTIONS.map((s) => document.querySelector(s));
  if (sections.some((s) => !s)) return;

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(pixelRatioFor(1.5, 1.25));
  renderer.autoClear = false;
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  host.appendChild(renderer.domElement);

  const bgScene = new THREE.Scene();
  const bgCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const uni = {
    uRes: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 },
    uWarpT: { value: 0 },
    uPtr: { value: new THREE.Vector2(0, 0) },
    uReveal: { value: 0 },
    uRev: { value: 0 },
    uP: { value: 0 },
  };

  bgScene.add(
    new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        uniforms: uni,
        vertexShader: 'void main(){ gl_Position = vec4(position,1.0); }',
        fragmentShader: STORY_FRAGMENT_SHADER,
      })
    )
  );

  /* --- the three headings ------------------------------------------------ */
  const txScene = new THREE.Scene();
  const txCam = new THREE.PerspectiveCamera(40, 1, 0.1, 50);
  txCam.position.z = 6;

  const gA = new THREE.Group();
  const gB = new THREE.Group();
  const gC = new THREE.Group();
  txScene.add(gA, gB, gC);
  const lA = [];
  const lB = [];
  const lC = [];

  /* The site's shared glyph helper, so these rows are the same canvas-texture
     planes every other lettered field uses — and so the real headings stay the
     visually-hidden h2s in the markup. */
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

  row(gA, lA, 'ENGINEERING', 0.155, 0.205, 0.215);
  row(gA, lA, 'CAPABILITIES', -0.155, 0.205, 0.215);
  add(gA, lA, 'E', '#8a4bff', 'rgba(138,75,255,0.9)', 0.34, -1.8, 1.35, -0.4, 0.5, true);
  add(gA, lA, 'C', '#4653f0', 'rgba(70,83,240,0.9)', 0.32, 1.95, -1.3, -0.5, 0.5, true);

  row(gB, lB, 'ABOUT US', 0, 0.3, 0.315);
  add(gB, lB, 'A', '#7a4bff', 'rgba(122,75,255,0.9)', 0.36, -1.55, 0.72, -0.4, 0.5, true);
  add(gB, lB, 'U', '#b9a4ff', 'rgba(185,164,255,0.9)', 0.34, 1.55, -0.72, -0.5, 0.5, true);

  row(gC, lC, 'AI AND AUTOMATION', -1.58, 0.235, 0.245);
  add(gC, lC, 'A', '#4a6aff', 'rgba(74,106,255,0.9)', 0.34, -2.55, -1.1, -0.4, 0.5, true);
  add(gC, lC, 'N', '#9a5bff', 'rgba(154,91,255,0.9)', 0.32, 2.6, -2.02, -0.5, 0.5, true);

  /* Half-widths of the longest row in each group, for the fit cap below. */
  const HALF_A = (11 * 0.215) / 2 + 0.205 / 2;
  const HALF_B = (7 * 0.315) / 2 + 0.3 / 2;
  const HALF_C = (16 * 0.245) / 2 + 0.235 / 2;

  function resize() {
    const w = host.clientWidth;
    const h = host.clientHeight;
    if (!w || !h) return;

    renderer.setSize(w, h, false);
    uni.uRes.value.set(w * renderer.getPixelRatio(), h * renderer.getPixelRatio());

    const a = w / h;
    txCam.aspect = a;
    txCam.updateProjectionMatrix();

    /*
     * The sketch's own term first, then the frame as a hard cap.
     *
     * The sketch scales the whole text scene by aspect, which is right on a
     * landscape box and spills on a portrait one — AI AND AUTOMATION is
     * seventeen glyphs and runs off both sides of a phone. fitScale returns the
     * scale at which a row exactly spans the frame less a margin, so taking the
     * smaller of the two keeps the sketch's proportions everywhere it fits and
     * only pulls the narrow cases down.
     */
    const sketch = Math.max(0.52, Math.min(1, a / 1.3));
    txScene.scale.setScalar(Math.min(
      sketch,
      fitScale(txCam, a, HALF_A),
      fitScale(txCam, a, HALF_B),
      fitScale(txCam, a, HALF_C)
    ));

    /* ABOUT US sits off to the side of the wave's dark upper right on a wide
       box, and centres once there is no room to put it anywhere else. */
    gB.position.x = a > 1.15 ? Math.min((a - 0.45) * 0.85, 1.3) : 0;
    gB.position.y = a > 1.15 ? 0.95 : 1.3;
    gB.scale.setScalar(Math.max(0.6, Math.min(0.92, a / 1.7)));
  }
  resize();
  new ResizeObserver(resize).observe(host);

  /* --- the playhead ------------------------------------------------------ */

  /*
   * p, from the sections themselves rather than from scrollY / viewport.
   *
   * The sketch reads its own progress as scrollY / innerHeight because its
   * track is exactly three screens of nothing. Here the three sections are real
   * content of unequal height — #concepts alone runs to about 1.6 screens on a
   * phone — so a fixed divisor would drift the story out of step with the
   * section it is telling. Measuring the boundaries instead pins p to 0, 1 and
   * 2 at the three tops however tall they happen to be, which is what keeps
   * each heading arriving with its own section.
   */
  function storyProgress() {
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
   * Confine the fixed canvas to the story's real extent, and say whether any
   * of it is on screen at all.
   *
   * A clip rather than a fade. The canvas is viewport-sized and fixed, so on
   * the way in and out it hangs over the tail of #projects and the head of
   * #disciplines; fading it there would wash those sections in a dark violet
   * haze for a third of a screen instead of leaving them alone. Clipped to
   * [top, bottom] it simply stops at the section edge, where the neighbouring
   * section's own backdrop takes over — and because the scene's own extremes
   * are near-black under its vignette, that edge does not read as a line.
   *
   * One rect pair per frame, and the same read decides whether to draw at all:
   * an off-screen field costs the measurement and nothing else.
   */
  let shown = false;
  function clipToStory() {
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
    host.style.clipPath = t || b ? `inset(${t}px 0px ${b}px 0px)` : 'none';
    return true;
  }

  const target = { x: 0, y: 0 };
  window.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    target.x = (e.clientX / window.innerWidth - 0.5) * 2;
    target.y = -(e.clientY / window.innerHeight - 0.5) * 2;
  }, { passive: true });

  const clock = new THREE.Clock();
  let smoothP = storyProgress();
  let entranceRun = false;
  let liveClassSet = false;

  function entrance() {
    if (entranceRun) return;
    entranceRun = true;
    if (reduced.matches) {
      uni.uReveal.value = 1;
      uni.uRev.value = 1;
      return;
    }
    lA.forEach((m) => { m.userData.intro = 0; });
    const tl = gsap.timeline({ defaults: { ease: 'power2.inOut' } });
    tl.to(uni.uReveal, { value: 1, duration: 1 }, 0)
      .to(uni.uRev, { value: 1, duration: 1.8 }, 0.3);
    lA.forEach((m, i) => {
      const o = { v: 0 };
      tl.to(o, {
        v: 1, duration: 0.8, ease: 'power2.out',
        onUpdate() { m.userData.intro = o.v; },
      }, 1.5 + i * 0.04);
    });
  }

  function drive(list, o) {
    const t = uni.uTime.value;
    list.forEach((m, i) => {
      const bob = reduced.matches ? 0 : Math.sin(t * 0.5 + i * 0.5) * 0.008;
      m.position.y = m.userData.baseY + bob - (1 - o) * 0.16;
      m.material.opacity = m.userData.base * o * m.userData.intro;
    });
  }

  function frame() {
    const dt = Math.min(clock.getDelta(), 0.05);
    if (!clipToStory()) return;

    entrance();

    const t = reduced.matches ? 0 : clock.getElapsedTime();
    uni.uTime.value = t;

    const raw = storyProgress();
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

    /* The comets only fly once their scene is the one being told. */
    if (reduced.matches) {
      uni.uWarpT.value = 7;
    } else {
      const cruise = ss(1.38, 1.75, smoothP);
      uni.uWarpT.value += dt * cruise * (0.85 + 0.15 * Math.sin(t * 0.4));
    }

    const p = uni.uPtr.value;
    p.x += (target.x - p.x) * 0.045;
    p.y += (target.y - p.y) * 0.045;
    txCam.position.x = p.x * 0.24;
    txCam.position.y = p.y * 0.16;
    txCam.lookAt(0, 0, 0);

    drive(lA, 1 - ss(0.08, 0.38, smoothP));
    drive(lB, ss(0.86, 1.04, smoothP) * (1 - ss(1.06, 1.3, smoothP)));
    drive(lC, ss(1.74, 1.96, smoothP));

    renderer.clear();
    renderer.render(bgScene, bgCam);
    renderer.clearDepth();
    renderer.render(txScene, txCam);

    /*
     * Take the backdrop off #about-us and #services, now that there is
     * demonstrably something behind them.
     *
     * Those two paint an opaque black gradient by default, and since all three
     * story sections sit at z-index 3 — above this canvas, and each its own
     * stacking context — that black covered the scene entirely: they rendered
     * flat black while #concepts, which has no background, showed it. This
     * canvas is alpha:false and its quad fills the frame, so it is opaque
     * across exactly the band clipToStory() just measured and can stand in for
     * that gradient.
     *
     * After the first render rather than at init, so the fallback survives
     * everything that can go wrong before a pixel exists: no WebGL context, a
     * shader that will not compile, a module that never mounts.
     */
    if (!liveClassSet) {
      liveClassSet = true;
      document.documentElement.classList.add('story-field-live');
    }
  }

  gsap.ticker.add(frame);
}
