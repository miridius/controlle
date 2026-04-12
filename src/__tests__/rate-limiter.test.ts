/**
 * Tests for rate-limiter.ts: RateLimiter token bucket with queue.
 */
import { describe, expect, test } from "bun:test";
import { RateLimiter } from "../rate-limiter";

describe("RateLimiter", () => {
  test("allows burst of messages up to capacity", async () => {
    const limiter = new RateLimiter(100, 5);
    const results: number[] = [];

    // Fire 5 messages — should all execute immediately (within burst)
    const promises = Array.from({ length: 5 }, (_, i) =>
      limiter.schedule(async () => {
        results.push(i);
        return i;
      }),
    );

    const values = await Promise.all(promises);
    expect(values).toEqual([0, 1, 2, 3, 4]);
    expect(results).toEqual([0, 1, 2, 3, 4]);
  });

  test("queues messages beyond burst capacity", async () => {
    const limiter = new RateLimiter(1000, 2); // 2 burst, fast refill
    const order: number[] = [];

    const promises = Array.from({ length: 4 }, (_, i) =>
      limiter.schedule(async () => {
        order.push(i);
        return i;
      }),
    );

    const values = await Promise.all(promises);
    expect(values).toEqual([0, 1, 2, 3]);
    // All executed in order
    expect(order).toEqual([0, 1, 2, 3]);
  });

  test("reports pending queue depth", () => {
    const limiter = new RateLimiter(1, 1);
    expect(limiter.pending).toBe(0);
  });

  test("propagates errors from scheduled functions", async () => {
    const limiter = new RateLimiter(100, 10);

    await expect(
      limiter.schedule(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });

  test("continues processing queue after an error", async () => {
    const limiter = new RateLimiter(100, 10);

    const p1 = limiter.schedule(async () => {
      throw new Error("fail");
    });
    const p2 = limiter.schedule(async () => "ok");

    await expect(p1).rejects.toThrow("fail");
    expect(await p2).toBe("ok");
  });

  test("notifyRetryAfter pauses processing", async () => {
    const limiter = new RateLimiter(100, 10);
    const start = Date.now();

    // Drain initial burst
    await limiter.schedule(async () => "first");

    // Simulate 429 with 0.1s retry
    limiter.notifyRetryAfter(0.1);

    await limiter.schedule(async () => "after-retry");
    const elapsed = Date.now() - start;

    // Should have waited at least ~100ms
    expect(elapsed).toBeGreaterThanOrEqual(80);
  });

  test("rate limits when sustained throughput exceeds rate", async () => {
    // Very low rate to make timing measurable
    const limiter = new RateLimiter(10, 1); // 1 burst, 10/sec = 1 every 100ms
    const start = Date.now();

    // Schedule 3 messages: 1 immediate (burst), 2 queued
    const promises = Array.from({ length: 3 }, (_, i) =>
      limiter.schedule(async () => i),
    );

    await Promise.all(promises);
    const elapsed = Date.now() - start;

    // Should take at least ~200ms for the 2 queued messages
    expect(elapsed).toBeGreaterThanOrEqual(150);
  });
});
