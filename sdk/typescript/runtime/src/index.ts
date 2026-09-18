/**
 * LAVS Runtime - Server-side SDK
 *
 * Re-exports all core runtime modules for convenient importing.
 *
 * @example
 * ```typescript
 * import { ManifestLoader, LAVSValidator, ScriptExecutor } from '@lavs/runtime';
 * ```
 */

// Types (re-export from local types for backward compatibility)
export type {
  LAVSManifest,
  Endpoint,
  Handler,
  ScriptHandler,
  FunctionHandler,
  HTTPHandler,
  MCPHandler,
  Schema,
  JSONSchema,
  TypeDefinitions,
  ViewConfig,
  ComponentSource,
  Permissions,
  ExecutionContext,
} from './types';
export { LAVSError, LAVSErrorCode } from './types';

// Core modules
export { ManifestLoader } from './loader';
export { LAVSValidator } from './validator';
export type { ValidationResult, ValidationError } from './validator';
export { ScriptExecutor } from './script-executor';
export { FunctionExecutor } from './function-executor';
export { HttpExecutor } from './http-executor';
export { McpExecutor } from './mcp-executor';
export { PermissionChecker } from './permission-checker';
export { LAVSRateLimiter } from './rate-limiter';
export type { RateLimitConfig, RateLimitResult } from './rate-limiter';
export { SubscriptionManager, subscriptionManager } from './subscription-manager';
export type { SubscriptionEvent, SSEResponse } from './subscription-manager';
export { LAVSToolGenerator } from './tool-generator';
export type { ClaudeTool, ToolExecutor, GeneratedTool } from './tool-generator';

// MCP Server (standard @modelcontextprotocol/sdk integration)
export { createLAVSMcpServer, connectStdio, getLAVSToolNames } from './mcp-server';

// Embeddable host server (issue #14): use the runtime as a library
export {
  createHostServer,
  createHostHandler,
  discoverBundles,
  discoverBundlesFromDirs,
  buildHostUI,
} from './host-server';
export type {
  LAVSHostOptions,
  LAVSHostServer,
  LAVSHostHandler,
  BundleInfo,
} from './host-server';
export type { HostUIOptions } from './host-ui';
export type { LAVSMcpServerOptions } from './mcp-server';
