import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DomTransitionView } from '../../src/transition/dom-transition-view';

interface Fixture {
  list: HTMLElement;
  source: HTMLButtonElement;
  otherSource: HTMLButtonElement;
  detail: HTMLElement;
  heading: HTMLHeadingElement;
  fallback: HTMLButtonElement;
  renderDetail: (sourceId: string) => void;
  renderDetailSpy: ReturnType<typeof vi.fn<(sourceId: string) => void>>;
  windowRef: Window & typeof globalThis;
}

function createFixture(): Fixture {
  const documentRef = document.implementation.createHTMLDocument('task-7');
  const windowRef = {
    innerWidth: 1024,
    innerHeight: 768,
    scrollY: 0,
    scrollTo: () => undefined,
  } as Window & typeof globalThis;
  Object.defineProperty(documentRef, 'defaultView', {
    value: windowRef,
    configurable: true,
  });

  documentRef.body.innerHTML = `
    <section data-list-surface aria-busy="false">
      <button type="button" data-source-id="source-one">Open one</button>
      <button type="button" data-source-id="source-two">Open two</button>
      <button type="button" data-list-focus-fallback tabindex="-1">Back to list</button>
    </section>
    <article data-detail-surface hidden>
      <h2 data-detail-heading tabindex="-1">Hidden detail</h2>
    </article>
  `;

  const list = documentRef.querySelector<HTMLElement>('[data-list-surface]');
  const source = documentRef.querySelector<HTMLButtonElement>('[data-source-id="source-one"]');
  const otherSource = documentRef.querySelector<HTMLButtonElement>('[data-source-id="source-two"]');
  const detail = documentRef.querySelector<HTMLElement>('[data-detail-surface]');
  const heading = documentRef.querySelector<HTMLHeadingElement>('[data-detail-heading]');
  const fallback = documentRef.querySelector<HTMLButtonElement>('[data-list-focus-fallback]');
  const renderDetailSpy = vi.fn<(sourceId: string) => void>();

  if (!list || !source || !otherSource || !detail || !heading || !fallback) {
    throw new Error('Fixture DOM contract incomplete');
  }

  return {
    list,
    source,
    otherSource,
    detail,
    heading,
    fallback,
    renderDetail(sourceId: string) {
      renderDetailSpy(sourceId);
    },
    renderDetailSpy,
    windowRef,
  };
}

describe('DomTransitionView', () => {
  let fixture: Fixture;

  beforeEach(() => {
    fixture = createFixture();
  });

  afterEach(() => {
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

    expect(fixture.renderDetailSpy).toHaveBeenCalledWith('source-one');
    expect(fixture.renderDetailSpy).toHaveBeenCalledTimes(1);
  });

  it('measures the destination viewport from the detail document window', () => {
    fixture.windowRef.innerWidth = 1440;
    fixture.windowRef.innerHeight = 900;

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
    fixture.list.ownerDocument.body.style.position = 'relative';
    fixture.list.ownerDocument.body.style.top = '7px';
    fixture.list.ownerDocument.body.style.width = '90%';
    fixture.windowRef.scrollY = 275;
    const scrollTo = vi.fn();
    fixture.windowRef.scrollTo = scrollTo as typeof fixture.windowRef.scrollTo;

    const view = new DomTransitionView({
      list: fixture.list,
      detail: fixture.detail,
      heading: fixture.heading,
      fallback: fixture.fallback,
      renderDetail: fixture.renderDetail,
    });

    view.freezeScroll();
    view.freezeScroll();

    expect(fixture.list.ownerDocument.body.style.position).toBe('fixed');
    expect(fixture.list.ownerDocument.body.style.top).toBe('-275px');
    expect(fixture.list.ownerDocument.body.style.width).toBe('100%');

    view.restoreScroll();
    view.restoreScroll();

    expect(fixture.list.ownerDocument.body.style.position).toBe('relative');
    expect(fixture.list.ownerDocument.body.style.top).toBe('7px');
    expect(fixture.list.ownerDocument.body.style.width).toBe('90%');
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith(0, 275);
  });

  it('focuses the detail heading and list fallback elements', () => {
    const focusHeading = vi.spyOn(fixture.heading, 'focus');
    const focusFallback = vi.spyOn(fixture.fallback, 'focus');
    const view = new DomTransitionView({
      list: fixture.list,
      detail: fixture.detail,
      heading: fixture.heading,
      fallback: fixture.fallback,
      renderDetail: fixture.renderDetail,
    });

    view.focusDetailHeading();
    expect(focusHeading).toHaveBeenCalledTimes(1);

    view.focusListFallback();
    expect(focusFallback).toHaveBeenCalledTimes(1);
  });
});
