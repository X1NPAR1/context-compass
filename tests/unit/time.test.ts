import { describe, expect, it, vi } from "vitest";
import { timeAgo } from "../../src/utils/time";

describe("timeAgo", () => {
  it("formats compact values", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-08T12:00:00Z"));

    expect(timeAgo(Date.parse("2026-04-08T11:59:40Z"), "compact")).toBe("az önce");
    expect(timeAgo(Date.parse("2026-04-08T11:30:00Z"), "compact")).toBe("30dk önce");
    expect(timeAgo(Date.parse("2026-04-08T10:00:00Z"), "compact")).toBe("2sa önce");
    expect(timeAgo(Date.parse("2026-04-06T12:00:00Z"), "compact")).toBe("2g önce");

    vi.useRealTimers();
  });

  it("formats long values", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-08T12:00:00Z"));

    expect(timeAgo(Date.parse("2026-04-08T11:59:40Z"), "long")).toBe("az önce");
    expect(timeAgo(Date.parse("2026-04-08T11:00:00Z"), "long")).toBe("1 saat önce");
    expect(timeAgo(Date.parse("2026-04-08T10:00:00Z"), "long")).toBe("2 saat önce");
    expect(timeAgo(Date.parse("2026-04-05T12:00:00Z"), "long")).toBe("3 gün önce");

    vi.useRealTimers();
  });
});
