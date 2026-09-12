// AI: Phân tích xu hướng nhiều ván (Giai đoạn B của kế hoạch "AI phạm vi rộng").
//
// Nguyên tắc chống hallucination giữ nguyên như AI Coach (coach.ts): AI chỉ được
// feed SỐ LIỆU ĐÃ GỘP từ engine Arasan thật (chess.reviewGame trên từng ván), không
// bao giờ thấy PGN thô của bất kỳ ván nào — nhất là ở đây, khi số ván có thể nhiều,
// nguy cơ AI "bịa" một nước đi/ván không tồn tại càng cao nếu để nó tự đọc PGN.
//
// Kết quả review từng ván được cache lại dưới dạng object Index riêng
// (tag "chess-game-review", cùng `ref` với object "chess-game" của Giai đoạn A) thay
// vì ghi vào frontmatter của ghi chú: bộ vá YAML thủ công của dự án
// (plug-api/lib/yaml.ts) tự nhận "không xử lý tốt cấu trúc lồng nhau" — whiteStats/
// turningPoints là dữ liệu lồng nhau thật, rủi ro làm hỏng file ghi chú của người
// dùng là không đáng. Cache qua Object Index còn có lợi "miễn phí": mỗi khi trang
// chứa ván đó được lưu lại, index.clearFileIndex() (plugs/index/queue.ts) tự xoá
// cache cũ của đúng trang đó — không cần tự cài cơ chế phát hiện "PGN đã đổi".
import { editor, index, space } from "@silverbulletmd/silverbullet/syscalls";
import type { ObjectValue } from "@silverbulletmd/silverbullet/type/index";
import {
  isEngineNotInstalledError,
  reviewGame,
} from "../chess-engine/plug_api.ts";
import type {
  GameReviewReport,
  MoveClassification,
} from "../chess-engine/game_reviewer.ts";
import type { ChessGameFields, ChessGameObject } from "../chess/index.ts";
import { aiAsk } from "./bridge.ts";
import {
  ANTI_HALLUCINATION_RULE,
  CLASSIFICATION_VI,
  pickTurningPoints,
} from "./coach.ts";

const REVIEW_TAG = "chess-game-review";
const ENGINE_REVIEW_DEPTH = 12;

export interface CachedTurningPoint {
  moveNum: number;
  isWhite: boolean;
  san: string;
  classification: MoveClassification;
  cpl: number;
  bestMoveSan?: string;
}

export interface ChessGameReviewFields {
  page: string;
  whiteAccuracy: number;
  blackAccuracy: number;
  whiteStats: Record<MoveClassification, number>;
  blackStats: Record<MoveClassification, number>;
  turningPoints: CachedTurningPoint[];
  reviewedAt: string;
}

export type ChessGameReviewObject = ObjectValue<ChessGameReviewFields>;

export function toCachedReview(
  game: ChessGameObject,
  report: GameReviewReport,
): ChessGameReviewObject {
  return {
    ref: game.ref,
    tag: REVIEW_TAG,
    page: game.page,
    whiteAccuracy: report.whiteAccuracy,
    blackAccuracy: report.blackAccuracy,
    whiteStats: report.whiteStats,
    blackStats: report.blackStats,
    turningPoints: pickTurningPoints(report.moves).map((m) => ({
      moveNum: m.moveNum,
      isWhite: m.isWhite,
      san: m.san,
      classification: m.classification,
      cpl: m.cpl,
      bestMoveSan: m.bestMoveSan,
    })),
    reviewedAt: new Date().toISOString(),
  };
}

/** Cache hit = a chess-game-review object still exists for this exact ref. Reviewing the game again (whether the PGN changed or the note was just touched) invalidates it for free, via the same index.clearFileIndex() every page save already goes through — see the module comment. */
export async function getOrReviewGame(
  game: ChessGameObject,
): Promise<{ review: ChessGameReviewObject; fromCache: boolean }> {
  const cached = await index.getObjectByRef<ChessGameReviewFields>(
    game.page,
    REVIEW_TAG,
    game.ref,
  );
  if (cached) {
    return { review: cached, fromCache: true };
  }
  const report = await reviewGame(game.pgn, ENGINE_REVIEW_DEPTH);
  const review = toCachedReview(game, report);
  await index.indexObjects<ChessGameReviewFields>(game.page, [review]);
  return { review, fromCache: false };
}

// ---- Gộp số liệu nhiều ván (thuần code, không AI) ----

export type GamePhase = "opening" | "middlegame" | "endgame";

/** Ngưỡng đơn giản theo số nước đã đi — không phải phân tích cấu trúc thế cờ thật (chuyển quân/đổi hậu...), chỉ đủ để nhóm lỗi theo giai đoạn ván một cách thô. */
export function classifyPhase(moveNum: number): GamePhase {
  if (moveNum <= 10) return "opening";
  if (moveNum <= 25) return "middlegame";
  return "endgame";
}

const ERROR_CLASSES: MoveClassification[] = ["blunder", "mistake"];

export interface TrendStats {
  gameCount: number;
  avgWhiteAccuracy: number;
  avgBlackAccuracy: number;
  errorCounts: Record<MoveClassification, number>;
  phaseErrorCounts: Record<GamePhase, number>;
  ecoErrorCounts: { eco: string; count: number }[];
}

export function aggregateTrends(
  games: ChessGameObject[],
  reviewByRef: Map<string, ChessGameReviewObject>,
): TrendStats {
  const errorCounts: Record<MoveClassification, number> = {
    brilliant: 0,
    great: 0,
    best: 0,
    good: 0,
    inaccuracy: 0,
    mistake: 0,
    blunder: 0,
    book: 0,
  };
  const phaseErrorCounts: Record<GamePhase, number> = {
    opening: 0,
    middlegame: 0,
    endgame: 0,
  };
  const ecoErrorTally = new Map<string, number>();

  let whiteAccSum = 0;
  let blackAccSum = 0;
  let counted = 0;

  for (const game of games) {
    const review = reviewByRef.get(game.ref);
    if (!review) continue;
    counted++;
    whiteAccSum += review.whiteAccuracy;
    blackAccSum += review.blackAccuracy;

    for (const [cls, n] of Object.entries(review.whiteStats)) {
      errorCounts[cls as MoveClassification] += n;
    }
    for (const [cls, n] of Object.entries(review.blackStats)) {
      errorCounts[cls as MoveClassification] += n;
    }

    let gameErrorCount = 0;
    for (const tp of review.turningPoints) {
      if (!ERROR_CLASSES.includes(tp.classification)) continue;
      phaseErrorCounts[classifyPhase(tp.moveNum)]++;
      gameErrorCount++;
    }
    if (game.eco && gameErrorCount > 0) {
      ecoErrorTally.set(
        game.eco,
        (ecoErrorTally.get(game.eco) ?? 0) + gameErrorCount,
      );
    }
  }

  const ecoErrorCounts = [...ecoErrorTally.entries()]
    .map(([eco, count]) => ({ eco, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return {
    gameCount: counted,
    avgWhiteAccuracy: counted > 0 ? whiteAccSum / counted : 0,
    avgBlackAccuracy: counted > 0 ? blackAccSum / counted : 0,
    errorCounts,
    phaseErrorCounts,
    ecoErrorCounts,
  };
}

// ---- Prompt AI (chỉ số liệu đã gộp, không PGN) ----

export function buildTrendsPrompt(stats: TrendStats): string {
  const errorStatsLine = Object.entries(stats.errorCounts)
    .filter(([, count]) => count > 0)
    .map(
      ([cls, count]) =>
        `${CLASSIFICATION_VI[cls as MoveClassification]}: ${count}`,
    )
    .join(", ");

  const phaseLine =
    `khai cuộc: ${stats.phaseErrorCounts.opening}, ` +
    `trung cuộc: ${stats.phaseErrorCounts.middlegame}, ` +
    `tàn cuộc: ${stats.phaseErrorCounts.endgame}`;

  const ecoLines = stats.ecoErrorCounts.length
    ? stats.ecoErrorCounts.map(
        (e) => `  - ${e.eco}: ${e.count} lỗi (sai lầm/blunder)`,
      )
    : ["  - (không đủ dữ liệu ECO để nhóm theo khai cuộc)"];

  const lines = [
    "Bạn là huấn luyện viên cờ vua, giọng văn trung thực và khích lệ.",
    `Dưới đây là số liệu đã gộp từ ${stats.gameCount} ván cờ đã được engine Arasan thật ` +
      "phân tích (không phải dữ liệu do bạn tự suy luận). Hãy viết nhận xét về xu hướng " +
      "chơi (150-250 từ, tiếng Việt): điểm yếu lặp lại và gợi ý cụ thể nên ôn luyện gì.",
    "",
    `- Độ chính xác trung bình khi cầm Trắng: ${stats.avgWhiteAccuracy.toFixed(1)}%`,
    `- Độ chính xác trung bình khi cầm Đen: ${stats.avgBlackAccuracy.toFixed(1)}%`,
    `- Tổng số nước đi theo phân loại (cả hai màu, gộp mọi ván): ${errorStatsLine}`,
    `- Sai lầm/blunder theo giai đoạn ván (gộp mọi ván): ${phaseLine}`,
    "- Sai lầm/blunder nhiều nhất theo mã khai cuộc (ECO), tối đa 5 mã:",
    ...ecoLines,
    "",
    "Chỉ ra 1-3 điểm yếu lặp lại rõ nhất từ số liệu trên (ví dụ: hay sai ở tàn cuộc, hay " +
      "blunder khi chơi 1 khai cuộc cụ thể...) và gợi ý ôn luyện tương ứng. Không chào hỏi, " +
      "đi thẳng vào nhận xét.",
    "",
    ANTI_HALLUCINATION_RULE +
      " Không nhắc tới ván đấu, nước đi, hay đối thủ cụ thể nào — bạn không được thấy PGN, " +
      "chỉ được thấy số liệu đã gộp ở trên.",
  ];
  return lines.join("\n");
}

export async function analyzeTrends(stats: TrendStats) {
  return aiAsk(buildTrendsPrompt(stats));
}

// ---- Báo cáo (trang ghi chú mới) ----

function formatDateForPageName(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  // Không dùng ":" — không hợp lệ trong tên file trên Windows.
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`
  );
}

export function renderTrendsReportMarkdown(
  stats: TrendStats,
  aiText: string | undefined,
  meta: {
    totalGames: number;
    skipped: number;
    reviewedNow: number;
    fromCache: number;
  },
): string {
  const errorStatsLine = Object.entries(stats.errorCounts)
    .filter(([, count]) => count > 0)
    .map(
      ([cls, count]) =>
        `**${CLASSIFICATION_VI[cls as MoveClassification]}**: ${count}`,
    )
    .join(" · ");

  const ecoLines = stats.ecoErrorCounts.length
    ? stats.ecoErrorCounts.map((e) => `- ${e.eco}: ${e.count} lỗi`).join("\n")
    : "- (không đủ dữ liệu ECO)";

  const skippedNote =
    meta.skipped > 0
      ? `\n\n> ⚠️ Bỏ qua ${meta.skipped} ván do lỗi khi phân tích (xem thông báo lúc chạy lệnh).`
      : "";

  return `# Phân tích xu hướng nhiều ván

Phân tích ${stats.gameCount}/${meta.totalGames} ván cờ trong không gian ghi chú bằng engine
Arasan thật (${meta.reviewedNow} ván mới phân tích, ${meta.fromCache} ván lấy từ cache).${skippedNote}

## Số liệu tổng hợp

- Độ chính xác trung bình khi cầm **Trắng**: ${stats.avgWhiteAccuracy.toFixed(1)}%
- Độ chính xác trung bình khi cầm **Đen**: ${stats.avgBlackAccuracy.toFixed(1)}%
- Phân loại nước đi (gộp mọi ván, cả hai màu): ${errorStatsLine || "(không có dữ liệu)"}
- Sai lầm/blunder theo giai đoạn ván: khai cuộc **${stats.phaseErrorCounts.opening}**, trung cuộc **${stats.phaseErrorCounts.middlegame}**, tàn cuộc **${stats.phaseErrorCounts.endgame}**
- Sai lầm/blunder nhiều nhất theo khai cuộc (ECO):
${ecoLines}

## Nhận xét của AI

${aiText || "_(AI chưa trả lời được — xem thông báo lỗi lúc chạy lệnh.)_"}

---
*Số liệu do engine Arasan thật tính toán; nhận xét AI chỉ dựa trên số liệu ở trên, không tự đọc
PGN của bất kỳ ván nào.*
`;
}

/** Command "Chess: Phân tích xu hướng". */
export async function commandAnalyzeTrends() {
  const games = await index.queryLuaObjects<ChessGameFields>("chess-game", {});
  if (games.length === 0) {
    await editor.flashNotification(
      "Không tìm thấy ván cờ nào (khối ```pgn```) trong không gian ghi chú.",
      "info",
    );
    return;
  }

  const uncached: ChessGameObject[] = [];
  for (const game of games) {
    const cached = await index.getObjectByRef<ChessGameReviewFields>(
      game.page,
      REVIEW_TAG,
      game.ref,
    );
    if (!cached) uncached.push(game);
  }

  if (uncached.length > 0) {
    const estMinutes = Math.ceil((uncached.length * 15) / 60);
    const proceed = await editor.confirm(
      `Tìm thấy ${games.length} ván, ${uncached.length} ván chưa được phân tích bằng engine ` +
        `(mỗi ván có thể mất 10-40 giây, ước tính khoảng ${estMinutes} phút). Chạy engine cho ` +
        `các ván này bây giờ?`,
    );
    if (!proceed) return;
  }

  const reviewByRef = new Map<string, ChessGameReviewObject>();
  let reviewedNow = 0;
  let fromCache = 0;
  let skipped = 0;
  for (let i = 0; i < games.length; i++) {
    const game = games[i];
    try {
      const { review, fromCache: hit } = await getOrReviewGame(game);
      reviewByRef.set(game.ref, review);
      if (hit) fromCache++;
      else {
        reviewedNow++;
        await editor.flashNotification(
          `Đang phân tích xu hướng: ${i + 1}/${games.length} ván (${game.page})...`,
          "info",
        );
      }
    } catch (e) {
      if (isEngineNotInstalledError(e)) {
        await editor.flashNotification(
          'Chưa cài engine Arasan (Library "Chess") — không thể phân tích ván nào. ' +
            "Xem hướng dẫn cài Library trong Configuration Manager.",
          "error",
        );
        return;
      }
      skipped++;
      console.warn(
        "[chess trends]",
        `Bỏ qua ván ${game.ref}:`,
        (e as Error).message,
      );
    }
  }

  if (reviewByRef.size === 0) {
    await editor.flashNotification("Không phân tích được ván nào.", "error");
    return;
  }

  const stats = aggregateTrends(games, reviewByRef);
  const ai = await analyzeTrends(stats);

  const reportName = `Chess/Trends/${formatDateForPageName(new Date())}`;
  const markdown = renderTrendsReportMarkdown(
    stats,
    ai.ok ? ai.text : undefined,
    {
      totalGames: games.length,
      skipped,
      reviewedNow,
      fromCache,
    },
  );
  await space.writePage(reportName, markdown);
  await editor.navigate(reportName);

  if (!ai.ok) {
    await editor.flashNotification(
      `Đã tạo báo cáo số liệu, nhưng AI không trả lời được: ${ai.error || "lỗi không rõ"}`,
      "warning",
    );
  } else {
    await editor.flashNotification(
      "Đã tạo báo cáo phân tích xu hướng.",
      "info",
    );
  }
}
