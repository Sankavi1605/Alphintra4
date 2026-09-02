/* =========================================================================
 * The loader's flare, driven by the pointer
 *
 * The light on the logo outline used to run on a 3.2s timer. This puts it
 * under the cursor instead: move the mouse and the highlight travels along the
 * stroke to follow it, and the angle of the light tilts with vertical
 * movement. That is the part of the supplied flare component that is actually
 * reproducible here — its renderer module was never included, so there is no
 * canvas implementation to port, only the behaviour.
 *
 * WHY THE CSS ANIMATION IS STILL THERE
 *
 * A loader that only looks alive once the reader moves the mouse is a broken
 * loader — plenty of people never touch the mouse while a page loads, and on a
 * phone there is no cursor at all. So the timed sweep remains the resting
 * state, and this hands over to the pointer the moment one actually moves. It
 * does not hand back: the overlay lives a couple of seconds, and a light that
 * kept snapping between "following you" and "sweeping on its own" would read
 * as a glitch rather than as a choice.
 *
 * WHY NOTHING HERE PAINTS THE FIRST FRAME
 *
 * This is an enhancement layered onto artwork that is already on screen. The
 * overlay is in the markup and its flare is CSS, so it paints off the first
 * style pass with no JS at all; this module only takes over once the bundle
 * has run. On a slow connection the sweep simply keeps running for longer,
 * which is the correct degradation and the reason the sweep is the default.
 * ====================================================================== */

/*
 * Where the highlight can sit, as background-position percentages.
 *
 * Derived rather than guessed. The gradient is 300% wide, so a position of p
 * resolves to an offset of p x (W - 3W) = -2Wp, and the highlight sits at 50%
 * of the gradient, i.e. 1.5W along it. For the highlight to land at fraction f
 * across the mark: -2Wp + 1.5W = fW, so p = (1.5 - f) / 2.
 *
 * f = 0 gives 0.75 and f = 1 gives 0.25, so sweeping the cursor the full width
 * of the window moves the light from one end of the logo to the other while p
 * stays inside 0..1 throughout. That range matters: outside it the gradient
 * leaves the box entirely and, with background-repeat: no-repeat behind a mask,
 * the logo disappears. The keyframe version of this had exactly that bug.
 */
const POS_AT_LEFT = 75;
const POS_AT_RIGHT = 25;

/* How far the light's direction tilts between the top and bottom of the
   window. The resting value in the stylesheet is 105deg, the midpoint. */
const ANGLE_MIN_DEG = 78;
const ANGLE_MAX_DEG = 132;

/* How far the halo sits off centre, toward the cursor. Large enough to be
   plainly on one side, small enough that it still reads as the mark's own glow
   rather than as a separate smudge next to it. */
const GLOW_REACH_PX = 15;

const clamp01 = (n) => Math.min(Math.max(n, 0), 1);

export function initLoaderFlare() {
  const mark = document.querySelector('#loader-overlay .loader-mark');
  if (!mark) return;
  /* The halo lives on the wrapper — see the drop-shadow note in the
     stylesheet for why it cannot live on the mark itself. */
  const flare = mark.parentElement;
  if (!flare) return;

  /*
   * Reduced motion keeps the timed sweep and never arms this.
   *
   * The sweep is a slow tonal shift on a small mark, which is about as mild as
   * an animation gets; a highlight that darts around in response to every
   * mouse movement is a different proposition entirely, and it is the kind of
   * thing the setting is asking us not to do.
   */
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  let frame = null;
  let pointerX = 0;
  let pointerY = 0;
  let armed = false;

  function render() {
    frame = null;

    const fx = clamp01(pointerX / (window.innerWidth || 1));
    const fy = clamp01(pointerY / (window.innerHeight || 1));

    /*
     * Handed over on the first real move, not on init. Setting the class up
     * front would kill the sweep and leave the light parked wherever the
     * cursor happened to be resting — or dead centre if it had never entered
     * the window at all.
     */
    if (!armed) {
      armed = true;
      mark.classList.add('is-pointer-lit');
    }

    const pos = POS_AT_LEFT + (POS_AT_RIGHT - POS_AT_LEFT) * fx;
    const angle = ANGLE_MIN_DEG + (ANGLE_MAX_DEG - ANGLE_MIN_DEG) * fy;

    mark.style.setProperty('--loader-sweep', `${pos}% 50%`);
    mark.style.setProperty('--loader-angle', `${angle}deg`);

    /*
     * The halo's offset: a fixed step in the DIRECTION of the cursor.
     *
     * Direction, not distance. A magnitude that scaled with how far away the
     * cursor is would collapse to nothing whenever it came near the mark —
     * which is exactly when someone is looking closely — and a normalised
     * vector keeps the halo fully to one side wherever the pointer happens to
     * be. It swings around the logo rather than growing and shrinking.
     *
     * Measured off the mark's real box, so it stays correct as the clamped
     * width changes between breakpoints.
     */
    const box = mark.getBoundingClientRect();
    const dx = pointerX - (box.left + box.width / 2);
    const dy = pointerY - (box.top + box.height / 2);
    const dist = Math.hypot(dx, dy);
    /* Dead centre has no direction; leave the halo where it is rather than
       dividing by zero and writing NaN into a filter. */
    if (dist > 1) {
      flare.style.setProperty('--loader-glow-x', `${(dx / dist) * GLOW_REACH_PX}px`);
      flare.style.setProperty('--loader-glow-y', `${(dy / dist) * GLOW_REACH_PX}px`);
    }
  }

  /* One write per frame. A pointermove can fire several times between paints,
     and each of those would otherwise re-resolve a gradient. */
  function onMove(e) {
    pointerX = e.clientX;
    pointerY = e.clientY;
    if (frame === null) frame = requestAnimationFrame(render);
  }

  /*
   * On the window, not the overlay. The overlay is fixed and full-screen so it
   * would catch everything anyway — but it is also removed from the DOM when
   * loading finishes, and a listener bound to a detached node is a leak that
   * happens to be invisible. Bound here it has one owner and one teardown.
   *
   * Touch is filtered out: a tap would fire one move, jump the light to the
   * point of contact and leave it there, which is worse than the sweep.
   */
  const onPointerMove = (e) => {
    if (e.pointerType === 'touch') return;
    onMove(e);
  };

  window.addEventListener('pointermove', onPointerMove, { passive: true });

  /* Torn down when the overlay goes, so neither the listener nor a queued
     frame outlives the thing they are drawing. */
  function stop() {
    window.removeEventListener('pointermove', onPointerMove);
    if (frame !== null) {
      cancelAnimationFrame(frame);
      frame = null;
    }
  }

  const overlay = document.getElementById('loader-overlay');
  if (!overlay || !window.MutationObserver) return;

  const watcher = new MutationObserver(() => {
    if (!overlay.isConnected) {
      stop();
      watcher.disconnect();
    }
  });
  watcher.observe(overlay.parentNode, { childList: true });
}
