/** Length of the circular reveal. Short: operators should never wait on it. */
const REVEAL_MS = 450;

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => { ready: Promise<void> };
};

/**
 * Applies a theme change. Where the View Transitions API is available and the person has not asked
 * for reduced motion, the NEW theme is revealed as a circle growing from `origin` (the toggle
 * button) until it covers the window. Otherwise the change is instant. `update` must change the
 * DOM synchronously; it always runs exactly once.
 */
export function revealThemeChange(origin: HTMLElement | null, update: () => void): void {
  const doc = document as ViewTransitionDocument;
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  if (!origin || reduceMotion || typeof doc.startViewTransition !== 'function') {
    update();
    return;
  }

  // From the button's centre (also right for keyboard activation, which has no pointer position).
  const box = origin.getBoundingClientRect();
  const x = box.left + box.width / 2;
  const y = box.top + box.height / 2;
  const radius = Math.hypot(
    Math.max(x, window.innerWidth - x),
    Math.max(y, window.innerHeight - y),
  );

  let transition: { ready: Promise<void> };
  try {
    transition = doc.startViewTransition(update);
  } catch {
    update();
    return;
  }
  transition.ready
    .then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        {
          duration: REVEAL_MS,
          easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
          pseudoElement: '::view-transition-new(root)',
        },
      );
    })
    .catch(() => {
      // Transition skipped (e.g. another one started): the theme is already applied.
    });
}
