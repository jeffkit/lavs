/**
 * LAVS runtime logger.
 *
 * All non-essential diagnostics (tool generation, script execution tracing) go
 * through here so they can be silenced uniformly. Essential output — the JSON
 * result of `lavs call`, errors that cause a non-zero exit — must NOT use this
 * logger, because silencing them would break agents that pipe stdout.
 *
 * Controlled by the `LAVS_QUIET` environment variable (set to "1" to silence).
 * The CLI `--quiet` flag sets this env var before any execution happens.
 */

function isQuiet(): boolean {
  return process.env.LAVS_QUIET === '1';
}

/**
 * Emit a diagnostic message to stderr. Silenced when LAVS_QUIET=1.
 * Use for progress/tracing info that humans find useful but agents don't need.
 */
export function debug(message: string, ...rest: unknown[]): void {
  if (isQuiet()) return;
  console.error(message, ...rest);
}
