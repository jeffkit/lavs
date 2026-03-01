/**
 * Tests for LAVSRateLimiter
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { LAVSRateLimiter } from './rate-limiter';

describe('LAVSRateLimiter', () => {
  let limiter: LAVSRateLimiter;

  beforeEach(() => {
    limiter = new LAVSRateLimiter({
      maxRequests: 3,
      windowMs: 1000,
    });
  });

  // ─── check (happy path) ───────────────────────────────────

  describe('check', () => {
    it('should allow requests within limit', () => {
      const result1 = limiter.check('agent-1:endpoint');
      expect(result1.allowed).toBe(true);
      expect(result1.remaining).toBe(2);
      expect(result1.resetAt).toBeGreaterThan(Date.now());

      const result2 = limiter.check('agent-1:endpoint');
      expect(result2.allowed).toBe(true);
      expect(result2.remaining).toBe(1);

      const result3 = limiter.check('agent-1:endpoint');
      expect(result3.allowed).toBe(true);
      expect(result3.remaining).toBe(0);
    });

    it('should deny requests when limit exceeded', () => {
      limiter.check('agent-1:endpoint');
      limiter.check('agent-1:endpoint');
      limiter.check('agent-1:endpoint');

      const result = limiter.check('agent-1:endpoint');
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.resetAt).toBeGreaterThan(Date.now());
    });

    it('should track keys independently', () => {
      limiter.check('agent-1:ep1');
      limiter.check('agent-1:ep1');
      limiter.check('agent-1:ep1');

      // Different key should still be allowed
      const result = limiter.check('agent-2:ep1');
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(2);

      // Original key should be denied
      const denied = limiter.check('agent-1:ep1');
      expect(denied.allowed).toBe(false);
    });

    it('should use default config when none provided', () => {
      const defaultLimiter = new LAVSRateLimiter();
      const result = defaultLimiter.check('key');
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(59); // 60 - 1
    });

    it('should allow per-key config override', () => {
      const result = limiter.check('agent-1:ep1', { maxRequests: 5 });
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4);

      // Same key with default config - uses key-specific state (count is now 2)
      const result2 = limiter.check('agent-1:ep1');
      expect(result2.remaining).toBe(1); // maxRequests(3) - count(2) = 1
    });
  });

  // ─── check (window expiry) ─────────────────────────────────

  describe('check window expiry', () => {
    it('should start new window when previous expired', async () => {
      limiter.check('key');
      limiter.check('key');
      limiter.check('key');
      const denied = limiter.check('key');
      expect(denied.allowed).toBe(false);

      // Wait for window to expire
      await new Promise((r) => setTimeout(r, 1100));

      const allowed = limiter.check('key');
      expect(allowed.allowed).toBe(true);
      expect(allowed.remaining).toBe(2);
    });
  });

  // ─── reset ────────────────────────────────────────────────

  describe('reset', () => {
    it('should clear rate limit for key', () => {
      limiter.check('key');
      limiter.check('key');
      limiter.check('key');
      expect(limiter.check('key').allowed).toBe(false);

      limiter.reset('key');

      const result = limiter.check('key');
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(2);
    });

    it('should not affect other keys', () => {
      limiter.check('key-a');
      limiter.check('key-a');
      limiter.check('key-a');
      limiter.reset('key-a');

      // key-b was never used, key-a was reset
      const resultA = limiter.check('key-a');
      expect(resultA.allowed).toBe(true);

      const resultB = limiter.check('key-b');
      expect(resultB.allowed).toBe(true);
    });
  });

  // ─── clearAll ─────────────────────────────────────────────

  describe('clearAll', () => {
    it('should clear all rate limit entries', () => {
      limiter.check('key-1');
      limiter.check('key-2');
      limiter.check('key-1');
      limiter.check('key-1');

      limiter.clearAll();

      const result1 = limiter.check('key-1');
      const result2 = limiter.check('key-2');
      expect(result1.allowed).toBe(true);
      expect(result1.remaining).toBe(2);
      expect(result2.allowed).toBe(true);
      expect(result2.remaining).toBe(2);
    });
  });

  // ─── cleanup ──────────────────────────────────────────────

  describe('cleanup', () => {
    it('should remove expired windows', async () => {
      limiter.check('key-1');
      limiter.check('key-2');

      // Wait for windows to expire (cleanup uses 2x windowMs)
      await new Promise((r) => setTimeout(r, 2500));

      limiter.cleanup();

      // Both keys should be gone - new check starts fresh
      const result = limiter.check('key-1');
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(2);
    });

    it('should not remove active windows', () => {
      limiter.check('key-1');
      limiter.cleanup();

      // Window still active - next check should see count
      const result = limiter.check('key-1');
      expect(result.remaining).toBe(1);
    });
  });

  // ─── edge cases ───────────────────────────────────────────

  describe('edge cases', () => {
    it('should handle empty key', () => {
      const result = limiter.check('');
      expect(result.allowed).toBe(true);
    });

    it('should handle reset of non-existent key', () => {
      expect(() => limiter.reset('never-used')).not.toThrow();
    });

    it('should handle clearAll when empty', () => {
      expect(() => limiter.clearAll()).not.toThrow();
    });

    it('should return consistent resetAt within window', () => {
      const r1 = limiter.check('key');
      const r2 = limiter.check('key');
      expect(r1.resetAt).toBe(r2.resetAt);
    });
  });
});
