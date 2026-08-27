import type { Rect, TransitionView } from './types';

export interface DomTransitionViewOptions {
  list: HTMLElement;
  detail: HTMLElement;
  heading: HTMLElement;
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
    this.options.heading.focus({ preventScroll: true });
  }

  public focusListFallback(): void {
    this.options.fallback.focus({ preventScroll: true });
  }
}
