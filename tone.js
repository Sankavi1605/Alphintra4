import { ScrollTrigger } from 'gsap/ScrollTrigger';

/* =========================================================================
 * Tone — dark scenes and white ones
 *
 * The page alternates: projects, disciplines and about are white, and the
 * rest — the hero, the 3D scenes and the closing call to action — are dark. A
 * section opts in with `data-tone="light"`, and moving one between the two is
 * that attribute and nothing else.
 *
 * HOW THE CHANGE HAPPENS
 *
 * Deliberately plain. A white section arrives dark, the same black as the
 * scene it follows, and once it has taken over the screen the lights come up:
 * its background, its colour wash and its content fade in together. No wipe,
 * no morph, no edge sweeping up the screen — one fade, and the stylesheet owns
 * it (the "Light scenes" block at the end of style.css). This file only says
 * which tone the screen is in, by setting `tone-light` on <html>.
 *
 * <html> rather than the section, because the nav is fixed over every section
 * and has to change with whichever one it is floating over.
 *
 * WHERE THE LINE IS
 *
 * The tone belongs to whichever section is crossing a line 65% of the way down
 * the screen — so a section takes over once it fills the bottom third, in
 * either direction. Earlier than halfway on purpose: the disciplines deck plays
 * its entrance when 35% of the deck is on screen, and lighting the section at
 * the midpoint left that entrance playing in the dark.
 *
 * ScrollTrigger rather than an observer, because the hero's pin inserts 1500px
 * of spacer above every one of these sections, and ScrollTrigger is what
 * re-measures them when it does.
 * ====================================================================== */

const LINE = '65%';

/*
 * The nav's line is its own: the middle of the bar, not the 65% line. On that
 * one it turned dark the moment a white scene filled the bottom third — while
 * it was still floating over the dark scene above, ink on black, for most of a
 * screen of scroll.
 */
const NAV_LINE = '36px';

/*
 * One class on <html>, held while any section crosses `line`.
 *
 * Sections are disjoint, so at most one is ever active; a count rather than a
 * boolean means two toggles landing in the same refresh cannot leave the page
 * in the wrong state, whatever order they arrive in.
 */
function holdWhileCrossing(sections, line, className) {
  const root = document.documentElement;
  let active = 0;
  sections.forEach((section) => {
    ScrollTrigger.create({
      trigger: section,
      start: `top ${line}`,
      end: `bottom ${line}`,
      onToggle(self) {
        active = Math.max(0, active + (self.isActive ? 1 : -1));
        root.classList.toggle(className, active > 0);
      },
    });
  });
}

export function initTone() {
  const sections = document.querySelectorAll('[data-tone="light"]');
  if (!sections.length) return;

  holdWhileCrossing(sections, LINE, 'tone-light');
  holdWhileCrossing(sections, NAV_LINE, 'nav-light');

  /* Last: the stylesheet only draws the dark state once this is set, so a page
     whose script never got here is simply white rather than veiled for good. */
  document.documentElement.classList.add('tone-ready');
}
