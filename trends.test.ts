import { describe, expect, test, vi } from "vitest";
import type {
  GameReviewReport,
  MoveClassification,
  ReviewedMove,
} from "../chess-engine/game_reviewer.ts";
import type { ChessGameObject } from "../chess/index.ts";

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
  classifyPhase,
  toCachedReview,
  aggregateTrends,
  buildTrendsPrompt,
  analyzeTrends,
  renderTrendsReportMarkdown,
} = await import("./trends.ts");
type ChessGameReviewObject = ReturnType<typeof toCachedReview>;
type TrendStats = ReturnType<typeof aggregateTrends>;

function zeroStats(): Record<MoveClassification, number> {
  return {
    brilliant: 0,
    great: 0,
    best: 0,
    good: 0,
    inaccuracy: 0,
    mistake: 0,
    blunder: 0,
    book: 0,
  };
}

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

function game(overrides: Partial<ChessGameObject> = {}): ChessGameObject {
  return {
    ref: "Page@1",
    tag: "chess-game",
    page: "Page",
    pgn: "1. e4 e5 *",
    white: "Alice",
    black: "Bob",
    result: "*",
    date: "",
    eco: "",
    event: "",
    comments: "",
    whiteElo: "",
    blackElo: "",
    timeControl: "",
    opening: "",
    variation: "",
    ...overrides,
  };
}

describe("classifyPhase", () => {
  test("buckets by move number: opening <=10, middlegame 11-25, endgame 26+", () => {
    expect(classifyPhase(1)).toBe("opening");
    expect(classifyPhase(10)).toBe("opening");
    expect(classifyPhase(11)).toBe("middlegame");
    expect(classifyPhase(25)).toBe("middlegame");
    expect(classifyPhase(26)).toBe("endgame");
    expect(classifyPhase(60)).toBe("endgame");
  });
});

describe("toCachedReview", () => {
  test("reuses the chess-game object's ref/page and caps turning points via pickTurningPoints", () => {
    const manyBlunders: ReviewedMove[] = Array.from({ length: 20 }, (_, i) =>
      move({
        moveNum: i + 1,
        classification: "blunder",
        cpl: 100 + i,
        san: `m${i}`,
      }),
    );
    const cached = toCachedReview(
      game({ ref: "Game1@43", page: "Game1" }),
      report({ moves: manyBlunders }),
    );
    expect(cached.ref).toBe("Game1@43");
    expect(cached.tag).toBe("chess-game-review");
    expect(cached.page).toBe("Game1");
    expect(cached.turningPoints.length).toBe(10);
    expect(cached.whiteAccuracy).toBe(87.5);
  });

  test("stamps a fresh reviewedAt timestamp", () => {
    const before = Date.now();
    const cached = toCachedReview(game(), report());
    const reviewedAt = new Date(cached.reviewedAt).getTime();
    expect(reviewedAt).toBeGreaterThanOrEqual(before);
  });
});

describe("aggregateTrends", () => {
  test("sums classification counts across games and averages accuracy", () => {
    const g1 = game({ ref: "A@1", page: "A", eco: "C50" });
    const g2 = game({ ref: "B@1", page: "B", eco: "B90" });
    const r1: ChessGameReviewObject = {
      ...toCachedReview(g1, report()),
      whiteAccuracy: 80,
      blackAccuracy: 60,
      whiteStats: { ...zeroStats(), blunder: 2 },
      blackStats: { ...zeroStats(), mistake: 1 },
      turningPoints: [
        {
          moveNum: 5,
          isWhite: true,
          san: "a",
          classification: "blunder",
          cpl: 200,
        },
        {
          moveNum: 30,
          isWhite: false,
          san: "b",
          classification: "mistake",
          cpl: 100,
        },
      ],
    };
    const r2: ChessGameReviewObject = {
      ...toCachedReview(g2, report()),
      whiteAccuracy: 90,
      blackAccuracy: 70,
      whiteStats: { ...zeroStats(), blunder: 1 },
      blackStats: { ...zeroStats() },
      turningPoints: [
        {
          moveNum: 15,
          isWhite: true,
          san: "c",
          classification: "blunder",
          cpl: 150,
        },
      ],
    };
    const stats = aggregateTrends(
      [g1, g2],
      new Map([
        [g1.ref, r1],
        [g2.ref, r2],
      ]),
    );

    expect(stats.gameCount).toBe(2);
    expect(stats.avgWhiteAccuracy).toBe(85);
    expect(stats.avgBlackAccuracy).toBe(65);
    expect(stats.errorCounts.blunder).toBe(3);
    expect(stats.errorCounts.mistake).toBe(1);
    // moveNum 5 -> opening, 30 -> endgame, 15 -> middlegame
    expect(stats.phaseErrorCounts).toEqual({
      opening: 1,
      middlegame: 1,
      endgame: 1,
    });
    expect(stats.ecoErrorCounts).toEqual([
      { eco: "C50", count: 2 },
      { eco: "B90", count: 1 },
    ]);
  });

  test("skips games with no cached review instead of throwing", () => {
    const g1 = game({ ref: "A@1", page: "A" });
    const g2 = game({ ref: "B@1", page: "B" });
    const r1 = toCachedReview(g1, report({ whiteAccuracy: 99 }));
    const stats = aggregateTrends([g1, g2], new Map([[g1.ref, r1]]));
    expect(stats.gameCount).toBe(1);
    expect(stats.avgWhiteAccuracy).toBe(99);
  });

  test("returns zeroed stats for an empty game list", () => {
    const stats = aggregateTrends([], new Map());
    expect(stats.gameCount).toBe(0);
    expect(stats.avgWhiteAccuracy).toBe(0);
    expect(stats.ecoErrorCounts).toEqual([]);
  });

  test("caps eco error counts at the top 5, sorted descending", () => {
    const games: ChessGameObject[] = [];
    const reviewByRef = new Map<string, ChessGameReviewObject>();
    const ecos = ["A0", "B0", "C0", "D0", "E0", "F0"];
    ecos.forEach((eco, i) => {
      const g = game({ ref: `G${i}@1`, page: `G${i}`, eco });
      games.push(g);
      reviewByRef.set(g.ref, {
        ...toCachedReview(g, report()),
        turningPoints: Array.from({ length: i + 1 }, () => ({
          moveNum: 1,
          isWhite: true,
          san: "x",
          classification: "blunder" as const,
          cpl: 100,
        })),
      });
    });
    const stats = aggregateTrends(games, reviewByRef);
    expect(stats.ecoErrorCounts.length).toBe(5);
    expect(stats.ecoErrorCounts[0]).toEqual({ eco: "F0", count: 6 });
    expect(stats.ecoErrorCounts.map((e) => e.eco)).not.toContain("A0");
  });
});

describe("buildTrendsPrompt", () => {
  function stats(overrides: Partial<TrendStats> = {}): TrendStats {
    return {
      gameCount: 5,
      avgWhiteAccuracy: 82.3,
      avgBlackAccuracy: 77.1,
      errorCounts: { ...zeroStats(), blunder: 3, mistake: 2 },
      phaseErrorCounts: { opening: 0, middlegame: 2, endgame: 3 },
      ecoErrorCounts: [{ eco: "B90", count: 4 }],
      ...overrides,
    };
  }

  test("includes gameCount, accuracy, phase and eco breakdown", () => {
    const prompt = buildTrendsPrompt(stats());
    expect(prompt).toContain("5 ván cờ");
    expect(prompt).toContain("82.3%");
    expect(prompt).toContain("77.1%");
    expect(prompt).toContain("B90: 4 lỗi");
    expect(prompt).toContain("trung cuộc: 2");
    expect(prompt).toContain("tàn cuộc: 3");
  });

  test("falls back to a placeholder when there are no eco stats", () => {
    const prompt = buildTrendsPrompt(stats({ ecoErrorCounts: [] }));
    expect(prompt).toContain("không đủ dữ liệu ECO");
  });

  test("always carries the anti-hallucination constraint and never mentions PGN access", () => {
    const prompt = buildTrendsPrompt(stats());
    expect(prompt).toMatch(/KHÔNG suy diễn/);
    expect(prompt).toMatch(/không được thấy PGN/);
  });

  test("never leaks raw player names or move text — only aggregate numbers", () => {
    const prompt = buildTrendsPrompt(stats());
    expect(prompt).not.toContain("Alice");
    expect(prompt).not.toContain("Nxe5");
  });
});

describe("analyzeTrends — thin pass-through to aiAsk", () => {
  test("calls aiAsk exactly once with buildTrendsPrompt's output and returns its result verbatim", async () => {
    aiAskMock.mockClear();
    aiAskMock.mockResolvedValueOnce({
      ok: true,
      text: "Bạn hay blunder ở tàn cuộc.",
    });
    const s: TrendStats = {
      gameCount: 1,
      avgWhiteAccuracy: 50,
      avgBlackAccuracy: 50,
      errorCounts: zeroStats(),
      phaseErrorCounts: { opening: 0, middlegame: 0, endgame: 0 },
      ecoErrorCounts: [],
    };
    const result = await analyzeTrends(s);
    expect(aiAskMock).toHaveBeenCalledTimes(1);
    expect(aiAskMock.mock.calls[0][0]).toBe(buildTrendsPrompt(s));
    expect(result).toEqual({ ok: true, text: "Bạn hay blunder ở tàn cuộc." });
  });
});

describe("renderTrendsReportMarkdown", () => {
  function stats(): TrendStats {
    return {
      gameCount: 3,
      avgWhiteAccuracy: 88.8,
      avgBlackAccuracy: 70.1,
      errorCounts: { ...zeroStats(), blunder: 1 },
      phaseErrorCounts: { opening: 0, middlegame: 0, endgame: 1 },
      ecoErrorCounts: [],
    };
  }

  test("includes the AI text, accuracy numbers, and cache/skip counts", () => {
    const md = renderTrendsReportMarkdown(stats(), "Nhận xét AI ở đây.", {
      totalGames: 4,
      skipped: 1,
      reviewedNow: 2,
      fromCache: 1,
    });
    expect(md).toContain("3/4 ván");
    expect(md).toContain("88.8%");
    expect(md).toContain("70.1%");
    expect(md).toContain("Nhận xét AI ở đây.");
    expect(md).toContain("Bỏ qua 1 ván");
    expect(md).toContain("2 ván mới phân tích");
    expect(md).toContain("1 ván lấy từ cache");
  });

  test("shows a placeholder instead of crashing when the AI text is missing", () => {
    const md = renderTrendsReportMarkdown(stats(), undefined, {
      totalGames: 3,
      skipped: 0,
      reviewedNow: 3,
      fromCache: 0,
    });
    expect(md).toContain("AI chưa trả lời được");
    expect(md).not.toContain("Bỏ qua");
  });
});
