/**
 * Tests for SubscriptionManager
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SubscriptionManager, SubscriptionEvent } from './subscription-manager';

/**
 * Create a mock Express Response for SSE testing
 */
function createMockResponse() {
  const chunks: string[] = [];
  let writableEnded = false;
  const closeListeners: (() => void)[] = [];

  return {
    writeHead: vi.fn(),
    write: vi.fn((chunk: string) => {
      if (!writableEnded) chunks.push(chunk);
    }),
    end: vi.fn(() => {
      writableEnded = true;
      closeListeners.forEach((fn) => fn());
    }),
    on: vi.fn((event: string, fn: () => void) => {
      if (event === 'close') closeListeners.push(fn);
    }),
    get writableEnded() {
      return writableEnded;
    },
    get chunks() {
      return chunks;
    },
    simulateClose: () => {
      writableEnded = true;
      closeListeners.forEach((fn) => fn());
    },
  };
}

type MockResponse = ReturnType<typeof createMockResponse>;

describe('SubscriptionManager', () => {
  let manager: SubscriptionManager;

  beforeEach(() => {
    // Use short heartbeat interval for tests, max 5 subscriptions for limit tests
    manager = new SubscriptionManager({
      maxSubscriptions: 5,
      heartbeatIntervalMs: 100,
    });
  });

  afterEach(() => {
    manager.destroy();
  });

  // ─── subscribe ───────────────────────────────────────────

  describe('subscribe', () => {
    it('should create a subscription and return subscription ID', () => {
      const res = createMockResponse() as any;
      const id = manager.subscribe('agent-1', 'endpoint-watch', res);

      expect(id).toBeDefined();
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
      expect(manager.getActiveCount()).toBe(1);
    });

    it('should set SSE headers on response', () => {
      const res = createMockResponse() as any;
      manager.subscribe('agent-1', 'endpoint-watch', res);

      expect(res.writeHead).toHaveBeenCalledWith(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Subscription-Id': expect.any(String),
      });
    });

    it('should send initial connected event', () => {
      const res = createMockResponse() as any;
      const id = manager.subscribe('agent-1', 'endpoint-watch', res);

      const written = res.chunks.join('');
      expect(written).toContain('event: connected');
      expect(written).toContain(id);
      expect(written).toContain('agent-1');
      expect(written).toContain('endpoint-watch');
      expect(written).toContain('Subscription active');
    });

    it('should register close handler on response', () => {
      const res = createMockResponse() as any;
      manager.subscribe('agent-1', 'endpoint-watch', res);

      expect(res.on).toHaveBeenCalledWith('close', expect.any(Function));
    });

    it('should throw when max subscriptions reached', () => {
      const responses: MockResponse[] = [];
      for (let i = 0; i < 5; i++) {
        const res = createMockResponse() as any;
        manager.subscribe('agent-1', `endpoint-${i}`, res);
        responses.push(res);
      }

      const res = createMockResponse() as any;
      expect(() => manager.subscribe('agent-1', 'endpoint-extra', res)).toThrow(
        'Maximum subscriptions limit reached (5)'
      );
    });
  });

  // ─── unsubscribe ────────────────────────────────────────

  describe('unsubscribe', () => {
    it('should remove subscription and return true', () => {
      const res = createMockResponse() as any;
      const id = manager.subscribe('agent-1', 'endpoint-watch', res);

      const result = manager.unsubscribe(id);
      expect(result).toBe(true);
      expect(manager.getActiveCount()).toBe(0);
    });

    it('should return false for unknown subscription ID', () => {
      const result = manager.unsubscribe('non-existent-id');
      expect(result).toBe(false);
    });

    it('should send disconnected event before ending', () => {
      const res = createMockResponse() as any;
      const id = manager.subscribe('agent-1', 'endpoint-watch', res);

      manager.unsubscribe(id);

      const written = res.chunks.join('');
      expect(written).toContain('event: disconnected');
      expect(written).toContain('unsubscribed');
      expect(res.end).toHaveBeenCalled();
    });
  });

  // ─── publish ─────────────────────────────────────────────

  describe('publish', () => {
    it('should push event to matching agent+endpoint subscribers', () => {
      const res = createMockResponse() as any;
      manager.subscribe('agent-1', 'endpoint-watch', res);

      const event: SubscriptionEvent = { type: 'item_added', data: { id: 1 } };
      const count = manager.publish('agent-1', 'endpoint-watch', event);

      expect(count).toBe(1);
      const written = res.chunks.join('');
      expect(written).toContain('event: item_added');
      expect(written).toContain('"id":1');
    });

    it('should not push to non-matching agent', () => {
      const res = createMockResponse() as any;
      manager.subscribe('agent-1', 'endpoint-watch', res);

      const count = manager.publish('agent-2', 'endpoint-watch', {
        type: 'item_added',
        data: {},
      });

      expect(count).toBe(0);
    });

    it('should not push to non-matching endpoint', () => {
      const res = createMockResponse() as any;
      manager.subscribe('agent-1', 'endpoint-watch', res);

      const count = manager.publish('agent-1', 'endpoint-other', {
        type: 'item_added',
        data: {},
      });

      expect(count).toBe(0);
    });

    it('should include timestamp in event data', () => {
      const res = createMockResponse() as any;
      manager.subscribe('agent-1', 'endpoint-watch', res);

      manager.publish('agent-1', 'endpoint-watch', {
        type: 'update',
        data: { value: 42 },
      });

      const written = res.chunks.join('');
      expect(written).toMatch(/timestamp.*\d{4}-\d{2}-\d{2}T/);
    });

    it('should use provided timestamp when given', () => {
      const res = createMockResponse() as any;
      manager.subscribe('agent-1', 'endpoint-watch', res);

      manager.publish('agent-1', 'endpoint-watch', {
        type: 'update',
        data: {},
        timestamp: '2025-01-15T12:00:00.000Z',
      });

      const written = res.chunks.join('');
      expect(written).toContain('2025-01-15T12:00:00.000Z');
    });

    it('should remove broken connections on write error', () => {
      const res = createMockResponse() as any;
      manager.subscribe('agent-1', 'endpoint-watch', res);
      res.write.mockImplementationOnce(() => {
        throw new Error('write failed');
      });

      const count = manager.publish('agent-1', 'endpoint-watch', {
        type: 'update',
        data: {},
      });

      expect(count).toBe(0);
      expect(manager.getActiveCount()).toBe(0);
    });

    it('should skip writableEnded connections', () => {
      const res = createMockResponse() as any;
      manager.subscribe('agent-1', 'endpoint-watch', res);
      res.simulateClose();

      const count = manager.publish('agent-1', 'endpoint-watch', {
        type: 'update',
        data: {},
      });

      expect(count).toBe(0);
    });
  });

  // ─── publishToAgent ──────────────────────────────────────

  describe('publishToAgent', () => {
    it('should push event to all subscribers of agent', () => {
      const res1 = createMockResponse() as any;
      const res2 = createMockResponse() as any;
      manager.subscribe('agent-1', 'endpoint-a', res1);
      manager.subscribe('agent-1', 'endpoint-b', res2);

      const count = manager.publishToAgent('agent-1', {
        type: 'broadcast',
        data: { msg: 'hello' },
      });

      expect(count).toBe(2);
      expect(res1.chunks.join('')).toContain('event: broadcast');
      expect(res2.chunks.join('')).toContain('event: broadcast');
    });

    it('should not push to other agents', () => {
      const res = createMockResponse() as any;
      manager.subscribe('agent-1', 'endpoint-watch', res);

      const count = manager.publishToAgent('agent-2', {
        type: 'broadcast',
        data: {},
      });

      expect(count).toBe(0);
    });
  });

  // ─── getActiveCount ──────────────────────────────────────

  describe('getActiveCount', () => {
    it('should return 0 when no subscriptions', () => {
      expect(manager.getActiveCount()).toBe(0);
    });

    it('should return correct count', () => {
      const res1 = createMockResponse() as any;
      const res2 = createMockResponse() as any;
      manager.subscribe('agent-1', 'ep-1', res1);
      manager.subscribe('agent-1', 'ep-2', res2);

      expect(manager.getActiveCount()).toBe(2);
    });
  });

  // ─── getSubscriptionsForAgent ─────────────────────────────

  describe('getSubscriptionsForAgent', () => {
    it('should return empty array when no subscriptions', () => {
      expect(manager.getSubscriptionsForAgent('agent-1')).toEqual([]);
    });

    it('should return subscriptions for agent', () => {
      const res1 = createMockResponse() as any;
      const res2 = createMockResponse() as any;
      const id1 = manager.subscribe('agent-1', 'ep-a', res1);
      const id2 = manager.subscribe('agent-1', 'ep-b', res2);
      manager.subscribe('agent-2', 'ep-c', createMockResponse() as any);

      const subs = manager.getSubscriptionsForAgent('agent-1');
      expect(subs).toHaveLength(2);
      expect(subs.map((s) => s.id).sort()).toEqual([id1, id2].sort());
      expect(subs.map((s) => s.endpointId).sort()).toEqual(['ep-a', 'ep-b']);
      subs.forEach((s) => {
        expect(s.createdAt).toBeGreaterThan(0);
      });
    });

    it('should not include other agents', () => {
      manager.subscribe('agent-2', 'ep-x', createMockResponse() as any);

      expect(manager.getSubscriptionsForAgent('agent-1')).toEqual([]);
    });
  });

  // ─── destroy ──────────────────────────────────────────────

  describe('destroy', () => {
    it('should clear all subscriptions', () => {
      const res = createMockResponse() as any;
      manager.subscribe('agent-1', 'endpoint-watch', res);

      manager.destroy();

      expect(manager.getActiveCount()).toBe(0);
      expect(res.end).toHaveBeenCalled();
    });

    it('should stop heartbeat timer', () => {
      manager.destroy();
      // Calling destroy again should not throw
      manager.destroy();
    });
  });

  // ─── close handler cleanup ─────────────────────────────────

  describe('client disconnect', () => {
    it('should unsubscribe when client closes connection', () => {
      const res = createMockResponse() as any;
      manager.subscribe('agent-1', 'endpoint-watch', res);

      expect(manager.getActiveCount()).toBe(1);

      // Simulate client disconnect (triggers close handler)
      res.simulateClose();

      expect(manager.getActiveCount()).toBe(0);
    });
  });
});
