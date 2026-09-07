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
/*
 * One texture per distinct glyph, shared by every plane that draws it.
 *
 * Each is a 256x256 RGBA canvas — 256KB — and the page letters well over a
 * hundred planes across its fields, most of them repeats: "ENGINEERING
 * CAPABILITIES" alone asks for E four times and I four times. Keyed on
 * everything that changes the pixels, so two callers share a texture only when
 * the images would have been identical anyway.
 *
 * Nothing disposes these on purpose. They are shared, so no one field owns a
 * texture it would be safe to free, and the whole set is smaller than a single
 * field's drawing buffer.
 */
const textureCache = new Map();

export function letterTexture(ch, color, glow, opts = {}) {
  /*
   * NUL as the key separator, and written as an escape.
   *
   * The parts joined below are one glyph and three colour strings, and a colour
   * may well contain the obvious separators: rgba(255, 255, 255, .8) has both
   * spaces and commas in it, and `ch` is whatever character the caller wants
   * lettered, which could be either of those. NUL cannot occur in any of them,
   * so it is the one separator that can never collide two distinct glyphs onto
   * a shared texture.
   *
   * The escape, rather than the byte, is the part worth remembering. Git decides
   * a file is binary by looking for a NUL in its first 8000 bytes, and this file
   * is 6KB — so a literal one here made the whole module binary: no diff, no
   * blame, no merge. It also excluded the file from git's line-ending
   * normalisation, which is why this was the only source file in the repo stored
   * with CRLF. The escape is the same character at runtime and none of that.
   */
  const key = [ch, color, glow, opts.weight, opts.plate].join('\u0000');
  const cached = textureCache.get(key);
  if (cached) return cached;
  const made = drawLetterTexture(ch, color, glow, opts);
  textureCache.set(key, made);
  return made;
}

function drawLetterTexture(ch, color, glow, opts) {
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
   * No mip chain. minFilter is already LinearFilter, so nothing ever samples
   * one — but three builds and uploads the whole chain regardless, which is a
   * third again on top of every glyph's 256KB. The page draws well over a
   * hundred of these across its fields.
   */
  t.generateMipmaps = false;
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
export function fitScale(camera, aspect, wordHalfAtScaleOne, margin = fitMargin(aspect)) {
  const halfHeight = Math.tan(((camera.fov / 2) * Math.PI) / 180) * camera.position.z;
  return ((halfHeight * aspect) / wordHalfAtScaleOne) * margin;
}

/**
 * Lay a lettered row out over one or more lines, and report its half-width.
 *
 * A row's size on a narrow frame is decided entirely by its length. Seventeen
 * glyphs on a 375px phone can only be drawn 16 CSS pixels tall before the row
 * runs off both sides — smaller than the body copy in front of it, which is why
 * the longer words could not be read there. Broken over two lines the longest
 * line is ten glyphs, and the same frame allows 28.
 *
 * "ENGINEERING CAPABILITIES" was authored as two rows for exactly this reason
 * from the start. This lets a field make that same choice in `resize`, where it
 * knows the shape of the frame, rather than at build time where it does not.
 *
 * `meshes` are the row's glyphs in reading order. A field pushes its accent
 * letters after them and keeps those in a list of their own, so they are not
 * reached from here. Spaces have no plane, matching the layout each field's own
 * `row` helper writes.
 */
export function flowRow(meshes, lines, size, gap) {
  /* 1.5em. ENGINEERING and CAPABILITIES were authored 0.31 apart at 0.205 tall,
     so a row that wraps here is led like the one that always wrapped. */
  const leading = size * 1.5;
  const top = ((lines.length - 1) / 2) * leading;
  let half = 0;
  let n = 0;
  lines.forEach((line, li) => {
    const width = (line.length - 1) * gap;
    half = Math.max(half, width / 2 + size / 2);
    [...line].forEach((ch, i) => {
      if (ch === ' ') return;
      const m = meshes[n];
      n += 1;
      if (!m) return;
      m.position.x = -width / 2 + i * gap;
      m.userData.baseY = top - li * leading;
      m.position.y = m.userData.baseY;
    });
  });
  return half;
}

/**
 * Pull a group's free-floating accent glyphs back inside the frame.
 *
 * The accents are the single oversized coloured letters each field scatters
 * behind its row, authored at fixed group-local coordinates chosen to sit just
 * inside the frame at the scale the group used to be drawn at. Once a group is
 * sized by its own row it can be drawn much larger — story's ENGINEERING went
 * from 0.38 to 0.61 on a phone — and at that scale its accents are outside the
 * frustum altogether, so the composition simply loses them.
 *
 * They are decoration with no fixed relationship to the row, so the answer is
 * to read their coordinates as a shape rather than as positions, and shrink that
 * shape by whatever it takes to bring the outermost one in. Nothing is ever
 * pushed outwards, so a group with room to spare is left exactly as authored —
 * which is every landscape box, and is why wide layouts do not move at all.
 *
 * Requires `userData.ax` / `ay`: the authored position, since `position` is what
 * this overwrites.
 */
export function holdInside(meshes, scale, halfFrameW, margin = 0.92) {
  let widest = 0;
  meshes.forEach((m) => {
    widest = Math.max(widest, Math.abs(m.userData.ax));
  });
  if (!widest || !scale) return;
  const pull = Math.min(1, (halfFrameW * margin) / scale / widest);
  meshes.forEach((m) => {
    m.position.x = m.userData.ax * pull;
    m.userData.baseY = m.userData.ay * pull;
    m.position.y = m.userData.baseY;
  });
}

/**
 * How much of the frame's width a glyph row may span, by box shape.
 *
 * 0.92 leaves 4% of air either side, which is plenty on a wide box. On a phone
 * it is not: the row is measured from the glyph *planes*, and every caller
 * draws with a blurred plate or an additive glow that bleeds well past the
 * plane's own edge, so at 92% the outer letters run into the frame and
 * "DELIVER TRACKS" arrives with its D and S shaved off. A portrait box has far
 * less width to give away, so it keeps more of it.
 */
export function fitMargin(aspect) {
  return aspect < 1 ? 0.78 : 0.92;
}
