import { describe, expect, it } from "vitest";
import { classifyIntent, extractKeywords, getRetrievalProfile } from "../../src/core/context-retrieval";

describe("context retrieval helpers", () => {
  it("returns expected retrieval profile defaults", () => {
    expect(getRetrievalProfile("economy")).toEqual({ maxBundles: 2, maxContextChars: 4500 });
    expect(getRetrievalProfile("balanced")).toEqual({ maxBundles: 5, maxContextChars: 12000 });
    expect(getRetrievalProfile("quality")).toEqual({ maxBundles: 10, maxContextChars: 28000 });
  });

  it("classifies intents deterministically", () => {
    expect(classifyIntent("please fix auth bug in login flow")).toBe("bug_fix");
    expect(classifyIntent("add new endpoint for profile export")).toBe("feature");
    expect(classifyIntent("refactor this module for readability")).toBe("refactor");
    expect(classifyIntent("write integration test for billing")).toBe("testing");
    expect(classifyIntent("explain routing architecture")).toBe("general");
  });

  it("extracts stable keywords and removes duplicates", () => {
    const terms = extractKeywords("routing routing routing auth auth payment module");
    expect(terms).toEqual(["routing", "auth", "module", "payment"]);
  });
});
