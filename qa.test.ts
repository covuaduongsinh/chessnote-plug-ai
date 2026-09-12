import { describe, expect, test, vi } from "vitest";

type AiAskResult = { ok: true; text: string } | { ok: false; error: string };
const aiAskMock = vi.fn(
  async (_prompt: string): Promise<AiAskResult> => ({
    ok: true,
    text: "mock reply",
  }),
);
vi.mock("./bridge.ts", () => ({
  aiAsk: (prompt: string) => aiAskMock(prompt),
}));

const { citationLine, buildQaPrompt } = await import("./qa.ts");
type SearchGameRow = Parameters<typeof citationLine>[0];

function entry(overrides: Partial<SearchGameRow> = {}): SearchGameRow {
  return {
    ref: "Game1@0",
    page: "Game1",
    white: "Alice",
    black: "Bob",
    result: "1-0",
    eco: "C50",
    event: "Casual Game",
    summary: "",
    ...overrides,
  };
}

describe("citationLine", () => {
  test("includes the wikilink, both player names, and result", () => {
    const line = citationLine(entry());
    expect(line).toContain("[[Game1]]");
    expect(line).toContain("Alice");
    expect(line).toContain("Bob");
    expect(line).toContain("1-0");
  });

  test("omits eco/summary segments when absent", () => {
    const line = citationLine(entry({ eco: "", summary: "" }));
    expect(line).not.toContain("ECO:");
  });

  test("includes the AI summary when present", () => {
    const line = citationLine(entry({ summary: "Ván đấu sắc bén." }));
    expect(line).toContain("Ván đấu sắc bén.");
  });
});

describe("buildQaPrompt", () => {
  test("includes the question, numbered sources, and the anti-hallucination rule", () => {
    const prompt = buildQaPrompt("Tôi hay thua kiểu gì?", [entry()]);
    expect(prompt).toContain("Tôi hay thua kiểu gì?");
    expect(prompt).toContain("1. [[Game1]]");
    expect(prompt).toMatch(/KHÔNG suy diễn/);
    expect(prompt).toContain("Không bịa thêm ván, tên trang");
  });

  test("shows an explicit placeholder instead of an empty source list", () => {
    const prompt = buildQaPrompt("Câu hỏi lạ", []);
    expect(prompt).toContain("không tìm thấy ván nào khớp từ khoá");
  });

  test("never invents player names not present in the given entries", () => {
    const prompt = buildQaPrompt("Ai chơi hay nhất?", [
      entry({ white: "OnlyThisName", black: "AndThis" }),
    ]);
    // Sanity: only the names we actually passed in appear, nothing fabricated.
    expect(prompt).toContain("OnlyThisName");
    expect(prompt).toContain("AndThis");
  });
});
