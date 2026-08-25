import { describe, it, expect } from "vitest";
import { pickTransport } from "@/lib/sync/transport";

describe("pickTransport", () => {
  it("uses SSE on wifi", () => {
    expect(pickTransport({ type: "wifi" })).toBe("sse");
  });

  it("polls on cellular", () => {
    expect(pickTransport({ type: "cellular" })).toBe("poll");
  });

  // The vision's iOS Safari caveat: mis-detection must cost liveness, never data.
  it("polls when the connection type is unknown", () => {
    expect(pickTransport({ type: "unknown" })).toBe("poll");
  });

  it("polls when the Network Information API is absent entirely", () => {
    expect(pickTransport(undefined)).toBe("poll");
  });

  it("treats ethernet like wifi", () => {
    expect(pickTransport({ type: "ethernet" })).toBe("sse");
  });
});
