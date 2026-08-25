import { describe, it, expect } from "vitest";
import { isGmailAddress } from "@/lib/email";

describe("isGmailAddress", () => {
  it("accepts a gmail address", () => {
    expect(isGmailAddress("someone@gmail.com")).toBe(true);
  });

  it("is case-insensitive on the domain", () => {
    expect(isGmailAddress("Someone@GMAIL.com")).toBe(true);
  });

  it("rejects other domains", () => {
    expect(isGmailAddress("someone@example.com")).toBe(false);
  });

  it("rejects a domain that merely ends in gmail.com", () => {
    expect(isGmailAddress("someone@notgmail.com")).toBe(false);
  });

  it("rejects malformed input", () => {
    expect(isGmailAddress("someone")).toBe(false);
    expect(isGmailAddress("")).toBe(false);
    expect(isGmailAddress("a b@gmail.com")).toBe(false);
  });
});
