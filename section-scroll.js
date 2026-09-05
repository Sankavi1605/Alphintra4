/* =========================================================================
 * Section stepping — one gesture, one scene
 *
 * This replaces `scroll-snap-type: y mandatory`, which could not do the job.
 * Mandatory snap re-snaps to the NEAREST snap point when a gesture ends, so
 * any scroll shorter than half a section is simply undone: on a 700px viewport
 * a wheel notch moves about 100px, the browser decides the section you started
 * in is still the closest one, and puts you straight back. Measured on this
 * page, one, two and three notches all left scrollY unchanged at 2198 — it
 * took an eight-notch fling to move a single section. That is what "it takes
 * two or three swipes to change section" was.
 *
 * Here the DIRECTION of the gesture picks the target, never its size. One
 * gesture is one stop, either way, and the animation belongs to us so nothing
 * can re-target it halfway through.
 *
 * Two things are deliberately left to the browser:
 *
 *   the hero's zoom  .pin-spacer is ~2200px of scrubbed animation with no
 *                    single resting place — the point is to scroll *through*
 *                    it — so above the first stop the page scrolls natively.
 *
 *   inner scrollers  the FAQ's .cards-container and anything else that
 *                    overflows takes the gesture first, while it still has
 *                    somewhere to go.
 *
 *   touch            a finger scrolls the page natively. See the note above
 *                    the listener at the bottom of this file.
 * ====================================================================== */

/* In document order. These are the one-screen scenes; the hero above them and
   the footer below are handled separately. */
const SECTION_IDS = [
  'projects',
  'concepts',
  'about-us',
  'services',
  'disciplines',
  'makers',
  'about',
  'contact',
  'faq',
];

/*
 * 700ms, having been 620 and then briefly 1000.
 *
 * The duration is also the lockout: every wheel notch that arrives while a step
 * is running is swallowed, so this plus SETTLE_MS is how long the page ignores
 * the reader. At 1000 + 90 that was a tenth over a second of dropped input per
 * gesture, and it read as the page being stuck rather than as being calm.
 * (Touch is no longer in that sentence — see the listener at the bottom.)
 *
 * The good news is that the duration was never the thing making it feel fast.
 * The curve was. Measured on a 698px viewport, easeInOutCubic peaked at
 * 3377px/s — it has to reach three times the average speed, not the two it is
 * easy to assume, because its derivative at the midpoint is 12 * 0.25 — where
 * the easeInOutSine below only reaches 1.57x. So at 700ms the peak is 1566px/s,
 * still less than half the original, with the lockout back to 790ms: about
 * where it was before any of this, and a rate nobody described as stuck.
 */
const DURATION = 700; // ms for one step
const WHEEL_MIN = 4; // deltaY below this is noise, not intent
const SETTLE_MS = 90; // quiet time after a step before the next is accepted
const EDGE = 6; // px tolerance when deciding which stop we are already on

/**
 * Every position the scroller is allowed to rest at, ascending.
 *
 * Rebuilt per gesture rather than cached: the fields mount lazily as you
 * approach them and ScrollTrigger re-measures the pin, so the page's geometry
 * genuinely does move under us. Nine rect reads once per gesture is nothing.
 */
function buildStops() {
  const vh = window.innerHeight;
  const max = Math.max(0, document.documentElement.scrollHeight - vh);
  const stops = [];

  /*
   * A stop worth stepping to. Section tops are always kept; the extra stops
   * inside a tall section have to earn their place, or a section that happens
   * to run a few pixels over a screen contributes one a finger's width below
   * its own top. #contact is 729px against a 698px viewport on this desktop
   * and did exactly that: a step that moved 31px and looked like nothing
   * happened, which is the bug this file exists to fix.
   */
  const MIN_GAP = Math.max(100, vh * 0.25);

  const push = (y, minGap = EDGE) => {
    const v = Math.round(Math.min(Math.max(y, 0), max));
    if (!stops.length || v - stops[stops.length - 1] > minGap) stops.push(v);
  };

  for (const id of SECTION_IDS) {
    const el = document.getElementById(id);
    if (!el) continue;

    const top = el.getBoundingClientRect().top + window.scrollY;
    const h = el.offsetHeight;
    push(top);

    /*
     * Sections that outgrow the screen get an extra stop per screenful, so a
     * step can never carry the reader past content they have not seen. On a
     * phone #concepts stacks four capability cards and runs to about 1.6
     * viewports; without this, stepping off its top would skip the last two.
     *
     * The last of them is clamped to the section's own bottom rather than
     * running on past it, and every one is a full viewport clear of the next
     * section's top, so only the gap behind them needs guarding.
     */
    if (h > vh + MIN_GAP) {
      const screens = Math.ceil(h / vh);
      for (let i = 1; i < screens; i += 1) {
        push(Math.min(top + i * vh, top + h - vh), MIN_GAP);
      }
    }
  }

  const footer = document.querySelector('body > footer');
  if (footer) push(footer.getBoundingClientRect().top + window.scrollY);

  return stops;
}

/**
 * The stop a gesture in `dir` should land on, or null to let the browser have
 * the gesture — which means either the hero's zoom or the end of the page.
 */
function nextStop(dir) {
  const stops = buildStops();
  if (!stops.length) return null;

  const y = window.scrollY;

  /* Above the first scene is the hero and its scrubbed zoom: scroll it. */
  if (dir > 0 && y < stops[0] - EDGE) return null;

  if (dir > 0) return stops.find((s) => s > y + EDGE) ?? null;

  for (let i = stops.length - 1; i >= 0; i -= 1) {
    if (stops[i] < y - EDGE) return stops[i];
  }
  return null;
}

/**
 * The nearest ancestor of `node` that can still scroll vertically in `dir`.
 * Those take the gesture first — the FAQ answers on a phone are the case that
 * matters, where the card itself overflows.
 */
function scrollableUnder(node, dir) {
  let el = node instanceof Element ? node : null;
  while (el && el !== document.body && el !== document.documentElement) {
    const style = getComputedStyle(el);
    const scrolls = /auto|scroll|overlay/.test(style.overflowY);
    if (scrolls && el.scrollHeight > el.clientHeight + 1) {
      const room =
        dir > 0
          ? el.scrollHeight - el.clientHeight - el.scrollTop > 1
          : el.scrollTop > 1;
      if (room) return true;
    }
    el = el.parentElement;
  }
  return false;
}

export function initSectionScroll() {
  /*
   * Reduced motion gets an ordinary page. Stepping without an animation means
   * the view teleports a screen on every notch, which is exactly the kind of
   * jump the setting is asking us not to make, and with the CSS snap gone
   * native scrolling here is perfectly usable.
   */
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  let animating = false;
  let frame = null;
  let releaseTimer = null;

  function animateTo(to) {
    const from = window.scrollY;
    const distance = to - from;
    if (!distance) return;

    if (frame !== null) cancelAnimationFrame(frame);
    clearTimeout(releaseTimer);
    animating = true;

    const started = performance.now();
    const tick = (now) => {
      const p = Math.min(1, (now - started) / DURATION);
      /*
       * easeInOutSine, where this used to run easeInOutCubic.
       *
       * Both leave and arrive at rest, which is what makes a step read as one
       * move rather than a jump that then settles. The difference is the middle:
       * a cubic in-out has to reach 3x the average speed to cover the distance
       * in time, a sine in-out only pi/2 — about 1.57x. Same start, same stop,
       * noticeably less rush through the part of the step the reader is actually
       * watching, which is what "steady" means here.
       */
      const e = -(Math.cos(Math.PI * p) - 1) / 2;

      /* `instant`, explicitly: html carries scroll-behavior:smooth for anchor
         links, and a bare scrollTo would inherit it and animate every one of
         these frames against the next. */
      window.scrollTo({ top: from + distance * e, behavior: 'instant' });

      if (p < 1) {
        frame = requestAnimationFrame(tick);
        return;
      }
      frame = null;
      releaseTimer = setTimeout(() => {
        animating = false;
      }, SETTLE_MS);
    };

    frame = requestAnimationFrame(tick);
  }

  /* The mobile menu locks the body; nothing should be stepping behind it. */
  const locked = () => document.body.classList.contains('no-scroll');

  function onWheel(event) {
    if (locked() || event.ctrlKey) return; // ctrl+wheel is a browser zoom
    if (animating) {
      event.preventDefault();
      return;
    }
    if (Math.abs(event.deltaY) < WHEEL_MIN) return;

    const dir = Math.sign(event.deltaY);
    if (scrollableUnder(event.target, dir)) return;

    const target = nextStop(dir);
    if (target === null) return;

    event.preventDefault();
    animateTo(target);
  }

  /*
   * Wheel only. Touch scrolls natively.
   *
   * This used to claim the swipe too, and that is what "it feels stuck on
   * mobile" was. A step preventDefaults every touchmove for its whole duration,
   * so the page stops following the finger that is dragging it — and a phone
   * reader reads that as the page having frozen, not as it having snapped. It
   * also throws away the two things touch scrolling gets for free and cannot be
   * reproduced from script: momentum, and a 1:1 relationship between how far
   * the finger moves and how far the page does.
   *
   * The problem this file exists to solve was a wheel problem. CSS
   * scroll-snap re-snapped to the nearest point when a gesture ended, so a
   * notch-sized scroll was simply undone; that snap is long gone, and with it
   * gone a phone left alone just scrolls, smoothly, the way it always did. The
   * sections are still a screen tall each, so the page still reads a scene at a
   * time — it is only no longer forced.
   */
  window.addEventListener('wheel', onWheel, { passive: false });
}
