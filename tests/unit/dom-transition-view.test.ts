import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { DomTransitionView } from '../../src/transition/dom-transition-view';

interface Fixture {
  dom: JSDOM;
  list: HTMLElement;
  source: HTMLButtonElement;
  otherSource: HTMLButtonElement;
  detail: HTMLElement;
  heading: HTMLHeadingElement;
  fallback: HTMLButtonElement;
  renderDetail: ReturnType<typeof vi.fn>;
}

function createFixture(): Fixture {
  const dom = new JSDOM(`<!doctype html><html><body>
    <section data-list-surface aria-busy="false">
      <button type="button" data-source-id="source-one">Open one</button>
      <button type="button" data-source-id="source-two">Open two</button>
      <button type="button" data-list-focus-fallback tabindex="-1">Back to list</button>
    </section>
    <article data-detail-surface hidden>
      <h2 data-detail-heading tabindex="-1">Hidden detail</h2>
    </article>
  </body></html>`);
  const { document } = dom.window;
  const list = document.querySelector<HTMLElement>('[data-list-surface]');
  const source = document.querySelector<HTMLButtonElement>('[data-source-id="source-one"]');
  const otherSource = document.querySelector<HTMLButtonElement>('[data-source-id="source-two"]');
  const detail = document.querySelector<HTMLElement>('[data-detail-surface]');
  const heading = document.querySelector<HTMLHeadingElement>('[data-detail-heading]');
  const fallback = document.querySelector<HTMLButtonElement>('[data-list-focus-fallback]');

  if (!list || !source || !otherSource || !detail || !heading || !fallback) {
    throw new Error('Fixture DOM contract incomplete');
  }

  return {
    dom,
    list,
    source,
    otherSource,
    detail,
    heading,
    fallback,
    renderDetail: vi.fn(),
  };
}

describe('DomTransitionView', () => {
  let fixture: Fixture;

  beforeEach(() => {
    fixture = createFixture();
  });

  afterEach(() => {
    fixture.dom.window.close();
    vi.restoreAllMocks();
  });

  it('delegates prepareDetail to renderDetail with the exact source id', () => {
    const view = new DomTransitionView({
      list: fixture.list,
      detail: fixture.detail,
      heading: fixture.heading,
      fallback: fixture.fallback,
      renderDetail: fixture.renderDetail,
    });

    view.prepareDetail('source-one');

    expect(fixture.renderDetail).toHaveBeenCalledWith('source-one');
    expect(fixture.renderDetail).toHaveBeenCalledTimes(1);
  });

  it('measures the destination viewport from the detail document window', () => {
    Object.defineProperty(fixture.dom.window, 'innerWidth', { value: 1440, configurable: true });
    Object.defineProperty(fixture.dom.window, 'innerHeight', { value: 900, configurable: true });

    const view = new DomTransitionView({
      list: fixture.list,
      detail: fixture.detail,
      heading: fixture.heading,
      fallback: fixture.fallback,
      renderDetail: fixture.renderDetail,
    });

    expect(view.measureDestination()).toEqual({ left: 0, top: 0, width: 1440, height: 900 });
  });

  it('resolves a matching source descendant by safe dataset scanning', () => {
    const view = new DomTransitionView({
      list: fixture.list,
      detail: fixture.detail,
      heading: fixture.heading,
      fallback: fixture.fallback,
      renderDetail: fixture.renderDetail,
    });

    expect(view.resolveSource('source-one')).toBe(fixture.source);
  });

  it('returns null for selector-significant source ids without throwing', () => {
    const view = new DomTransitionView({
      list: fixture.list,
      detail: fixture.detail,
      heading: fixture.heading,
      fallback: fixture.fallback,
      renderDetail: fixture.renderDetail,
    });

    expect(() => view.resolveSource('bad"selector]')).not.toThrow();
    expect(view.resolveSource('bad"selector]')).toBeNull();
  });

  it('maps source bounding rect measurements', () => {
    vi.spyOn(fixture.source, 'getBoundingClientRect').mockReturnValue({
      left: 12,
      top: 34,
      width: 56,
      height: 78,
      right: 68,
      bottom: 112,
      x: 12,
      y: 34,
      toJSON: () => '',
    });

    const view = new DomTransitionView({
      list: fixture.list,
      detail: fixture.detail,
      heading: fixture.heading,
      fallback: fixture.fallback,
      renderDetail: fixture.renderDetail,
    });

    expect(view.measureSource(fixture.source)).toEqual({ left: 12, top: 34, width: 56, height: 78 });
  });

  it('updates detail clip path and visibility/inert/busy state', () => {
    const view = new DomTransitionView({
      list: fixture.list,
      detail: fixture.detail,
      heading: fixture.heading,
      fallback: fixture.fallback,
      renderDetail: fixture.renderDetail,
    });

    view.setDetailClip('inset(0 round 20px)');
    view.setListVisible(false);
    view.setDetailVisible(true);
    view.setDetailInert(false);
    view.setBusy(true);

    expect(fixture.detail.style.clipPath).toBe('inset(0 round 20px)');
    expect(fixture.list.hidden).toBe(true);
    expect(fixture.detail.hidden).toBe(false);
    expect(fixture.detail.inert).toBe(false);
    expect(fixture.list.inert).toBe(true);
    expect(fixture.list.getAttribute('aria-busy')).toBe('true');
    expect(fixture.detail.dataset.transitionBusy).toBe('true');
  });

  it('toggles only the requested source hidden marker', () => {
    const view = new DomTransitionView({
      list: fixture.list,
      detail: fixture.detail,
      heading: fixture.heading,
      fallback: fixture.fallback,
      renderDetail: fixture.renderDetail,
    });

    view.setSourceHidden(fixture.source, true);

    expect(fixture.source.dataset.transitionHidden).toBe('true');
    expect(fixture.otherSource.dataset.transitionHidden).toBeUndefined();

    view.setSourceHidden(fixture.source, false);

    expect(fixture.source.dataset.transitionHidden).toBeUndefined();
    expect(fixture.otherSource.dataset.transitionHidden).toBeUndefined();
  });

  it('freezes and restores scroll idempotently while preserving prior inline body styles', () => {
    fixture.dom.window.document.body.style.position = 'relative';
    fixture.dom.window.document.body.style.top = '7px';
    fixture.dom.window.document.body.style.width = '90%';
    Object.defineProperty(fixture.dom.window, 'scrollY', { value: 275, configurable: true });
    const scrollTo = vi.fn();
    Object.defineProperty(fixture.dom.window, 'scrollTo', { value: scrollTo, configurable: true });

    const view = new DomTransitionView({
      list: fixture.list,
      detail: fixture.detail,
      heading: fixture.heading,
      fallback: fixture.fallback,
      renderDetail: fixture.renderDetail,
    });

    view.freezeScroll();
    view.freezeScroll();

    expect(fixture.dom.window.document.body.style.position).toBe('fixed');
    expect(fixture.dom.window.document.body.style.top).toBe('-275px');
    expect(fixture.dom.window.document.body.style.width).toBe('100%');

    view.restoreScroll();
    view.restoreScroll();

    expect(fixture.dom.window.document.body.style.position).toBe('relative');
    expect(fixture.dom.window.document.body.style.top).toBe('7px');
    expect(fixture.dom.window.document.body.style.width).toBe('90%');
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith(0, 275);
  });

  it('focuses the detail heading and list fallback elements', () => {
    const view = new DomTransitionView({
      list: fixture.list,
      detail: fixture.detail,
      heading: fixture.heading,
      fallback: fixture.fallback,
      renderDetail: fixture.renderDetail,
    });

    view.focusDetailHeading();
    expect(fixture.dom.window.document.activeElement).toBe(fixture.heading);

    view.focusListFallback();
    expect(fixture.dom.window.document.activeElement).toBe(fixture.fallback);
  });
});
