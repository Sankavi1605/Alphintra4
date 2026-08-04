/* =========================================================================
 * Careers page entry
 *
 * Deliberately separate from main.js. That module pulls GLTFLoader, the
 * meshopt decoder, ScrollTrigger and ~430 lines of scene code this page has
 * no use for; importing it here would push three quarters of a megabyte at a
 * page that shows one card. This entry takes only the horizon background,
 * and Vite splits the shared three.js chunk across both pages.
 * ====================================================================== */
import { initHorizonField } from './horizon-field.js';

// Nav, mobile menu, scroll-to-top and the other shared page behaviour.
import './ui.js';

/*
 * The stylesheet already hides .horizon-field under reduced motion, but the
 * scene would still build a WebGL context and run its entrance timeline for a
 * canvas nobody can see, so skip the work entirely.
 */
if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  /*
   * A microtask for the same reason main.js defers its fields: a module script
   * is already deferred, so this runs while module evaluation is still on the
   * stack and the host element's layout has not settled. Letting evaluation
   * finish first means the scene measures the real box on its first frame.
   */
  queueMicrotask(() => initHorizonField('#careers-horizon'));
}
