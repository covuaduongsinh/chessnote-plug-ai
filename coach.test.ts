import { describe, expect, test, vi } from "vitest";
import type {
  GameReviewReport,
  MoveClassification,
  ReviewedMove,
} from "./engine_review_types.ts";

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

const {
  buildExplainMovePrompt,
  buildAnnotateGamePrompt,
  explainMove,
  annotateGame,
} = await import("./coach.ts");

function move(overrides: Partial<ReviewedMove> = {}): ReviewedMove {
  return {
    moveNum: 12,
    isWhite: true,
    san: "Nxe5",
    from: "f3",
    to: "e5",
    fenBefore: "fen-before",
    fenAfter: "fen-after",
    scoreBefore: 20,
    scoreAfter: -180,
    cpl: 200,
    classification: "blunder",
    bestMoveSan: "Bxc6",
    ...overrides,
  };
}

function report(overrides: Partial<GameReviewReport> = {}): GameReviewReport {
  const zeroStats = () =>
    ({
      brilliant: 0,
      great: 0,
      best: 0,
      good: 0,
      inaccuracy: 0,
      mistake: 0,
      blunder: 0,
      book: 0,
    }) as Record<MoveClassification, number>;
  return {
    whiteAccuracy: 87.5,
    blackAccuracy: 91.2,
    whiteStats: zeroStats(),
    blackStats: zeroStats(),
    moves: [],
    advantageGraph: [],
    ...overrides,
  };
}

describe("buildExplainMovePrompt", () => {
  test("includes SAN, classification, cpl, bestMoveSan, and both FENs", () => {
    const prompt = buildExplainMovePrompt(move());
    expect(prompt).toContain("12. Nxe5");
    expect(prompt).toContain("sai lầm nghiêm trọng");
    expect(prompt).toContain("mất 200 centipawn");
    expect(prompt).toContain("Bxc6");
    expect(prompt).toContain("fen-before");
    expect(prompt).toContain("fen-after");
  });

  test("marks black moves with '..' and omits cpl phrase when cpl is 0", () => {
    const prompt = buildExplainMovePrompt(
      move({
        isWhite: false,
        moveNum: 8,
        classification: "best",
        cpl: 0,
        bestMoveSan: undefined,
      }),
    );
    expect(prompt).toContain("8... Nxe5");
    expect(prompt).not.toContain("mất 0 centipawn");
    expect(prompt).not.toContain("Nước tốt nhất theo engine tại thời điểm đó");
  });

  test("always carries the anti-hallucination constraint (regression guard)", () => {
    const prompt = buildExplainMovePrompt(move());
    expect(prompt).toMatch(/KHÔNG suy diễn/);
    expect(prompt).toMatch(/KHÔNG bịa thêm/);
  });
});

describe("buildAnnotateGamePrompt", () => {
  test("caps the turning-point list at 10 even for a long game full of blunders", () => {
    const manyBlunders: ReviewedMove[] = Array.from({ length: 40 }, (_, i) =>
      move({
        moveNum: i + 1,
        isWhite: i % 2 === 0,
        classification: "blunder",
        cpl: 100 + i,
        san: `m${i}`,
      }),
    );
    const prompt = buildAnnotateGamePrompt(report({ moves: manyBlunders }));
    const bulletCount = (prompt.match(/^ {2}- /gm) || []).length;
    expect(bulletCount).toBe(10);
  });

  test("only lists blunder/mistake/brilliant/great moves as turning points, not book/good/inaccuracy", () => {
    const moves: ReviewedMove[] = [
      move({ san: "e4", classification: "book", cpl: 0 }),
      move({ san: "Qh5", classification: "good", cpl: 10 }),
      move({ san: "Bxf7", classification: "brilliant", cpl: 0, moveNum: 4 }),
      move({ san: "Nxe5", classification: "inaccuracy", cpl: 40 }),
    ];
    const prompt = buildAnnotateGamePrompt(report({ moves }));
    expect(prompt).toContain("Bxf7");
    expect(prompt).not.toContain("e4 —");
    expect(prompt).not.toContain("Qh5");
    expect(prompt).not.toContain("Nxe5");
  });

  test("falls back to a placeholder line when there are no turning points", () => {
    const prompt = buildAnnotateGamePrompt(
      report({ moves: [move({ classification: "good", cpl: 5 })] }),
    );
    expect(prompt).toContain("không có bước ngoặt đáng chú ý");
  });

  test("includes accuracy, player names, and result when provided", () => {
    const prompt = buildAnnotateGamePrompt(report(), {
      white: "Magnus",
      black: "Hikaru",
      result: "1-0",
      eco: "C50",
    });
    expect(prompt).toContain("Magnus");
    expect(prompt).toContain("Hikaru");
    expect(prompt).toContain("1-0");
    expect(prompt).toContain("C50");
    expect(prompt).toContain("87.5%");
    expect(prompt).toContain("91.2%");
  });

  test("always carries the anti-hallucination constraint (regression guard)", () => {
    const prompt = buildAnnotateGamePrompt(report());
    expect(prompt).toMatch(/KHÔNG suy diễn/);
    expect(prompt).toMatch(
      /không nhắc tới bất kỳ nước đi nào ngoài danh sách/i,
    );
  });
});

describe("explainMove / annotateGame — thin pass-through to aiAsk", () => {
  test("explainMove calls aiAsk exactly once with the built prompt and returns its result verbatim", async () => {
    aiAskMock.mockClear();
    aiAskMock.mockResolvedValueOnce({
      ok: true,
      text: "Nước này để mất một quân.",
    });
    const result = await explainMove(move());
    expect(aiAskMock).toHaveBeenCalledTimes(1);
    expect(aiAskMock.mock.calls[0][0]).toBe(buildExplainMovePrompt(move()));
    expect(result).toEqual({ ok: true, text: "Nước này để mất một quân." });
  });

  test("annotateGame calls aiAsk exactly once and returns its result verbatim, including errors", async () => {
    aiAskMock.mockClear();
    aiAskMock.mockResolvedValueOnce({ ok: false, error: "sidecar down" });
    const result = await annotateGame(report(), { white: "A", black: "B" });
    expect(aiAskMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: false, error: "sidecar down" });
  });
});
