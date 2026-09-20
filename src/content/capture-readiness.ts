/**
 * Waiting for adopted content to be worth photographing.
 *
 * `html-to-image` rasterises at a moment in time. If a webfont lands or an image
 * decodes after that moment, the texture on the turning sheet carries different
 * text metrics or blank gaps while the live DOM is correct — the same class of bug
 * as the `<sp-theme>` token detachment that `docs/architecture.md` records, and
 * just as hard to attribute once seen.
 *
 * This runs in the activation path, between adoption and `coordinator.open()`, and
 * never inside the coordinator. Putting an unbounded wait inside `open()` would
 * recreate exactly the long-lived `preparing` state the design rejected.
 *
 * ## Why adoption has to come first
 *
 * The parsed document is inert: nothing in it loads until the fragment is adopted
 * into the live document. So the order is adopt, wait, open, capture — which is why
 * the activation path adopts explicitly rather than leaving it to `prepareDetail`.
 *
 * ## The honest limit
 *
 * At this point the detail surface is still `hidden`, which resolves to
 * `display: none`. Browsers do load `<img>` inside a `display: none` subtree, so the
 * image wait is real. Font loading is **not** reliably triggered by content that
 * has no layout, so `document.fonts.ready` here can resolve without having waited
 * for a face that only the hidden content uses. Today nothing in this project loads
 * a webfont at all, so the guard is forward-looking; a page that brings its own font
 * may still land a frame with fallback metrics. Fixing it properly means measuring
 * after the surface is displayed but still clipped, which lives inside the
 * coordinator's `preparing` step and so is out of scope here.
 */

export interface CaptureReadinessOptions {
  /**
   * Upper bound on the whole wait. When it elapses, proceed anyway: a hung asset
   * should cost the fidelity of one texture, not the activation.
   */
  readonly timeoutMs: number;
  /** Injected for tests, and absent in environments without the Font Loading API. */
  readonly fonts?: FontFaceSet | null;
  /** Injected for tests. */
  readonly setTimeout?: typeof globalThis.setTimeout;
  readonly clearTimeout?: typeof globalThis.clearTimeout;
}

export interface CaptureReadinessResult {
  /** True when the bound elapsed before everything settled. */
  readonly timedOut: boolean;
  /** How many images were waited on, excluding those already complete. */
  readonly imagesAwaited: number;
  /** How many failed to decode. Counted, not fatal. */
  readonly imagesFailed: number;
}

/**
 * Awaits fonts and image decoding for the adopted content, bounded.
 *
 * Total: never throws and never rejects. A failed image, a missing Font Loading
 * API, and an elapsed bound are all ordinary outcomes that report and continue.
 */
export async function awaitCaptureReadiness(
  root: ParentNode,
  options: CaptureReadinessOptions,
): Promise<CaptureReadinessResult> {
  const schedule = options.setTimeout ?? globalThis.setTimeout;
  const cancel = options.clearTimeout ?? globalThis.clearTimeout;

  const images = Array.from(root.querySelectorAll('img'));
  let imagesFailed = 0;
  const pendingImages = images.filter((image) => !image.complete);

  const imageWaits = pendingImages.map(async (image) => {
    try {
      // `decode()` resolves once the image is ready to paint, which is stricter
      // than `load` and is what the rasteriser actually needs.
      await image.decode();
    } catch {
      // A broken image must not cost the transition. The sheet shows the same gap
      // the live page does, which is honest.
      imagesFailed += 1;
    }
  });

  // `fonts.ready` resolves immediately when no face is loading, so this is free in
  // the common case. Guarded because jsdom and older engines may not provide it.
  const fonts = options.fonts === undefined ? globalThis.document?.fonts : options.fonts;
  const fontWait = fonts?.ready ? fonts.ready.then(() => undefined).catch(() => undefined) : null;

  const settled = Promise.all(fontWait ? [...imageWaits, fontWait] : imageWaits).then(() => false);

  let timer: ReturnType<typeof globalThis.setTimeout> | undefined;
  const timedOutAfterBound = new Promise<boolean>((resolveTimeout) => {
    timer = schedule(() => resolveTimeout(true), Math.max(0, options.timeoutMs));
  });

  try {
    const timedOut = await Promise.race([settled, timedOutAfterBound]);
    return { timedOut, imagesAwaited: pendingImages.length, imagesFailed };
  } finally {
    // Always cleared, so a fast settle leaves no timer holding the event loop
    // open — which in a test run shows up as a suite that will not exit.
    if (timer !== undefined) {
      cancel(timer);
    }
  }
}
