import type {
  MotionMode,
  PaperRenderer,
  TransitionDependencies,
  TransitionOpenRequest,
  TransitionState,
  TransitionView,
} from './types';

type Endpoint = 'idle' | 'open';
type Interruption = 'escape' | 'resize' | null;

interface ActiveTransition {
  request: TransitionOpenRequest;
  source: HTMLElement | null;
  renderer: PaperRenderer | null;
  controller: AbortController | null;
  progress: number;
  requestedEndpoint: Endpoint;
  interruption: Interruption;
}

const FULL_CLIP = 'polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)';
const OPEN_SETUP_RECOVERY_ERROR =
  'Paper-turn open setup cleanup failed while preserving the original error.';
const CLOSE_SETUP_RECOVERY_ERROR =
  'Paper-turn close setup cleanup failed while preserving the original error.';

function getErrorName(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('name' in error)) {
    return undefined;
  }

  const { name } = error as { name?: unknown };
  return typeof name === 'string' ? name : undefined;
}

function isAbortError(error: unknown): boolean {
  return getErrorName(error) === 'AbortError';
}

function normalizeProgress(progress: number): number {
  if (!Number.isFinite(progress)) {
    throw new Error('Transition progress must be a finite number');
  }

  return Math.max(0, Math.min(1, progress));
}

export class TransitionCoordinator extends EventTarget {
  public state: TransitionState = 'idle';
  private active: ActiveTransition | null = null;

  public constructor(
    private readonly view: TransitionView,
    private readonly dependencies: TransitionDependencies,
  ) {
    super();
  }

  public async open(request: TransitionOpenRequest): Promise<void> {
    if (this.state !== 'idle') {
      throw new Error(`Cannot open while transition state is ${this.state}`);
    }

    this.setState('preparing');
    let mode: MotionMode;
    try {
      this.view.setBusy(true);
      this.view.freezeScroll();
      this.view.prepareDetail(request.sourceId);
      this.view.setDetailVisible(true);
      this.view.setDetailInert(true);

      const source = this.view.resolveSource(request.sourceId);
      if (!source) {
        throw new Error(`Source card no longer exists: ${request.sourceId}`);
      }

      this.active = {
        request,
        source,
        renderer: null,
        controller: null,
        progress: 0,
        requestedEndpoint: 'open',
        interruption: null,
      };

      mode = this.dependencies.selectMotionMode();
    } catch (error) {
      this.recoverOpenSetupFailure(error);
      throw error;
    }

    await this.runTransition('open', mode);
  }

  public async close(): Promise<void> {
    if (this.state !== 'open' || !this.active) {
      throw new Error(`Cannot close while transition state is ${this.state}`);
    }

    let mode: MotionMode;
    try {
      this.active.requestedEndpoint = 'idle';
      this.active.interruption = null;
      this.active.source = this.view.resolveSource(this.active.request.sourceId);
      this.view.setBusy(true);
      this.view.setDetailInert(true);
      this.view.setListVisible(true);

      mode = this.dependencies.selectMotionMode();
    } catch (error) {
      this.recoverCloseSetupFailure(error);
      throw error;
    }

    await this.runTransition('close', mode);
  }

  public cancel(): void {
    if (!this.active || (this.state !== 'opening' && this.state !== 'closing')) {
      return;
    }

    this.active.interruption = 'escape';
    this.active.requestedEndpoint = this.active.progress >= 0.5 ? 'open' : 'idle';
    this.active.controller?.abort();
  }

  public handleViewportChange(): void {
    if (!this.active || (this.state !== 'opening' && this.state !== 'closing')) {
      return;
    }

    this.active.interruption = 'resize';
    this.active.controller?.abort();
  }

  private async runTransition(direction: 'open' | 'close', preferredMode: MotionMode): Promise<void> {
    this.setState(direction === 'open' ? 'opening' : 'closing');

    const active = this.requireActive();
    if (preferredMode === 'fallback' || !active.source) {
      await this.runFallbackTo(active.requestedEndpoint);
      return;
    }

    try {
      await this.runFull(direction);
      if (this.requireActive().requestedEndpoint === 'open') {
        this.settleOpen();
      } else {
        this.settleIdle();
      }
    } catch (error) {
      const interruption = this.requireActive().interruption;

      if (isAbortError(error)) {
        if (interruption) {
          await this.runFallbackTo(this.requireActive().requestedEndpoint);
          return;
        }

        if (direction === 'open') {
          this.settleIdle(true);
        } else {
          this.settleOpen();
        }
        throw error;
      }

      console.error('Paper-turn full motion failed; using fallback.', error);
      await this.runFallbackTo(this.requireActive().requestedEndpoint);
    }
  }

  private async runFull(direction: 'open' | 'close'): Promise<void> {
    const active = this.requireActive();
    if (!active.source) {
      throw new Error('Full motion requires a source card');
    }

    const controller = new AbortController();
    active.controller = controller;

    const sourceRect = this.view.measureSource(active.source);
    const destinationRect = this.view.measureDestination();
    const texture = await this.dependencies.capture(active.source, this.dependencies.profile);

    if (controller.signal.aborted) {
      throw new DOMException('The operation was aborted.', 'AbortError');
    }

    active.renderer = this.dependencies.createRenderer({
      sourceRect,
      destinationRect,
      grabbedCorner: active.request.grabbedCorner,
      texture,
      profile: this.dependencies.profile,
    });
    this.view.setSourceHidden(active.source, true);

    const from = direction === 'open' ? 0 : 1;
    const to = direction === 'open' ? 1 : 0;

    await this.dependencies.animate(
      from,
      to,
      this.dependencies.profile.durationMs,
      (progress) => {
        const current = this.requireActive();
        if (!current.renderer) {
          throw new Error('Renderer missing during transition frame');
        }

        current.progress = normalizeProgress(progress);
        const frame = current.renderer.render(current.progress);
        this.view.setDetailClip(frame.revealClipPath);
      },
      controller.signal,
    );

    this.requireActive().controller = null;
  }

  private async runFallbackTo(endpoint: Endpoint): Promise<void> {
    const active = this.requireActive();

    this.disposeRenderer();
    if (active.source) {
      this.view.setSourceHidden(active.source, false);
    }

    const controller = new AbortController();
    active.controller = controller;

    if (endpoint === 'open') {
      this.view.setDetailClip(FULL_CLIP);
    }

    try {
      await this.dependencies.runFallback(
        endpoint === 'open' ? 'open' : 'close',
        this.dependencies.profile.fallbackDurationMs,
        controller.signal,
      );
    } catch (error) {
      if (!isAbortError(error)) {
        console.error('Paper-turn fallback failed; settling to a stable endpoint.', error);
      }
    } finally {
      if (this.active) {
        this.active.controller = null;
      }
    }

    if ((this.active?.requestedEndpoint ?? endpoint) === 'open') {
      this.settleOpen();
    } else {
      this.settleIdle();
    }
  }

  private settleOpen(): void {
    const active = this.requireActive();

    this.disposeRenderer();
    if (active.source) {
      this.view.setSourceHidden(active.source, false);
    }

    active.controller = null;
    active.interruption = null;
    active.progress = 1;
    this.view.setBusy(false);
    this.view.setDetailClip(FULL_CLIP);
    this.view.setListVisible(false);
    this.view.setDetailVisible(true);
    this.view.setDetailInert(false);
    this.setState('open');
    this.view.focusDetailHeading();
  }

  private settleIdle(skipFocus = false): void {
    const request = this.active?.request ?? null;
    const trigger = request?.trigger ?? null;
    const source = this.active?.source ?? null;

    this.disposeRenderer();
    if (source) {
      this.view.setSourceHidden(source, false);
    }

    if (this.active) {
      this.active.controller = null;
      this.active.interruption = null;
      this.active.progress = 0;
    }

    this.view.setBusy(false);
    this.view.setDetailInert(true);
    this.view.setDetailVisible(false);
    this.view.setListVisible(true);
    this.view.restoreScroll();
    this.active = null;
    this.setState('idle');

    if (!skipFocus) {
      if (trigger?.isConnected) {
        trigger.focus({ preventScroll: true });
      } else {
        const currentSource = request ? this.resolveCurrentSourceForFocus(request.sourceId, source) : source;
        if (currentSource?.isConnected) {
          currentSource.focus({ preventScroll: true });
        } else {
          this.view.focusListFallback();
        }
      }
    }
  }

  private recoverOpenSetupFailure(originalError: unknown): void {
    const source = this.active?.source ?? null;

    this.runSetupRecoveryStep(OPEN_SETUP_RECOVERY_ERROR, originalError, () => this.disposeRenderer());
    if (source) {
      this.runSetupRecoveryStep(OPEN_SETUP_RECOVERY_ERROR, originalError, () =>
        this.view.setSourceHidden(source, false),
      );
    }

    if (this.active) {
      this.active.controller = null;
      this.active.interruption = null;
      this.active.progress = 0;
    }

    this.runSetupRecoveryStep(OPEN_SETUP_RECOVERY_ERROR, originalError, () => this.view.setBusy(false));
    this.runSetupRecoveryStep(OPEN_SETUP_RECOVERY_ERROR, originalError, () => this.view.setDetailInert(true));
    this.runSetupRecoveryStep(OPEN_SETUP_RECOVERY_ERROR, originalError, () => this.view.setDetailVisible(false));
    this.runSetupRecoveryStep(OPEN_SETUP_RECOVERY_ERROR, originalError, () => this.view.setListVisible(true));
    this.runSetupRecoveryStep(OPEN_SETUP_RECOVERY_ERROR, originalError, () => this.view.restoreScroll());
    this.active = null;
    this.runSetupRecoveryStep(OPEN_SETUP_RECOVERY_ERROR, originalError, () => this.setState('idle'));
  }

  private recoverCloseSetupFailure(originalError: unknown): void {
    const source = this.active?.source ?? null;

    this.runSetupRecoveryStep(CLOSE_SETUP_RECOVERY_ERROR, originalError, () => this.disposeRenderer());
    if (source) {
      this.runSetupRecoveryStep(CLOSE_SETUP_RECOVERY_ERROR, originalError, () =>
        this.view.setSourceHidden(source, false),
      );
    }

    if (this.active) {
      this.active.controller = null;
      this.active.interruption = null;
      this.active.progress = 1;
    }

    this.runSetupRecoveryStep(CLOSE_SETUP_RECOVERY_ERROR, originalError, () => this.view.setBusy(false));
    this.runSetupRecoveryStep(CLOSE_SETUP_RECOVERY_ERROR, originalError, () => this.view.setDetailClip(FULL_CLIP));
    this.runSetupRecoveryStep(CLOSE_SETUP_RECOVERY_ERROR, originalError, () => this.view.setListVisible(false));
    this.runSetupRecoveryStep(CLOSE_SETUP_RECOVERY_ERROR, originalError, () => this.view.setDetailVisible(true));
    this.runSetupRecoveryStep(CLOSE_SETUP_RECOVERY_ERROR, originalError, () => this.view.setDetailInert(false));
    this.runSetupRecoveryStep(CLOSE_SETUP_RECOVERY_ERROR, originalError, () => this.setState('open'));
    this.runSetupRecoveryStep(CLOSE_SETUP_RECOVERY_ERROR, originalError, () => this.view.focusDetailHeading());
  }

  private disposeRenderer(): void {
    const renderer = this.active?.renderer ?? null;
    if (this.active) {
      this.active.renderer = null;
    }

    renderer?.dispose();
  }

  private runSetupRecoveryStep(message: string, originalError: unknown, step: () => void): void {
    try {
      step();
    } catch (cleanupError) {
      console.error(message, cleanupError, originalError);
    }
  }

  private resolveCurrentSourceForFocus(sourceId: string, previousSource: HTMLElement | null): HTMLElement | null {
    try {
      return this.view.resolveSource(sourceId);
    } catch {
      return previousSource;
    }
  }

  private requireActive(): ActiveTransition {
    if (!this.active) {
      throw new Error('Missing active transition');
    }

    return this.active;
  }

  private setState(nextState: TransitionState): void {
    if (this.state === nextState) {
      return;
    }

    this.state = nextState;
    this.dispatchEvent(new Event('statechange'));
  }
}
