import { describe, expect, test, vi } from "vitest";

type AiAskResult =
  | {
      ok: true;
      text: string;
      model?: string;
    }
  | { ok: false; error: string };
const aiAskMock = vi.fn(
  async (_prompt: string): Promise<AiAskResult> => ({
    ok: true,
    text: "mock reply",
    model: "mock-model",
  }),
);
vi.mock("./bridge.ts", () => ({
  aiAsk: (prompt: string) => aiAskMock(prompt),
}));

const patchFrontmatterMock = vi.fn(
  async (text: string, _patches: unknown) => text,
);
const readPageMock = vi.fn(async (_page: string) => "# Page\n");
const writePageMock = vi.fn(async (_page: string, _text: string) => ({}));
const upsertAiAnnotationMock = vi.fn(async (_annotation: unknown) => {});
const extractFrontMatterMock = vi.fn(async () => ({ tags: [] as string[] }));
vi.mock("@silverbulletmd/silverbullet/syscalls", () => ({
  markdown: { parseMarkdown: (text: string) => ({ type: "Document", text }) },
  space: {
    readPage: (p: string) => readPageMock(p),
    writePage: (p: string, t: string) => writePageMock(p, t),
  },
  system: {
    invokeFunction: (name: string, ...args: unknown[]) =>
      patchFrontmatterMock(args[0] as string, args[1]),
  },
  index: {},
}));
// extractChessGames/extractFrontMatter/upsertAiAnnotation now cross into
// chess-core/index/chess-db via syscalls (external_syscalls.ts) instead of
// direct imports — mock that boundary. extractChessGames uses the real,
// syscall-free implementation (pure chess.js/tree-walking logic).
vi.mock("./external_syscalls.ts", async () => {
  const chessIndex = await import("../chess/index.ts");
  return {
    extractChessGames: (pageName: string, tree: unknown) =>
      Promise.resolve(
        chessIndex.extractChessGames(
          pageName,
          tree as Parameters<typeof chessIndex.extractChessGames>[1],
        ),
      ),
    extractFrontMatter: () => extractFrontMatterMock(),
    upsertAiAnnotation: (annotation: unknown) =>
      upsertAiAnnotationMock(annotation),
  };
});
// extractChessGames() (called by applyTagSuggestion) parses the page tree
// with chess.js for real ```pgn``` blocks — the mocked tree here has none,
// so it always returns []. That's fine: these tests only assert what
// applyTagSuggestion does with the frontmatter/writePage side, not the
// per-game SQL annotation loop (covered manually per the Phase 5b checklist,
// same as the rest of the SQL-backed surface — see chess_pgn_date.ts's
// module comment for why WASM-adjacent logic isn't unit-tested here).

const {
  buildTagSuggestionPrompt,
  parseTagSuggestion,
  suggestTags,
  applyTagSuggestion,
} = await import("./tagging.ts");

function input(
  overrides: Partial<Parameters<typeof buildTagSuggestionPrompt>[0]> = {},
) {
  return {
    white: "Alice",
    black: "Bob",
    result: "1-0",
    eco: "C50",
    event: "Casual Game",
    openingMoves: "e4 e5 Nf3 Nc6",
    ...overrides,
  };
}

describe("buildTagSuggestionPrompt", () => {
  test("includes headers, opening moves, and the strict output format", () => {
    const prompt = buildTagSuggestionPrompt(input());
    expect(prompt).toContain("Alice");
    expect(prompt).toContain("Bob");
    expect(prompt).toContain("C50");
    expect(prompt).toContain("e4 e5 Nf3 Nc6");
    expect(prompt).toContain("TAGS: tag1, tag2, tag3");
    expect(prompt).toContain("TOMTAT: <câu tóm tắt>");
  });

  test("omits empty eco/event lines instead of printing blanks", () => {
    const prompt = buildTagSuggestionPrompt(input({ eco: "", event: "" }));
    expect(prompt).not.toContain("Mã khai cuộc");
    expect(prompt).not.toContain("Giải đấu");
  });
});

describe("parseTagSuggestion", () => {
  test("parses a well-formed response, lowercasing and capping at 4 tags", () => {
    const parsed = parseTagSuggestion(
      "TAGS: Sicilian, Trung-Cuoc, A, B, C\nTOMTAT: Ván đấu sắc bén.",
    );
    expect(parsed).toEqual({
      tags: ["sicilian", "trung-cuoc", "a", "b"],
      summary: "Ván đấu sắc bén.",
    });
  });

  test("returns null when the AI ignores the format entirely", () => {
    expect(
      parseTagSuggestion("Đây là một ván đấu hay, không theo khuôn nào cả."),
    ).toBeNull();
  });

  test("returns null when TAGS is present but TOMTAT is missing", () => {
    expect(parseTagSuggestion("TAGS: sicilian, blunder")).toBeNull();
  });

  test("returns null when tags list is empty after trimming", () => {
    expect(parseTagSuggestion("TAGS:   ,  \nTOMTAT: Tóm tắt.")).toBeNull();
  });
});

describe("suggestTags — thin pass-through with strict parsing", () => {
  test("returns parsed tags/summary when aiAsk succeeds with a well-formed reply", async () => {
    aiAskMock.mockClear();
    aiAskMock.mockResolvedValueOnce({
      ok: true,
      text: "TAGS: sicilian, blunder\nTOMTAT: Đen mất quân sớm.",
      model: "claude-haiku-4-5",
    });
    const result = await suggestTags(input());
    expect(aiAskMock).toHaveBeenCalledTimes(1);
    expect(aiAskMock.mock.calls[0][0]).toBe(buildTagSuggestionPrompt(input()));
    expect(result).toEqual({
      ok: true,
      tags: ["sicilian", "blunder"],
      summary: "Đen mất quân sớm.",
      model: "claude-haiku-4-5",
    });
  });

  test("surfaces aiAsk's own error verbatim without attempting to parse", async () => {
    aiAskMock.mockClear();
    aiAskMock.mockResolvedValueOnce({ ok: false, error: "sidecar down" });
    const result = await suggestTags(input());
    expect(result).toEqual({ ok: false, error: "sidecar down" });
  });

  test("reports a parse error instead of guessing when the format is wrong", async () => {
    aiAskMock.mockClear();
    aiAskMock.mockResolvedValueOnce({ ok: true, text: "Ván này khá hay đấy." });
    const result = await suggestTags(input());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/sai định dạng/);
  });
});

describe("applyTagSuggestion", () => {
  test("merges new tags with existing ones (case-insensitive de-dupe) and sets chessSummary", async () => {
    extractFrontMatterMock.mockResolvedValueOnce({
      tags: ["Sicilian", "game"],
    });
    patchFrontmatterMock.mockClear();
    writePageMock.mockClear();

    const result = await applyTagSuggestion(
      "Game1",
      ["sicilian", "blunder"],
      "Tóm tắt ván.",
    );

    expect(result).toEqual({ ok: true });
    expect(patchFrontmatterMock).toHaveBeenCalledTimes(1);
    const patches = patchFrontmatterMock.mock.calls[0][1] as {
      op: string;
      path: string;
      value: unknown;
    }[];
    const tagsPatch = patches.find((p) => p.path === "tags")!;
    expect(tagsPatch.value).toEqual(["Sicilian", "game", "blunder"]); // "sicilian" already present (case-insensitive)
    const summaryPatch = patches.find((p) => p.path === "chessSummary")!;
    expect(summaryPatch.value).toBe("Tóm tắt ván.");
    expect(writePageMock).toHaveBeenCalledTimes(1);
  });

  test("never drops an existing tag the suggestion didn't mention", async () => {
    extractFrontMatterMock.mockResolvedValueOnce({
      tags: ["personal-note", "review-later"],
    });
    patchFrontmatterMock.mockClear();
    await applyTagSuggestion("Game1", ["opening-c50"], "Tóm tắt.");
    const patches = patchFrontmatterMock.mock.calls[0][1] as {
      path: string;
      value: unknown;
    }[];
    const tagsPatch = patches.find((p) => p.path === "tags")!;
    expect(tagsPatch.value).toEqual([
      "personal-note",
      "review-later",
      "opening-c50",
    ]);
  });

  test("returns an error result instead of throwing when the page can't be read", async () => {
    readPageMock.mockRejectedValueOnce(new Error("page not found"));
    const result = await applyTagSuggestion("Missing", ["x"], "y");
    expect(result).toEqual({ ok: false, error: "page not found" });
  });
});
