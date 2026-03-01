/**
 * LAVS Client SDK
 *
 * Client library for calling LAVS endpoints from frontend applications.
 */

import { LAVSManifest, LAVSError } from './types';

/**
 * LAVS Client configuration
 */
export interface LAVSClientOptions {
  agentId: string;
  baseURL?: string; // Default: window.location.origin
  projectPath?: string; // Project path for data isolation
}

/**
 * LAVS Client for calling agent endpoints
 */
export class LAVSClient {
  private agentId: string;
  private baseURL: string;
  private projectPath?: string;
  private manifest: LAVSManifest | null = null;

  constructor(options: LAVSClientOptions) {
    this.agentId = options.agentId;
    this.baseURL = options.baseURL || window.location.origin;
    this.projectPath = options.projectPath;

    // Debug logging
    console.log('[LAVSClient] Initialized:', {
      agentId: this.agentId,
      projectPath: this.projectPath,
      hasProjectPath: !!this.projectPath
    });
  }

  /**
   * Get auth token from localStorage
   */
  private getAuthToken(): string | null {
    // Try both possible token keys for compatibility
    return localStorage.getItem('auth_token') || localStorage.getItem('authToken');
  }

  /**
   * Get LAVS manifest for the agent
   */
  async getManifest(): Promise<LAVSManifest> {
    if (this.manifest) {
      return this.manifest;
    }

    const url = `${this.baseURL}/api/agents/${this.agentId}/lavs/manifest`;

    try {
      const token = this.getAuthToken();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch(url, {
        method: 'GET',
        headers,
        credentials: 'include', // Include cookies for auth
      });

      if (!response.ok) {
        const body = await response.json();
        // Handle JSON-RPC error format
        const rpcError = body.error || body;
        throw new LAVSError(
          rpcError.code || -1,
          rpcError.message || rpcError.error || `HTTP ${response.status}: ${response.statusText}`,
          rpcError.data
        );
      }

      const body = await response.json();
      // Unwrap JSON-RPC 2.0 response: { jsonrpc: '2.0', result: manifest }
      this.manifest = body.result ?? body;
      return this.manifest!;
    } catch (error: any) {
      if (error instanceof LAVSError) {
        throw error;
      }
      throw new LAVSError(-1, `Failed to fetch manifest: ${error.message}`);
    }
  }

  /**
   * Call a LAVS endpoint
   *
   * @param endpointId - Endpoint ID from manifest
   * @param input - Input data for the endpoint
   * @returns Endpoint result
   */
  async call<TResult = any>(
    endpointId: string,
    input?: any
  ): Promise<TResult> {
    const url = `${this.baseURL}/api/agents/${this.agentId}/lavs/${endpointId}`;

    try {
      const token = this.getAuthToken();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      // Add projectPath to headers if available
      if (this.projectPath) {
        headers['X-Project-Path'] = this.projectPath;
        console.log('[LAVSClient] Adding X-Project-Path header:', this.projectPath);
      } else {
        console.log('[LAVSClient] No projectPath available');
      }

      const response = await fetch(url, {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify(input || {}),
      });

      if (!response.ok) {
        const body = await response.json();
        // Handle JSON-RPC error format
        const rpcError = body.error || body;
        throw new LAVSError(
          rpcError.code || -1,
          rpcError.message || rpcError.error || `HTTP ${response.status}: ${response.statusText}`,
          rpcError.data
        );
      }

      const body = await response.json();
      // Unwrap JSON-RPC 2.0 response: { jsonrpc: '2.0', result: data }
      return (body.result ?? body) as TResult;
    } catch (error: any) {
      if (error instanceof LAVSError) {
        throw error;
      }
      throw new LAVSError(-1, `Failed to call endpoint: ${error.message}`);
    }
  }

  /**
   * Subscribe to a LAVS subscription endpoint via SSE.
   *
   * Opens a Server-Sent Events connection to the endpoint's /subscribe URL.
   * Returns an unsubscribe function to close the connection.
   *
   * @param endpointId - Subscription endpoint ID from manifest
   * @param callback - Called with event data on each SSE message
   * @param options - Optional: onError handler, onConnected handler
   * @returns Unsubscribe function to close the SSE connection
   */
  subscribe(
    endpointId: string,
    callback: (data: any) => void,
    options?: {
      onError?: (error: Event) => void;
      onConnected?: (subscriptionInfo: any) => void;
    }
  ): () => void {
    const url = `${this.baseURL}/api/agents/${this.agentId}/lavs/${endpointId}/subscribe`;

    const eventSource = new EventSource(url, {
      withCredentials: true,
    });

    // Handle connection established
    eventSource.addEventListener('connected', (event: MessageEvent) => {
      try {
        const info = JSON.parse(event.data);
        console.log('[LAVSClient] SSE connected:', info);
        options?.onConnected?.(info);
      } catch (e) {
        console.warn('[LAVSClient] Failed to parse connected event:', e);
      }
    });

    // Handle data events
    eventSource.addEventListener('data', (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        callback(data);
      } catch (e) {
        console.warn('[LAVSClient] Failed to parse SSE data:', e);
        callback(event.data); // Pass raw data if not JSON
      }
    });

    // Handle heartbeat (keep-alive)
    eventSource.addEventListener('heartbeat', () => {
      // Heartbeat received, connection is alive
    });

    // Handle generic messages (no event type)
    eventSource.onmessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        callback(data);
      } catch {
        callback(event.data);
      }
    };

    // Handle errors
    eventSource.onerror = (event: Event) => {
      console.error('[LAVSClient] SSE error:', event);
      options?.onError?.(event);
    };

    // Return unsubscribe function
    return () => {
      console.log('[LAVSClient] Closing SSE connection for:', endpointId);
      eventSource.close();
    };
  }

  /**
   * Clear manifest cache (force reload on next getManifest)
   */
  clearCache(): void {
    this.manifest = null;
  }
}

/**
 * Interface that view components should implement
 */
export interface LAVSViewComponent extends HTMLElement {
  /**
   * Called when component is mounted
   */
  connectedCallback?(): void;

  /**
   * Set the LAVS client (injected by container)
   */
  setLAVSClient(client: LAVSClient): void;

  /**
   * Optional: receive notifications when agent performs actions
   */
  onAgentAction?(action: any): void;

  /**
   * Called when component is unmounted
   */
  disconnectedCallback?(): void;
}
