/* =========================================================================
 * Horizontal swipe
 *
 * Three decks on this page step one card at a time — the projects carousel,
 * the services deck and the fanned discipline stack — and every one of them
 * could only be stepped by a button or an arrow key. A phone has neither. The
 * disciplines stack did carry a pointer drag, but it never fired on a phone
 * for the reason below, so in practice a touch reader could reach the first
 * card of each deck and no others.
 *
 * WHY THE EXISTING DRAG DID NOTHING ON TOUCH
 *
 * Nothing on this page set `touch-action`, so the browser owned every gesture.
 * The moment a finger moved, it claimed the sequence for scrolling and fired
 * `pointercancel` — which the drag correctly treated as "the gesture was taken
 * away", and reset. The handler was right; it was simply never allowed to
 * finish.
 *
 * `touch-action: pan-y` on the deck is the other half, and it has to be in the
 * stylesheet rather than here: it is a declaration the compositor reads before
 * the first event, not something script can decide once a gesture is under way.
 * It gives the browser vertical panning — the page still scrolls normally with
 * a finger anywhere, including on the cards — and gives us the horizontal axis.
 * That split is also why this file never calls preventDefault: with pan-y set
 * there is no default left to prevent on the axis we care about, and a vertical
 * drag SHOULD still cancel us, because the reader is scrolling the page.
 *
 * DIRECTION
 *
 * The card follows the finger: swiping right pulls the previous card in from
 * the left, swiping left brings the next one. Same convention the arrow keys
 * and the flanking buttons already use.
 * ====================================================================== */

/* Travel that counts as a deliberate swipe rather than a tap that wandered. */
const THRESHOLD_PX = 56;
/*
 * ...or a flick, which is short but fast. Without this a quick confident
 * gesture that covers 40px reads as nothing, which is the single most common
 * way a swipe implementation feels broken.
 */
const VELOCITY_PX_S = 550;

/**
 * @param el      the deck. Needs `touch-action: pan-y` in CSS.
 * @param onPrev  called for a swipe to the right.
 * @param onNext  called for a swipe to the left.
 * @param threshold  override the travel, for decks whose cards are unusually
 *                   narrow or wide. May be a function, for a deck that sizes
 *                   its cards to the viewport and therefore has no answer yet
 *                   when this is called.
 * @returns a function reporting whether a swipe just fired, for callers that
 *          also have a click handler on the same surface and must not run both.
 */
export function initSwipe(el, opts = {}) {
  if (!el) return () => false;

  const { onPrev, onNext } = opts;

  /*
   * Resolved per gesture, and defended.
   *
   * Destructuring `threshold` in the signature would read it once, here, which
   * is before a deck that measures itself has measured anything — card-stack.js
   * seeds its card width at -1 precisely so a premature read cannot look like a
   * real answer. A negative threshold passes `travel > threshold` for every
   * value there is, so the first version of this turned every tap into a swipe.
   */
  const thresholdAt = () => {
    const t = typeof opts.threshold === 'function' ? opts.threshold() : opts.threshold;
    return typeof t === 'number' && t > 0 ? t : THRESHOLD_PX;
  };

  let id = null;
  let startX = 0;
  let startAt = 0;
  let firedAt = 0;

  el.addEventListener('pointerdown', (e) => {
    /* Only the first finger. A second one landing mid-gesture is a pinch, and
       stepping a deck in the middle of one is never what was meant. */
    if (!e.isPrimary) return;
    id = e.pointerId;
    startX = e.clientX;
    startAt = performance.now();
  });

  el.addEventListener('pointerup', (e) => {
    if (e.pointerId !== id) return;
    id = null;

    const travel = e.clientX - startX;
    const seconds = Math.max(0.001, (performance.now() - startAt) / 1000);
    const velocity = travel / seconds;
    const threshold = thresholdAt();

    if (travel > threshold || velocity > VELOCITY_PX_S) {
      firedAt = performance.now();
      onPrev?.();
    } else if (travel < -threshold || velocity < -VELOCITY_PX_S) {
      firedAt = performance.now();
      onNext?.();
    }
  });

  /* The browser took the gesture for a vertical scroll, or the pointer was
     otherwise revoked. Either way this is no longer a swipe. */
  const drop = (e) => {
    if (e.pointerId === id) id = null;
  };
  el.addEventListener('pointercancel', drop);
  el.addEventListener('pointerleave', drop);

  /*
   * A swipe ends with a click on whatever was under the finger. Callers with
   * their own click handler on these cards ask this first, or a swipe would
   * step the deck and then immediately be undone by the click that follows it.
   */
  return () => performance.now() - firedAt < 300;
}
