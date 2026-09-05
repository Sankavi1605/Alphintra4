/**
 * Shared, framework-free UI behaviour for every page on the site.
 * Loaded directly by careers.html and imported by main.js on the home page,
 * so the nav, FAQ and form logic only exist in one place.
 *
 * Every initialiser bails out cleanly when its markup is absent.
 */

/* -------------------------------------------------------------------------
 * Mobile navigation
 * ---------------------------------------------------------------------- */
function initNav() {
  const toggle = document.querySelector('.nav-toggle');
  const menu = document.querySelector('#mobile-menu');
  if (!toggle || !menu) return;

  const closeButton = menu.querySelector('.mobile-menu-close');

  const setOpen = (open) => {
    // `hidden` drives display:none, which restarts the staggered CSS
    // animations every time the menu is opened.
    menu.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    document.body.classList.toggle('no-scroll', open);

    if (open) closeButton?.focus();
  };

  toggle.addEventListener('click', () => setOpen(true));
  closeButton?.addEventListener('click', () => {
    setOpen(false);
    toggle.focus();
  });

  // Tapping a link navigates, so close behind it.
  menu.addEventListener('click', (event) => {
    if (event.target.closest('a')) setOpen(false);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !menu.hidden) {
      setOpen(false);
      toggle.focus();
    }
  });

  // The menu only exists below md; never leave it stuck open on resize.
  window.matchMedia('(min-width: 768px)').addEventListener('change', (event) => {
    if (event.matches && !menu.hidden) setOpen(false);
  });
}

/* -------------------------------------------------------------------------
 * Auto-hiding navigation
 *
 * The bar is fixed and transparent, so over a busy section its links collide
 * with the heading underneath. Scrolling down slides it away; scrolling up —
 * at any point on the page — brings it back.
 * ---------------------------------------------------------------------- */
const NAV_ALWAYS_SHOWN_ABOVE = 120; // px from the top where the bar always stays
const NAV_SCROLL_THRESHOLD = 6; // ignore sub-pixel jitter and rubber-banding

function initNavAutoHide() {
  const nav = document.querySelector('nav');
  if (!nav) return;

  // Retire the intro animation, or its `both` fill-mode keeps overriding the
  // transform the hide relies on. The timeout covers the animation never
  // firing at all (reduced motion, or the tab starting in the background).
  const release = () => nav.classList.add('nav-ready');
  nav.addEventListener('animationend', release, { once: true });
  setTimeout(release, 1200);

  let last = window.scrollY;
  let queued = false;

  const update = () => {
    queued = false;
    const y = window.scrollY;
    const delta = y - last;
    if (Math.abs(delta) < NAV_SCROLL_THRESHOLD) return;

    // Never hide near the top. The mobile-menu guard is belt-and-braces: the
    // body is locked while it is open, so this should not fire anyway.
    const menuOpen = document.body.classList.contains('no-scroll');
    nav.classList.toggle('nav-hidden', delta > 0 && y > NAV_ALWAYS_SHOWN_ABOVE && !menuOpen);
    last = y;
  };

  window.addEventListener(
    'scroll',
    () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(update);
    },
    { passive: true }
  );
}

/* -------------------------------------------------------------------------
 * Scroll to top
 * ---------------------------------------------------------------------- */
function initScrollTop() {
  const button = document.getElementById('scrollTopBtn');
  if (!button) return;

  button.addEventListener('click', () => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
  });
}

/* -------------------------------------------------------------------------
 * Spotlight reveal
 *
 * A still image is the section background. A film sits on top of it but is
 * masked to a soft circle that tracks the cursor, so the video only shows
 * where the pointer is. Runs on every section marked [data-spotlight].
 * ---------------------------------------------------------------------- */
const SPOTLIGHT_RADIUS = 260;
const SPOTLIGHT_LERP = 0.1;

function initSpotlights() {
  document.querySelectorAll('[data-spotlight]').forEach(initSpotlight);
}

function initSpotlight(section) {
  const reveal = section.querySelector('.spotlight-reveal');
  if (!reveal) return;

  const video = reveal.querySelector('video');
  if (!video) return;

  // Nothing to track on a touch screen, and a cursor-chasing film is exactly
  // what someone asking for reduced motion does not want.
  if (
    window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
    window.matchMedia('(hover: none)').matches
  ) {
    reveal.remove();
    return;
  }

  /*
   * Draw the feathered gradient on a canvas and export it to a dataURL ONCE,
   * then move it with mask-position. Re-encoding the canvas every frame would
   * spend more than the whole 16ms budget on PNG compression alone.
   */
  const size = SPOTLIGHT_RADIUS * 2;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(
    SPOTLIGHT_RADIUS, SPOTLIGHT_RADIUS, 0,
    SPOTLIGHT_RADIUS, SPOTLIGHT_RADIUS, SPOTLIGHT_RADIUS
  );
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(0.4, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(0.6, 'rgba(255, 255, 255, 0.75)');
  gradient.addColorStop(0.75, 'rgba(255, 255, 255, 0.4)');
  gradient.addColorStop(0.88, 'rgba(255, 255, 255, 0.12)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const maskImage = `url(${canvas.toDataURL()})`;
  Object.assign(reveal.style, {
    webkitMaskImage: maskImage,
    maskImage,
    webkitMaskRepeat: 'no-repeat',
    maskRepeat: 'no-repeat',
    webkitMaskSize: `${size}px ${size}px`,
    maskSize: `${size}px ${size}px`,
  });

  // 10MB of video: only fetch it once the section is actually near the screen.
  let fetched = false;
  new IntersectionObserver(
    ([entry]) => {
      if (!entry.isIntersecting || fetched) return;
      fetched = true;
      video.preload = 'auto';
      video.load();
    },
    { rootMargin: '400px' }
  ).observe(section);

  let targetX = 0;
  let targetY = 0;
  let smoothX = 0;
  let smoothY = 0;
  let frameId = null;
  let live = false;

  const place = () => {
    const position = `${Math.round(smoothX - SPOTLIGHT_RADIUS)}px ${Math.round(smoothY - SPOTLIGHT_RADIUS)}px`;
    reveal.style.webkitMaskPosition = position;
    reveal.style.maskPosition = position;
  };

  const frame = () => {
    smoothX += (targetX - smoothX) * SPOTLIGHT_LERP;
    smoothY += (targetY - smoothY) * SPOTLIGHT_LERP;
    place();

    // Settled — stop burning frames until the pointer moves again.
    if (Math.abs(targetX - smoothX) < 0.5 && Math.abs(targetY - smoothY) < 0.5) {
      frameId = null;
      return;
    }
    frameId = requestAnimationFrame(frame);
  };

  section.addEventListener(
    'pointermove',
    (event) => {
      if (event.pointerType === 'touch') return;

      const rect = section.getBoundingClientRect();
      targetX = event.clientX - rect.left;
      targetY = event.clientY - rect.top;

      if (!live) {
        live = true;
        // Start where the cursor entered rather than easing in from a corner.
        smoothX = targetX;
        smoothY = targetY;
        place();
        reveal.classList.add('is-live');
        video.play().catch(() => {});
      }

      if (frameId === null) frameId = requestAnimationFrame(frame);
    },
    { passive: true }
  );

  section.addEventListener('pointerleave', () => {
    live = false;
    reveal.classList.remove('is-live');
    video.pause();
    if (frameId !== null) {
      cancelAnimationFrame(frameId);
      frameId = null;
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) video.pause();
  });
}

/* -------------------------------------------------------------------------
 * Footer year
 * ---------------------------------------------------------------------- */
function initYear() {
  document.querySelectorAll('[data-current-year]').forEach((element) => {
    element.textContent = String(new Date().getFullYear());
  });
}

export function initUI() {
  initNav();
  initNavAutoHide();
  initScrollTop();
  initSpotlights();
  initYear();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initUI, { once: true });
} else {
  initUI();
}
