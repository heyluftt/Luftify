const DEFAULT_INTENT_LIFETIME_MS = 30_000;

export type DeferredPlaybackIntent =
  | { kind: "uri"; uri: string; createdAtMs: number; expiresAtMs: number }
  | { kind: "context"; contextUri: string; trackUri: string; createdAtMs: number; expiresAtMs: number };

type Listener = () => void;

/**
 * Holds at most one user playback choice while Spotify is still connecting.
 * A newer click replaces the older one, and an expired choice is never replayed.
 */
export class DeferredPlaybackIntentCoordinator {
  private pending: DeferredPlaybackIntent | undefined;
  private expiryTimer: ReturnType<typeof globalThis.setTimeout> | undefined;
  private readonly listeners = new Set<Listener>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly lifetimeMs = DEFAULT_INTENT_LIFETIME_MS,
  ) {}

  enqueueUri(uri: string): void {
    const createdAtMs = this.now();
    this.replace({ kind: "uri", uri, createdAtMs, expiresAtMs: createdAtMs + this.lifetimeMs });
  }

  enqueueContext(contextUri: string, trackUri: string): void {
    const createdAtMs = this.now();
    this.replace({ kind: "context", contextUri, trackUri, createdAtMs, expiresAtMs: createdAtMs + this.lifetimeMs });
  }

  take(): DeferredPlaybackIntent | undefined {
    const intent = this.pending;
    this.clear();
    return intent && intent.expiresAtMs > this.now() ? intent : undefined;
  }

  clear(): void {
    if (!this.pending && this.expiryTimer === undefined) return;
    this.pending = undefined;
    if (this.expiryTimer !== undefined) globalThis.clearTimeout(this.expiryTimer);
    this.expiryTimer = undefined;
    this.emit();
  }

  getPendingKey = (): string | undefined => {
    if (!this.pending || this.pending.expiresAtMs <= this.now()) return undefined;
    return this.pending.kind === "uri"
      ? this.pending.uri
      : `${this.pending.contextUri}|${this.pending.trackUri}`;
  };

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private replace(intent: DeferredPlaybackIntent): void {
    if (this.expiryTimer !== undefined) globalThis.clearTimeout(this.expiryTimer);
    this.pending = intent;
    this.expiryTimer = globalThis.setTimeout(() => {
      if (this.pending?.createdAtMs === intent.createdAtMs) this.clear();
    }, Math.max(0, intent.expiresAtMs - this.now()));
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

export const deferredPlaybackIntent = new DeferredPlaybackIntentCoordinator();
