/**
 * Token bucket rate limiter for Telegram API calls.
 *
 * Telegram limits groups to 30 msgs/sec. We use 25/sec as a safety margin.
 * Messages are queued when the bucket is empty and drained as tokens refill.
 * On 429 (Too Many Requests), we pause for the retry_after period.
 */

const DEFAULT_RATE = 25; // tokens per second
const DEFAULT_BURST = 25; // max burst size

interface PendingMessage<T> {
  execute: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

export class RateLimiter {
  private tokens: number;
  private readonly maxTokens: number;
  private readonly refillRate: number; // tokens per ms
  private lastRefill: number;
  private queue: PendingMessage<unknown>[] = [];
  private draining = false;
  private retryAfterUntil = 0; // timestamp when retry-after expires

  constructor(rate = DEFAULT_RATE, burst = DEFAULT_BURST) {
    this.maxTokens = burst;
    this.tokens = burst;
    this.refillRate = rate / 1000;
    this.lastRefill = Date.now();
  }

  /** Refill tokens based on elapsed time */
  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }

  /** How long (ms) until we can send the next message */
  private msUntilReady(): number {
    const now = Date.now();

    // If we're in a retry-after window, wait for that
    if (now < this.retryAfterUntil) {
      return this.retryAfterUntil - now;
    }

    this.refill();
    if (this.tokens >= 1) return 0;

    // Time until 1 token is available
    return Math.ceil((1 - this.tokens) / this.refillRate);
  }

  /** Notify the limiter of a 429 response with retry_after seconds */
  notifyRetryAfter(retryAfterSecs: number): void {
    const until = Date.now() + retryAfterSecs * 1000;
    this.retryAfterUntil = Math.max(this.retryAfterUntil, until);
    this.tokens = 0;
    console.log(
      `[rate-limiter] 429 received, pausing for ${retryAfterSecs}s`,
    );
  }

  /**
   * Schedule an async operation through the rate limiter.
   * Returns a promise that resolves with the operation's result.
   */
  schedule<T>(execute: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        execute,
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      this.drain();
    });
  }

  /** Drain the queue, respecting rate limits */
  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;

    try {
      while (this.queue.length > 0) {
        const waitMs = this.msUntilReady();
        if (waitMs > 0) {
          await sleep(waitMs);
        }

        this.refill();
        if (this.tokens < 1) continue; // recheck after sleep

        const item = this.queue.shift()!;
        this.tokens -= 1;

        try {
          const result = await item.execute();
          item.resolve(result);
        } catch (err) {
          item.reject(err);
        }
      }
    } finally {
      this.draining = false;
    }
  }

  /** Current queue depth (for observability) */
  get pending(): number {
    return this.queue.length;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Shared singleton rate limiter for all Telegram outbound calls */
export const telegramLimiter = new RateLimiter();
