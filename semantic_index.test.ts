import { describe, expect, test } from "vitest";
import { buildEmbeddingText } from "./semantic_index.ts";

describe("buildEmbeddingText", () => {
  test("includes players, ECO, event, summary, and comments", () => {
    const text = buildEmbeddingText(
      {
        white: "Alice",
        black: "Bob",
        eco: "C50",
        event: "Casual Game",
        comments: "Đen mất quân sớm.",
      },
      "Ván đấu sắc bén.",
    );
    expect(text).toContain("Alice");
    expect(text).toContain("Bob");
    expect(text).toContain("C50");
    expect(text).toContain("Casual Game");
    expect(text).toContain("Ván đấu sắc bén.");
    expect(text).toContain("Đen mất quân sớm.");
  });

  test("omits blank segments instead of producing double spaces/empty labels", () => {
    const text = buildEmbeddingText(
      { white: "", black: "", eco: "", event: "", comments: "" },
      "",
    );
    expect(text).toBe("");
  });

  test("works with only players known, no ECO/event/summary/comments", () => {
    const text = buildEmbeddingText(
      { white: "Alice", black: "Bob", eco: "", event: "", comments: "" },
      "",
    );
    expect(text).toBe("Ván cờ giữa Alice và Bob.");
  });
});
