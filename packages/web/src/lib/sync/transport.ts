export type Transport = "sse" | "poll";

interface ConnectionLike {
  type?: string | undefined;
}

/**
 * Unknown counts as cellular. Connection type is unreliable on iOS Safari, and
 * the conservative default only costs liveness — the cursor/fold path is identical
 * either way, so a mis-detection never costs correctness.
 */
export function pickTransport(connection: ConnectionLike | undefined): Transport {
  const type = connection?.type;
  return type === "wifi" || type === "ethernet" ? "sse" : "poll";
}

/**
 * The Network Information API (`navigator.connection`) is Chromium-only and
 * absent on Safari/iOS entirely — reading it defensively through an unknown
 * cast rather than assuming the type exists is what keeps this callable
 * everywhere without a runtime check at every call site.
 */
export function currentConnection(): ConnectionLike | undefined {
  return (navigator as unknown as { connection?: ConnectionLike }).connection;
}
