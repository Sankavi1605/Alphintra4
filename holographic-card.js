/* =========================================================================
 * Holographic card — a cursor-tracked tilt, sheen and glow
 *
 * A port of the supplied React component onto the testimonial card in the
 * hero's reveal. Same three ideas — a 3D tilt that leans toward the cursor, a
 * gradient sheen whose position tracks it, and a glow centred under it — with
 * the geometry and the palette re-derived for this card, because neither
 * transfers.
 *
 * WHY THE REFERENCE GEOMETRY COULD NOT BE COPIED
 *
 * The reference computes its angles as a fixed divisor of the pixel distance
 * from centre:
 *
 *     rotateX = (y - height / 2) / 10
 *     rotateY = (width / 2 - x) / 10
 *
 * That makes the tilt scale with the element's SIZE. On the ~300px demo card
 * it lands around 15deg, which is the intended look. This card is 836x348, so
 * the same expression asks for up to 17.4deg on X and 41.8deg on Y — and the
 * card sits in .cards-container, which is `overflow: hidden` because that is
 * what lets its grid row collapse from 0fr during the hero zoom. Measured, the
 * reference angles pushed the card 108px past the top of that clip box and 38px
 * past the left. The corners were being cut off.
 *
 * So the angles here come from the cursor's NORMALISED position and a fixed
 * ceiling, which is independent of how big the card is. The ceilings below were
 * chosen by measuring the actual overhang of all four corner cases against the
 * clip box: they cost 15px horizontally and 4px vertically, and the container
 * has been given room for that. A wide block of 470 characters of quotation
 * also simply cannot take a 40deg yaw and stay readable.
 *
 * WHY THE RECT IS RE-READ EVERY FRAME
 *
 * getBoundingClientRect() on the card includes the tilt we ourselves just
 * applied, so the box we measure the cursor against is up to ~2% wider than the
 * card's real one. That is a self-referential measurement, and normally worth
 * avoiding — but here the loop is strongly contractive (the rect varies by ~1.7%
 * across the whole tilt range, and the angle depends on it only weakly), so the
 * error lands under 0.1deg and cannot oscillate. Caching a clean rect instead
 * would mean invalidating it on scroll, and this card is inside a pinned,
 * scroll-scrubbed stage that moves under the cursor constantly. One rect read
 * inside a rAF, before any writes, is both cheaper and more correct.
 * ====================================================================== */

/* Weaker than the reference's 1000px. Perspective is a distance in the same
   units as the element, so the same value bites far harder on an 836px card
   than on a 300px one; 1600 keeps the near corner from ballooning. */
const PERSPECTIVE_PX = 1600;
/* Degrees at the very edge. See the measurement note above. */
const MAX_ROT_X_DEG = 5;
const MAX_ROT_Y_DEG = 7;
/* The lift the CSS :hover rule used to do on its own. Folded in here because an
   inline transform overrides that rule wholesale, so if it were not restated
   the card would lose its lift the moment this file took over. */
const LIFT_PX = 4;

export function initHolographicCard(rootSelector) {
  const card = document.querySelector(rootSelector);
  if (!card) return;

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

  /*
   * The two layers are created here rather than written into index.html.
   *
   * They are decoration with no content, so they have no business in the
   * markup: the card is a <figure> holding a quote, an attribution and an icon,
   * and that structure is what a screen reader and a text selection get. Built
   * here, they also simply do not exist if this module fails to load, which
   * leaves the card exactly as it was rather than half-styled.
   */
  const sheen = document.createElement('div');
  sheen.className = 'holo-sheen';
  sheen.setAttribute('aria-hidden', 'true');
  const glow = document.createElement('div');
  glow.className = 'holo-glow';
  glow.setAttribute('aria-hidden', 'true');
  card.prepend(sheen, glow);
  card.classList.add('holographic-card');

  let frame = null;
  let pointerX = 0;
  let pointerY = 0;

  function render() {
    frame = null;
    const rect = card.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const x = pointerX - rect.left;
    const y = pointerY - rect.top;

    /* 0..100% for the gradients, which is all either layer needs — a radial
       gradient's centre and a background-position both take percentages, so
       there is no reason to carry a second pair of pixel variables. */
    card.style.setProperty('--holo-x', `${(x / rect.width) * 100}%`);
    card.style.setProperty('--holo-y', `${(y / rect.height) * 100}%`);

    /*
     * The tilt is the only part reduced motion drops. A glow that follows the
     * cursor is a lighting change in place, not movement across the screen, so
     * it stays: losing it would leave the card with no response at all, and
     * nothing about it is vestibular.
     */
    if (reduced.matches) return;

    /* -1..1, clamped: a pointermove can land a pixel outside the box on the
       way out, and an unclamped value would briefly overshoot the ceiling. */
    const nx = Math.min(Math.max((x / rect.width) * 2 - 1, -1), 1);
    const ny = Math.min(Math.max((y / rect.height) * 2 - 1, -1), 1);

    /* Signs follow the reference: the card leans TOWARD the cursor. Cursor
       below centre pitches the top away; cursor right of centre brings the
       right edge forward. */
    const rotX = ny * MAX_ROT_X_DEG;
    const rotY = -nx * MAX_ROT_Y_DEG;

    card.style.transform =
      `perspective(${PERSPECTIVE_PX}px) rotateX(${rotX}deg) rotateY(${rotY}deg) translateY(${-LIFT_PX}px)`;
  }

  /* Coalesced to one write per frame. A mousemove can fire several times
     between paints, and each of those would otherwise be a style write and a
     forced layout on a card that shares the page with ten WebGL contexts. */
  function schedule() {
    if (frame === null) frame = requestAnimationFrame(render);
  }

  function onMove(e) {
    pointerX = e.clientX;
    pointerY = e.clientY;
    schedule();
  }

  function onEnter(e) {
    /* The class, not :hover, drives the layers and the transform's transition.
       A stuck :hover after a scroll-under or a tab-away is a real thing; a
       class we add and remove ourselves cannot get out of step with the
       listeners that manage it. */
    card.classList.add('is-holo-active');
    onMove(e);
  }

  function onLeave() {
    if (frame !== null) {
      cancelAnimationFrame(frame);
      frame = null;
    }
    /*
     * Drop the class FIRST. It is what suppresses the transform's transition
     * while tracking, so removing it in the same style change is what lets the
     * card ease back to level instead of snapping there.
     */
    card.classList.remove('is-holo-active');
    card.style.setProperty('--holo-x', '50%');
    card.style.setProperty('--holo-y', '50%');
    card.style.transform =
      `perspective(${PERSPECTIVE_PX}px) rotateX(0deg) rotateY(0deg) translateY(0px)`;
  }

  /*
   * pointer* rather than mouse*, so a stylus behaves and a touch can be turned
   * away explicitly. A finger has no hover: it would fire one pointermove at
   * the point of contact, tilt the card, and leave it tilted with no pointerout
   * to put it back — so touch is filtered out here rather than in a media
   * query, which cannot see the event's own type.
   */
  const fromTouch = (e) => e.pointerType === 'touch';
  card.addEventListener('pointerenter', (e) => !fromTouch(e) && onEnter(e));
  card.addEventListener('pointermove', (e) => !fromTouch(e) && onMove(e));
  card.addEventListener('pointerleave', (e) => !fromTouch(e) && onLeave());
  /* A drag that ends outside the card, or a pointer the browser takes away
     mid-gesture, never sends pointerleave. Without this the card stays tilted. */
  card.addEventListener('pointercancel', onLeave);
}
