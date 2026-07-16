/**
 * LAVS HTTP Executor
 *
 * Executes http handlers by proxying requests to a remote HTTP endpoint.
 * Used when an endpoint should delegate to an external REST API rather than
 * a local script or an in-process function.
 */

import {
  HTTPHandler,
  ExecutionContext,
  LAVSError,
  LAVSErrorCode,
} from './types';

export class HttpExecutor {
  /**
   * Execute an HTTP handler
   * @param handler - HTTP handler configuration
   * @param input - Input data sent as the request body for non-GET/HEAD methods
   * @param context - Execution context with permissions and timeout
   * @returns Parsed JSON response body (falls back to raw text if not JSON)
   */
  async execute(
    handler: HTTPHandler,
    input: any,
    context: ExecutionContext
  ): Promise<any> {
    const startTime = Date.now();
    console.log(`[LAVS] Executing HTTP handler for ${context.endpointId}`, {
      url: handler.url,
      method: handler.method,
    });

    // 1. Resolve timeout (compatible with script/function executors)
    const timeout =
      handler.timeout ||
      context.timeout ||
      context.permissions.maxExecutionTime ||
      30000;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const method = (handler.method || 'GET').toUpperCase();
      const isBodyMethod = method !== 'GET' && method !== 'HEAD';

      const headers: Record<string, string> = { ...(handler.headers || {}) };
      if (isBodyMethod && input !== undefined && input !== null) {
        headers['Content-Type'] = headers['Content-Type'] || 'application/json';
      }

      const init: RequestInit = {
        method,
        headers,
        signal: controller.signal,
      };

      if (isBodyMethod) {
        init.body = typeof input === 'string' ? input : JSON.stringify(input ?? {});
      }

      let response: Response;
      try {
        response = await fetch(handler.url, init);
      } catch (fetchError: any) {
        if (fetchError?.name === 'AbortError') {
          throw new LAVSError(
            LAVSErrorCode.Timeout,
            `HTTP request timeout after ${timeout}ms`
          );
        }
        throw new LAVSError(
          LAVSErrorCode.HandlerError,
          `HTTP request failed: ${fetchError?.message || String(fetchError)}`,
          { cause: fetchError }
        );
      }

      const text = await response.text();

      if (!response.ok) {
        throw new LAVSError(
          LAVSErrorCode.HandlerError,
          `HTTP ${response.status} ${response.statusText} from ${handler.url}`,
          { status: response.status, statusText: response.statusText, body: text }
        );
      }

      const duration = Date.now() - startTime;
      console.log(`[LAVS] HTTP completed in ${duration}ms`, {
        endpointId: context.endpointId,
        status: response.status,
      });

      return this.parseBody(text);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Parse response body. Try JSON first; fall back to raw text.
   */
  private parseBody(text: string): any {
    const trimmed = (text || '').trim();
    if (!trimmed) return null;
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }
}
