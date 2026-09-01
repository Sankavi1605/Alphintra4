/* =========================================================================
 * Render resolution
 *
 * Shared by every WebGL scene on the site. The home page alone runs five
 * contexts — the hero model, the horizon, the about field, the capability
 * field and the contact field — and every one of them is fragment-bound.
 * Cost scales with the *square* of the device pixel ratio, so a phone at 3x
 * is doing 4x the shading of the same phone at 1.5x for detail nobody can
 * resolve on a 6" screen. Desktop keeps its crisp 2x; phones trade a little
 * sharpness for a frame rate that actually holds.
 *
 * Lives in its own module so the home page and the Careers page cannot drift
 * apart on the policy — both import this one implementation.
 * ====================================================================== */
/*
 * Exported, because resolution is not the only thing a phone wants turned
 * down: the services field also compiles a smaller comet swarm at this width.
 * Same reasoning as above — one query, so the two decisions cannot drift onto
 * different breakpoints.
 */
export const SMALL_SCREEN = window.matchMedia('(max-width: 767.98px)');

export function pixelRatioFor(desktopCap, mobileCap) {
  return Math.min(window.devicePixelRatio, SMALL_SCREEN.matches ? mobileCap : desktopCap);
}
