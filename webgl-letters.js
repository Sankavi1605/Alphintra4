/* =========================================================================
 * WebGL lettering — canvas-texture glyph rows
 *
 * Two sections draw a word as individual glyph planes at their own depths:
 * "THE TEAM" over the Built by Makers orbs, and "OUR FEATURED WORK" over the
 * blades. Both supplied sketches shipped the same two helpers byte for byte,
 * so they live here once rather than twice.
 *
 * The glyphs are decoration. Every section that uses this keeps its real
 * heading in the HTML so screen readers, search and text selection still have
 * something to work with.
 * ====================================================================== */
import * as THREE from 'three';

const TEXTURE_PX = 256;

/**
 * One glyph rendered to a canvas. `glow` is a shadow colour or null.
 *
 * `opts.weight` overrides the font weight, and `opts.plate` stamps a dark,
 * heavily-blurred copy of the glyph underneath it first. The About planet needs
 * both: its word crosses the planet's lit crescent, which peaks near white, and
 * a bare hairline glyph loses its edge against it. The other callers draw over
 * near-black and pass neither.
 */
export function letterTexture(ch, color, glow, opts = {}) {
  const c = document.createElement('canvas');
  c.width = c.height = TEXTURE_PX;
  const g = c.getContext('2d');
  g.clearRect(0, 0, TEXTURE_PX, TEXTURE_PX);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `${opts.weight || 100} 150px "Helvetica Neue", Helvetica, Arial, sans-serif`;

  if (opts.plate) {
    /* Twice, because one pass of a blurred fill is too faint to read as a plate. */
    g.shadowColor = opts.plate;
    g.shadowBlur = 26;
    g.fillStyle = opts.plate;
    g.fillText(ch, TEXTURE_PX / 2, TEXTURE_PX / 2 + 6);
    g.fillText(ch, TEXTURE_PX / 2, TEXTURE_PX / 2 + 6);
    g.shadowBlur = glow ? 14 : 6;
  }

  if (glow) {
    g.shadowColor = glow;
    g.shadowBlur = 14;
  }
  g.fillStyle = color;
  g.fillText(ch, TEXTURE_PX / 2, TEXTURE_PX / 2 + 6);

  const t = new THREE.CanvasTexture(c);
  t.minFilter = THREE.LinearFilter;
  /*
   * r152+ decodes a CanvasTexture as sRGB by default. Both callers put their
   * renderer in linear mode so the shaders' hand-rolled ramps and 1/255 dither
   * survive, and an sRGB decode here would then be undone on the way out —
   * dimming the glyphs. The canvas values are already the numbers we want.
   */
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

/**
 * A glyph plane, parked at `opacity: 0` for the caller's entrance to animate.
 * `baseY` is stashed on userData because the float loops and the entrance both
 * need the settled position to animate around.
 */
export function makeLetter(scene, ch, color, glow, size, x, y, z, additive, opts) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshBasicMaterial({
      map: letterTexture(ch, color, glow, opts),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    })
  );
  m.position.set(x, y, z);
  m.userData.baseY = y;
  scene.add(m);
  return m;
}

/**
 * How far a glyph row has to shrink to fit the frame.
 *
 * Both sketches size their word with `max(FLOOR, min(1, aspect / k))`, and in
 * both the floor is too high to keep its promise: on a portrait box the row
 * ends up wider than the frustum and the outer glyphs are cropped — "THE TEAM"
 * rendered as "HE TEA". This returns the scale at which the row exactly spans
 * the frame, less a margin, so callers can use it as an upper bound:
 *
 *     scene.scale.setScalar(Math.min(1, sketchTerm, fitScale(...)))
 *
 * Landscape boxes resolve to the sketch's own term untouched; only narrow
 * portrait ones are pulled down far enough to show the whole word.
 */
export function fitScale(camera, aspect, wordHalfAtScaleOne, margin = 0.92) {
  const halfHeight = Math.tan(((camera.fov / 2) * Math.PI) / 180) * camera.position.z;
  return ((halfHeight * aspect) / wordHalfAtScaleOne) * margin;
}
