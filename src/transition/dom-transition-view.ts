import type { Rect, TransitionView } from './types';

export interface DomTransitionViewOptions {
  list: HTMLElement;
  detail: HTMLElement;
  /**
   * Resolves the detail surface's focus target at the moment focus is moved.
   *
   * A function rather than an element because the heading now arrives with the
   * adopted fragment and is a different element after every activation. Capturing
   * one at construction would focus a node that had been replaced.
   */
  heading(): HTMLElement | null;
  fallback: HTMLElement;
  renderDetail(sourceId: string): void;
}

interface FrozenScrollState {
  scrollY: number;
  position: string;
  top: string;
  width: string;
}

function measureRect(rect: DOMRect | DOMRectReadOnly): Rect {
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

function requireWindow(element: HTMLElement): Window {
  const view = element.ownerDocument.defaultView;

  if (!view) {
    throw new Error('Expected element ownerDocument.defaultView to exist');
  }

  return view;
}

export class DomTransitionView implements TransitionView {
  private frozenScrollState: FrozenScrollState | null = null;

  public constructor(private readonly options: DomTransitionViewOptions) {}

  public prepareDetail(sourceId: string): void {
    this.options.renderDetail(sourceId);
  }

  public measureDestination(): Rect {
    const view = requireWindow(this.options.detail);

    return {
      left: 0,
      top: 0,
      width: view.innerWidth,
      height: view.innerHeight,
    };
  }

  public resolveSource(sourceId: string): HTMLElement | null {
    return Array.from(this.options.list.querySelectorAll<HTMLElement>('[data-source-id]')).find(
      (element) => element.dataset.sourceId === sourceId,
    ) ?? null;
  }

  public resolveDestination(): HTMLElement {
    return this.options.detail;
  }

  public measureSource(source: HTMLElement): Rect {
    return measureRect(source.getBoundingClientRect());
  }

  public setDetailClip(clipPath: string): void {
    this.options.detail.style.clipPath = clipPath;
  }

  public setSourceHidden(source: HTMLElement, hidden: boolean): void {
    if (hidden) {
      source.dataset.transitionHidden = 'true';
      return;
    }

    delete source.dataset.transitionHidden;
  }

  public setListVisible(visible: boolean): void {
    this.options.list.hidden = !visible;
  }

  public setDetailVisible(visible: boolean): void {
    this.options.detail.hidden = !visible;
  }

  public setDetailInert(inert: boolean): void {
    this.options.detail.inert = inert;
  }

  public setBusy(busy: boolean): void {
    this.options.list.inert = busy;
    this.options.list.setAttribute('aria-busy', String(busy));
    this.options.detail.dataset.transitionBusy = String(busy);
  }

  public freezeScroll(): void {
    if (this.frozenScrollState) {
      return;
    }

    const view = requireWindow(this.options.list);
    const { body } = this.options.list.ownerDocument;
    this.frozenScrollState = {
      scrollY: view.scrollY,
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
    };
    body.style.position = 'fixed';
    body.style.top = `-${this.frozenScrollState.scrollY}px`;
    body.style.width = '100%';
  }

  public restoreScroll(): void {
    if (!this.frozenScrollState) {
      return;
    }

    const frozen = this.frozenScrollState;
    const view = requireWindow(this.options.list);
    const { body } = this.options.list.ownerDocument;

    body.style.position = frozen.position;
    body.style.top = frozen.top;
    body.style.width = frozen.width;
    this.frozenScrollState = null;
    view.scrollTo(0, frozen.scrollY);
  }

  public focusDetailHeading(): void {
    const heading = this.options.heading();

    if (heading) {
      heading.focus({ preventScroll: true });
      return;
    }

    // The fragment contract guarantees exactly one heading, and adoption happens
    // in `prepareDetail` before the settle step runs, so reaching here means a
    // wiring fault rather than an authoring one. Focus the surface itself instead
    // of leaving focus on the tile, which is about to be hidden and would drop
    // focus to the body.
    console.error(
      'Paper-turn: the adopted detail content has no [data-detail-heading]; focusing the surface instead.',
    );
    this.options.detail.focus({ preventScroll: true });
  }

  public focusListFallback(): void {
    this.options.fallback.focus({ preventScroll: true });
  }
}
