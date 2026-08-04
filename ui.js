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
 * FAQ accordion — real buttons, so keyboard and screen readers work
 * ---------------------------------------------------------------------- */
function initFaq() {
  const items = document.querySelectorAll('.faq-item');
  if (!items.length) return;

  items.forEach((item) => {
    const button = item.querySelector('.faq-question');
    const answer = item.querySelector('.faq-answer');
    if (!button || !answer) return;

    button.addEventListener('click', () => {
      const willOpen = !item.classList.contains('active');

      items.forEach((other) => {
        other.classList.remove('active');
        other.querySelector('.faq-question')?.setAttribute('aria-expanded', 'false');
      });

      if (willOpen) {
        item.classList.add('active');
        button.setAttribute('aria-expanded', 'true');
      }
    });
  });
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
 * Contact form
 *
 * The site is static, so there is no server to post to. The form validates
 * in the browser and then hands off to the visitor's mail client with the
 * message pre-filled. Point `data-endpoint` at a real handler (Formspree,
 * a Worker, an API route) and it will POST there instead.
 * ---------------------------------------------------------------------- */
function initContactForm() {
  const form = document.querySelector('#contact-form');
  if (!form) return;

  const status = form.querySelector('.form-status');
  const submitButton = form.querySelector('button[type="submit"]');
  const endpoint = form.dataset.endpoint;

  const fieldError = (field) => form.querySelector(`#${field.id}-error`);

  const validate = (field) => {
    const error = fieldError(field);
    const valid = field.checkValidity();

    field.setAttribute('aria-invalid', String(!valid));
    if (error) error.textContent = valid ? '' : field.dataset.errorMessage || field.validationMessage;
    return valid;
  };

  const fields = Array.from(form.querySelectorAll('input[required], textarea[required]'));

  fields.forEach((field) => {
    // Only nag after the visitor has left the field once.
    field.addEventListener('blur', () => validate(field));
    field.addEventListener('input', () => {
      if (field.getAttribute('aria-invalid') === 'true') validate(field);
    });
  });

  const setStatus = (message, state) => {
    if (!status) return;
    status.textContent = message;
    status.dataset.state = state;
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    // Honeypot: real people never fill a field they cannot see.
    if (form.querySelector('#company-website')?.value) return;

    const allValid = fields.map(validate).every(Boolean);
    if (!allValid) {
      setStatus('Please correct the highlighted fields and try again.', 'error');
      fields.find((field) => field.getAttribute('aria-invalid') === 'true')?.focus();
      return;
    }

    const data = new FormData(form);
    const name = String(data.get('name') || '').trim();
    const email = String(data.get('email') || '').trim();
    const message = String(data.get('message') || '').trim();

    if (endpoint) {
      submitButton.disabled = true;
      setStatus('Sending your message…', 'pending');
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { Accept: 'application/json' },
          body: data,
        });
        if (!response.ok) throw new Error(`Request failed: ${response.status}`);
        form.reset();
        setStatus('Thanks — your message is on its way. We reply within one business day.', 'success');
      } catch {
        setStatus(
          'Something went wrong sending that. Please email contact@alphintra.com directly.',
          'error'
        );
      } finally {
        submitButton.disabled = false;
      }
      return;
    }

    const subject = `Project enquiry from ${name}`;
    const body = `${message}\n\n—\n${name}\n${email}`;
    window.location.href = `mailto:contact@alphintra.com?subject=${encodeURIComponent(
      subject
    )}&body=${encodeURIComponent(body)}`;

    setStatus(
      'Opening your email app with the message ready to send. If nothing happens, write to contact@alphintra.com.',
      'success'
    );
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
 * Projects background film
 *
 * Not a native `loop`. Opacity starts at 0 and a rAF loop fades in over the
 * first 0.5s and out over the last 0.5s; on `ended` it snaps to 0, waits
 * 100ms, then replays from the beginning. No gradient overlay.
 * ---------------------------------------------------------------------- */
const PROJECTS_VIDEO_FADE = 0.5; // seconds
const PROJECTS_VIDEO_GAP = 100; // ms between cycles

function initProjectsVideo() {
  const video = document.querySelector('.projects-video');
  if (!video) return;

  // A looping film is the opposite of what reduced motion asks for.
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    video.closest('.projects-video-wrap')?.remove();
    return;
  }

  video.muted = true;
  video.playsInline = true;

  let onScreen = false;
  let frameId = null;
  let replayTimer = null;

  const setOpacity = (value) => {
    video.style.opacity = String(Math.min(1, Math.max(0, value)));
  };

  const frame = () => {
    frameId = requestAnimationFrame(frame);

    const duration = video.duration;
    if (!duration || !isFinite(duration)) return;

    const t = video.currentTime;
    if (t < PROJECTS_VIDEO_FADE) setOpacity(t / PROJECTS_VIDEO_FADE);
    else if (t > duration - PROJECTS_VIDEO_FADE) setOpacity((duration - t) / PROJECTS_VIDEO_FADE);
    else setOpacity(1);
  };

  video.addEventListener('ended', () => {
    setOpacity(0);
    clearTimeout(replayTimer);
    replayTimer = setTimeout(() => {
      video.currentTime = 0;
      if (onScreen && !document.hidden) video.play().catch(() => {});
    }, PROJECTS_VIDEO_GAP);
  });

  const sync = () => {
    const shouldRun = onScreen && !document.hidden;
    if (shouldRun) {
      if (frameId === null) frame();
      video.play().catch(() => {});
    } else {
      video.pause();
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
        frameId = null;
      }
    }
  };

  // 13MB of film: only fetch it once the section is close.
  let fetched = false;
  new IntersectionObserver(
    ([entry]) => {
      onScreen = entry.isIntersecting;
      if (onScreen && !fetched) {
        fetched = true;
        video.preload = 'auto';
        video.load();
      }
      sync();
    },
    { rootMargin: '400px' }
  ).observe(video);

  document.addEventListener('visibilitychange', sync);
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
  initFaq();
  initScrollTop();
  initContactForm();
  initSpotlights();
  initProjectsVideo();
  initYear();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initUI, { once: true });
} else {
  initUI();
}
