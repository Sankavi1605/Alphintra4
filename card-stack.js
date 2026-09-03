/* =========================================================================
 * Card stack — the fanned deck
 *
 * A port of a React/framer-motion component into this site's own stack. The
 * geometry is the reference's, verbatim in its numbers: a fan of cards laid out
 * by signed offset from the active one, each stepped sideways by the card's
 * unoverlapped width, rotated by an equal share of the total spread, pushed back
 * in z by its distance, and tilted forward unless it is the active card, which
 * instead lifts and scales up.
 *
 * Three things are deliberately not ports:
 *
 *   the transform  The reference animates x/y/rotate/scale through framer and
 *                  then applies translateZ by hand on a child wrapper, because
 *                  it could not drive z through the same animation. GSAP writes
 *                  the whole matrix, so z is just another property and the extra
 *                  wrapper element is gone.
 *
 *   the springs    framer's spring(stiffness 280, damping 28) settles in a bit
 *                  under 400ms with a touch of overshoot. There is no spring
 *                  solver here, so that is matched with a duration and
 *                  back.out — close enough that the difference is not visible
 *                  side by side, and it keeps GSAP as the only dependency.
 *
 *   the culling    The reference returns null for cards outside the fan, which
 *                  takes them out of the DOM and, with them, out of the
 *                  accessibility tree — eight real paragraphs of copy that a
 *                  screen reader would never see. They stay in the document here
 *                  and are faded out instead, which is also what .project-slide
 *                  does in the carousel above.
 * ====================================================================== */
import gsap from 'gsap';

/* --- the reference's geometry -------------------------------------------- */
const MAX_VISIBLE = 7; /* cards in the fan, active included; odd reads best  */
const OVERLAP = 0.48; /* 0..0.8 — higher stacks them tighter                */
const SPREAD_DEG = 48; /* total fan angle across the visible cards          */
const PERSPECTIVE_PX = 1100;
const DEPTH_PX = 140; /* z pushed back per step out from the active card    */
const TILT_X_DEG = 12; /* inactive cards lean back                          */
const ACTIVE_LIFT_PX = 22;
const ACTIVE_SCALE = 1.03;
const INACTIVE_SCALE = 0.94;
const ARC_DROP_PX = 10; /* each step out also drops slightly, for the arc   */

/* --- motion -------------------------------------------------------------- */
const SETTLE = 0.42; /* seconds; framer's spring lands at about this        */
const EASE = 'back.out(1.1)';

/*
 * --- the entrance --------------------------------------------------------
 *
 * #disciplines is the only scene on this page with no WebGL field of its own,
 * so nothing in it used to move until the reader touched it: place(true) laid
 * the deck out in its final position behind the loader, and arriving at the
 * section revealed a finished picture. These open the fan instead.
 *
 * No back.out here. The overshoot is right for a step — it is what stands in
 * for framer's spring — and wrong for eight cards arriving at once, where eight
 * simultaneous bounces read as a wobble rather than as a settle.
 *
 * The stagger is keyed on distance from the active card, not on DOM order, so
 * the deck opens from its middle outward. Three steps out at 0.075 puts the
 * outermost pair 225ms behind the centre, and the whole thing is done in a
 * little over a second.
 */
const OPEN_SETTLE = 0.85;
const OPEN_EASE = 'power3.out';
const OPEN_STAGGER = 0.075;
const OPEN_INTRO_SETTLE = 0.7;

/* Where the cards come from: a collapsed stack at the centre, pushed back and
   leaning away, with no fan angle at all. */
const OPEN_FROM = {
  x: 0,
  y: 0,
  z: -DEPTH_PX * 2.2,
  rotationZ: 0,
  rotationX: 26,
  scale: 0.86,
  opacity: 0,
};

/*
 * 4.2s, not the demo's 2s.
 *
 * These cards carry a title and two lines of real copy, and the services deck
 * further up this page had the same problem stated in its own comment: a card
 * that takes eight seconds to read cannot also leave on its own. Two seconds is
 * a showreel timing for cards that are only photographs. This is slow enough to
 * finish a card and still short enough to read as motion rather than as a thing
 * that has stopped.
 */
const INTERVAL_MS = 4200;

/* --- sizing -------------------------------------------------------------- */
const CARD_MAX_W = 520;
const CARD_RATIO = 320 / 520; /* the reference's 520x320 */

/*
 * Card size against the stage, in two bands.
 *
 * The reference hard-codes 520x320, and keeping that 0.615 ratio on a phone does
 * not work. Measured at a 375px viewport, where the stage comes out 335px wide:
 * a card is then 288px across, and the wordiest of the eight — "Cloud
 * Infrastructure & Data Operations" — needs 221px of height to lay its title and
 * body out at that width. The reference's ratio would have given it 177px, so
 * the copy would have run out of the top of its own panel. Every card in a fan
 * has to be the same size, so the tallest requirement sets the ratio for all
 * eight.
 *
 * A narrow stage therefore gets a much squarer card, and a little more of the
 * width. Some of the fan is given up for it — the neighbours show less of their
 * edges — but a card whose copy does not fit is not a trade worth making.
 *
 * 0.98 gives that 288px card 282px of height against the 182px it needs once the
 * phone type scale in the stylesheet applies. The headroom is deliberate twice
 * over: this copy comes from alphintra.com and will not stay this length
 * forever, and the requirement grows as the stage narrows — at a 267px stage the
 * card is 230 wide and needs 202, which 0.92 cleared by only 10px.
 */
const NARROW_STAGE_PX = 560;
const WIDE = { fraction: 0.74, ratio: CARD_RATIO };
const NARROW = { fraction: 0.86, ratio: 0.98 };

function wrapIndex(n, len) {
  if (len <= 0) return 0;
  return ((n % len) + len) % len;
}

/**
 * The shortest signed distance from `active` to `i` around the ring.
 *
 * Straight subtraction would put the last card six steps from the first in an
 * eight-card deck, so it would fall outside the fan and the wrap would read as
 * the deck jumping back to the start rather than continuing round.
 */
function signedOffset(i, active, len) {
  const raw = i - active;
  if (len <= 1) return raw;
  const alt = raw > 0 ? raw - len : raw + len;
  return Math.abs(alt) < Math.abs(raw) ? alt : raw;
}

/**
 * @param rootSelector   the .card-stack element
 * @param introSelectors elements to raise just before the fan opens — the
 *                       section's heading and lede. Passed in rather than
 *                       looked up here: they are this page's markup, outside
 *                       the deck, and the deck should not have to know them.
 */
export function initCardStack(rootSelector, introSelectors = []) {
  const root = document.querySelector(rootSelector);
  if (!root) return;

  const stage = root.querySelector('.card-stack-stage');
  const cards = [...root.querySelectorAll('.stack-card')];
  if (!stage || !cards.length) return;

  const intro = introSelectors.map((s) => document.querySelector(s)).filter(Boolean);

  const len = cards.length;
  const maxOffset = Math.max(0, Math.floor(MAX_VISIBLE / 2));
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

  let active = 0;
  /*
   * Deliberately -1, not the design size.
   *
   * These are compared against what measure() computes, to skip redundant work.
   * Seeding them with CARD_MAX_W and its ratio seeded them with exactly the
   * answer measure() arrives at on any viewport wide enough to use the full
   * card — so the comparison matched on the very first call, measure() returned
   * "nothing changed", and the one layout that was not optional never happened.
   * The stage got no height and the cards got no width, so each card sized
   * itself from its own text and the fan never appeared at all.
   *
   * A value no measurement can produce cannot collide with one.
   */
  let cardWidth = -1;
  let cardHeight = -1;

  stage.style.perspective = `${PERSPECTIVE_PX}px`;

  /* --- dots ---------------------------------------------------------------
   * Built here rather than written into the markup: eight buttons whose labels
   * have to stay in step with eight card titles are eight chances for the two to
   * drift, and the titles are already in the document.
   */
  const dotsWrap = root.querySelector('.card-stack-dots');
  const dots = cards.map((card, i) => {
    const title = card.querySelector('.stack-card-title');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'card-stack-dot';
    b.setAttribute('aria-label', `Show ${title ? title.textContent.trim() : `card ${i + 1}`}`);
    b.addEventListener('click', () => go(i, true));
    if (dotsWrap) dotsWrap.appendChild(b);
    return b;
  });

  /* --- layout ------------------------------------------------------------- */
  /**
   * Size the cards and the stage to the container.
   *
   * Returns whether anything actually changed, because the observer below has to
   * be able to do nothing: this writes the stage's own height, so an observer
   * watching the stage would be woken by its own last write. That is a
   * ResizeObserver loop, and it hung the renderer — a scroll over the section
   * timed the tab out with no error logged, because the loop never yields.
   *
   * Two things fix it, and both are kept: the observer watches the root, whose
   * height nothing here sets, and this is idempotent so a spurious wake-up is
   * free rather than another eight GSAP writes.
   */
  function measure() {
    const stageW = root.clientWidth || stage.clientWidth || CARD_MAX_W;
    const band = stageW < NARROW_STAGE_PX ? NARROW : WIDE;
    const w = Math.round(Math.min(CARD_MAX_W, stageW * band.fraction));
    const h = Math.round(w * band.ratio);
    if (w === cardWidth && h === cardHeight) return false;

    cardWidth = w;
    cardHeight = h;
    cards.forEach((c) => {
      c.style.width = `${cardWidth}px`;
      c.style.height = `${cardHeight}px`;
    });
    /* The stage has to hold the tallest thing in it: the active card, lifted. */
    stage.style.height = `${cardHeight + ACTIVE_LIFT_PX + 72}px`;
    return true;
  }

  /**
   * Place every card against the current active index.
   *
   * `instant` skips the tween — used for the first paint and under reduced
   * motion, where a settle would be the animation the setting asks us not to
   * play.
   *
   * `opening` is the section's entrance: the same target geometry, but slower,
   * without the back.out overshoot, and delayed by each card's distance from
   * the active one so the fan unfolds from the middle outward. It is a flag on
   * this function rather than a second layout pass so the geometry stays
   * written in exactly one place.
   */
  function place(instant, opening) {
    /* The step, in px and degrees, from the card's own measured width. */
    const spacing = Math.max(10, Math.round(cardWidth * (1 - OVERLAP)));
    const stepDeg = maxOffset > 0 ? SPREAD_DEG / maxOffset : 0;

    cards.forEach((card, i) => {
      const off = signedOffset(i, active, len);
      const abs = Math.abs(off);
      const inFan = abs <= maxOffset;
      const isActive = off === 0;

      const to = {
        xPercent: -50,
        x: off * spacing,
        y: abs * ARC_DROP_PX + (isActive ? -ACTIVE_LIFT_PX : 0),
        z: -abs * DEPTH_PX,
        rotationZ: off * stepDeg,
        rotationX: isActive ? 0 : TILT_X_DEG,
        scale: isActive ? ACTIVE_SCALE : INACTIVE_SCALE,
        /*
         * Faded rather than removed — see the note on culling at the top. The
         * ones just outside the fan keep a little alpha so a step in reveals a
         * card that was already on its way rather than one that popped in.
         */
        opacity: inFan ? 1 : 0,
        duration: instant ? 0 : opening ? OPEN_SETTLE : SETTLE,
        ease: opening ? OPEN_EASE : EASE,
        overwrite: 'auto',
      };

      if (opening) to.delay = abs * OPEN_STAGGER;

      gsap.to(card, to);

      /* zIndex is not animated: a card must not pass through its neighbours on
         the way to its new depth. Set outright, so the order flips at once. */
      card.style.zIndex = String(100 - abs);
      card.classList.toggle('is-active', isActive);
      card.classList.toggle('is-outside', !inFan);
      /* Only the active card is draggable, so only it advertises the grab. */
      card.setAttribute('aria-current', isActive ? 'true' : 'false');
      /* Nothing behind the active card should be reachable by tab or by click
         through its own body — the click handler on it still selects it. */
      card.inert = !isActive;
    });

    dots.forEach((d, i) => {
      const on = i === active;
      d.classList.toggle('is-on', on);
      d.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  }

  /* --- the entrance, in two phases ---------------------------------------
   *
   * Arming and playing are separate because the from-state has to be applied
   * while the section is still off screen. Doing both at once, at the moment
   * the deck becomes visible, would put the heading and the cards to opacity 0
   * in a frame the reader is already looking at — a flash of the finished
   * picture, then the entrance. So the collapsed state is set a screen early
   * and only the tween waits for arrival.
   *
   * It matters more here than it would elsewhere: section-scroll.js moves a
   * whole viewport per gesture, so the section does not creep into view, it
   * lands.
   */
  let armed = false;
  let entered = false;
  let armTimer = null;

  function armIntro() {
    if (armed || entered || reduced.matches) return;
    armed = true;
    if (intro.length) gsap.set(intro, { opacity: 0, y: 28 });
    gsap.set(cards, OPEN_FROM);

    /*
     * The floor, and the reason this is not just an observer.
     *
     * Arming hides the whole section, and only playIntro() brings it back. So
     * anything that stops arrival from ever being *reported* leaves it hidden
     * for good — and there is a real case: an observer coalesces, so a nav jump
     * from the hero straight to #contact can traverse this section and deliver
     * one callback for the state at the end of the jump, by which time the deck
     * is off screen again and was never seen at 35%.
     *
     * Six seconds is far longer than the ~1s step it takes to arrive, so a
     * reader who is on their way still gets the real entrance. Anyone who is
     * not gets the deck instead of a blank, which is the only outcome here that
     * would be a bug rather than a missed flourish.
     */
    armTimer = window.setTimeout(playIntro, 6000);
  }

  function playIntro() {
    if (entered) return;
    entered = true;
    clearTimeout(armTimer);
    /* Reduced motion keeps the deck as place(true) left it: laid out, still. */
    if (reduced.matches) return;
    /* Deep-linked straight to this section, so arming never got its screen of
       warning. Same frame, so there is nothing to flash. */
    if (!armed) armIntro();

    if (intro.length) {
      gsap.to(intro, {
        opacity: 1,
        y: 0,
        duration: OPEN_INTRO_SETTLE,
        ease: 'power2.out',
        stagger: 0.12,
        overwrite: 'auto',
      });
    }
    place(false, true);
  }

  /* --- navigation --------------------------------------------------------- */
  /* Set when the reader acts, so autoplay stops fighting a deliberate choice. */
  let touched = false;

  function go(index, byHand) {
    if (byHand) touched = true;
    active = wrapIndex(index, len);
    /* Instant under reduced motion: a step still has to work there — the arrow
       keys and the dots are the only way through the deck once autoplay is off —
       but it arrives rather than travelling. */
    place(reduced.matches);
  }

  const prev = (byHand) => go(active - 1, byHand);
  const next = (byHand) => go(active + 1, byHand);

  /**
   * Is enough of the deck on screen to be what the reader means?
   *
   * A quarter of its height, or its middle inside the viewport — the second
   * clause covers a deck taller than the window, where no fraction of it can be
   * large and it is still plainly the thing being looked at.
   */
  function deckInView() {
    const r = root.getBoundingClientRect();
    if (r.height <= 0) return false;
    const shown = Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0);
    if (shown >= r.height * 0.25) return true;
    const mid = r.top + r.height / 2;
    return mid > 0 && mid < window.innerHeight;
  }

  /*
   * Arrow keys, bound to the window rather than to the stage.
   *
   * On the stage they only fired when the stage had focus, which meant the
   * section's own instruction — "use the arrow keys" — was a lie unless the
   * reader happened to have clicked or tabbed onto the deck first. Nothing on
   * the page suggests doing that.
   *
   * Worth recording how this got shipped: the test dispatched a KeyboardEvent
   * directly at the stage, which is the element holding the listener, so it
   * bypassed the focus requirement altogether and passed. A real keypress goes
   * to document.activeElement, which is the body. The test could not have failed
   * for the reason the feature was broken.
   *
   * Bound at the window, three things have to be checked that the stage got for
   * free:
   */
  function onKey(e) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    /* 1. Shortcuts. Ctrl/Alt/Meta arrow combinations belong to the browser and
          the OS — word-wise caret moves, history, desktop switching. */
    if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
    /* 2. Typing. An arrow key inside the contact form's fields is a caret move,
          and stealing it would make those inputs unusable. */
    const el = document.activeElement;
    if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
    /* 3. Attention. The deck is one of ten sections and the page is 10,000px
          tall, so it may only step while it is actually being looked at — and
          not at all behind the fullscreen mobile menu.

          Measured here rather than read off the IntersectionObserver that gates
          autoplay. That observer is the right tool for a timer, which can afford
          to start late, and the wrong one for a keypress: its callbacks are
          delivered at frame time, so any lag leaves the arrow keys silently
          dead, and its fixed 0.35 threshold makes them dead again whenever the
          deck happens to be a third on screen. One rect read per keypress
          answers the question at the moment it is actually being asked. */
    if (document.body.classList.contains('no-scroll')) return;
    if (!deckInView()) return;

    /* Only now, so an arrow key still does its normal thing everywhere else. */
    e.preventDefault();
    if (e.key === 'ArrowLeft') prev(true);
    else next(true);
  }
  window.addEventListener('keydown', onKey);

  cards.forEach((card, i) => {
    card.addEventListener('click', () => {
      /* A click on the active card is the end of a drag, not a selection. */
      if (i !== active) go(i, true);
    });
  });

  /* --- drag on the active card -------------------------------------------
   * Pointer events, not GSAP Draggable: Draggable is a paid plugin and this
   * needs one axis, a threshold and a velocity — about twenty lines.
   *
   * The card is not moved by the drag. The reference lets framer drag it with
   * dragConstraints pinned to 0 so it springs back; here the travel only decides
   * which way to step, which keeps the fan's transform in one place instead of
   * having the drag and the layout both writing it.
   */
  let dragId = null;
  let dragStartX = 0;
  let dragStartT = 0;

  stage.addEventListener('pointerdown', (e) => {
    const card = e.target.closest('.stack-card');
    if (!card || !card.classList.contains('is-active')) return;
    dragId = e.pointerId;
    dragStartX = e.clientX;
    dragStartT = performance.now();
    card.setPointerCapture?.(e.pointerId);
  });

  stage.addEventListener('pointerup', (e) => {
    if (dragId !== e.pointerId) return;
    dragId = null;

    const travel = e.clientX - dragStartX;
    const seconds = Math.max(0.001, (performance.now() - dragStartT) / 1000);
    const velocity = travel / seconds; /* px per second */
    /* The reference's threshold, and its 650px/s flick. */
    const threshold = Math.min(160, cardWidth * 0.22);

    if (travel > threshold || velocity > 650) prev(true);
    else if (travel < -threshold || velocity < -650) next(true);
  });

  stage.addEventListener('pointercancel', () => {
    dragId = null;
  });

  /* --- autoplay ----------------------------------------------------------
   * Held off unless the deck is on screen and the tab is in front, and dropped
   * for good the first time the reader steps it themselves. Reduced motion
   * never starts it: an unattended change of state every four seconds is the
   * clearest possible case of what that setting is asking about.
   */
  let timer = null;
  let onScreen = false;
  let hovering = false;

  function syncAutoplay() {
    /* `entered` too, so the timer cannot start stepping a deck that is still
       unfolding. The first tick is 4.2s out and the fan is open in about 1.1,
       so this is belt and braces rather than a fix. */
    const shouldRun =
      entered && onScreen && !document.hidden && !hovering && !touched && !reduced.matches;
    if (shouldRun && timer === null) {
      timer = window.setInterval(() => next(false), INTERVAL_MS);
    } else if (!shouldRun && timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
  }

  root.addEventListener('pointerenter', () => {
    hovering = true;
    syncAutoplay();
  });
  root.addEventListener('pointerleave', () => {
    hovering = false;
    syncAutoplay();
  });
  /* Focus counts as attention too, or the deck steps out from under a keyboard
     reader part-way through a card. */
  root.addEventListener('focusin', () => {
    hovering = true;
    syncAutoplay();
  });
  root.addEventListener('focusout', () => {
    hovering = false;
    syncAutoplay();
  });

  /*
   * Arm a screen early. A positive bottom margin extends the root's box down
   * past the fold, so this fires while the deck is still below it — which is
   * the whole point: the collapsed state gets applied somewhere the reader
   * cannot see it happen.
   */
  const armObserver = new IntersectionObserver(
    ([entry]) => {
      if (!entry.isIntersecting) return;
      armIntro();
      armObserver.disconnect();
    },
    { rootMargin: '0px 0px 60% 0px' }
  );
  armObserver.observe(root);

  new IntersectionObserver(
    ([entry]) => {
      onScreen = entry.isIntersecting;
      /* Arrival: 35% of the deck is enough to mean the section is being looked
         at, and it is the threshold autoplay already trusts for that. */
      if (onScreen) playIntro();
      syncAutoplay();
    },
    { threshold: 0.35 }
  ).observe(root);

  document.addEventListener('visibilitychange', syncAutoplay);

  /* --- boot --------------------------------------------------------------- */
  measure();
  place(true);
  /*
   * Observed, not measured once: this section is laid out behind the loader, and
   * the stage's width is not final until that has come down.
   *
   * On the root, not the stage — see measure(). Re-placing only when the card
   * size actually changed, for the same reason.
   */
  new ResizeObserver(() => {
    if (measure()) place(true);
  }).observe(root);

  reduced.addEventListener?.('change', () => {
    place(true);
    syncAutoplay();
  });
}
