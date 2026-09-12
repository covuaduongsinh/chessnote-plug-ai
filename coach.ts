// AI Coach: giải thích 1 nước đi, và bình luận toàn ván — cả hai đều CHỈ dựa trên
// số liệu engine Arasan thật đã tính sẵn (từ `chess.reviewGame`), không để AI tự
// thẩm định thế cờ khác đi. Đây là nguyên tắc chống hallucination lấy thẳng từ tài
// liệu tầm nhìn gốc của dự án (docs/plans/05-phase-5-ai-agents-subscription.md):
// "Gateway kết hợp sẵn kết quả tính toán của Arasan vào Prompt".
//
// Build prompt ở ĐÂY (Worker), không phải trong iframe script của pgnWidget — giữ
// đúng nguyên tắc "logic nghiệp vụ ở Worker" đã ghi trong chess.ts. `explainMove`/
// `annotateGame` là 2 hàm mỏng nối `buildXxxPrompt()` (thuần, test được không cần
// mock) với `aiAsk()` (đã xử lý mode/model/lỗi sidecar).

import type {
  GameReviewReport,
  MoveClassification,
  ReviewedMove,
} from "../chess-engine/game_reviewer.ts";
import { aiAsk } from "./bridge.ts";

export interface ExplainMoveInput extends ReviewedMove {
  // moveNum/isWhite/san/... đã có sẵn trong ReviewedMove — không cần field thêm,
  // interface này chỉ đặt tên rõ ràng cho tham số của explainMove().
}

function formatEval(scoreCentipawns: number): string {
  const pawns = (scoreCentipawns / 100).toFixed(2);
  return scoreCentipawns >= 0 ? `+${pawns}` : pawns;
}

export const CLASSIFICATION_VI: Record<MoveClassification, string> = {
  brilliant: "xuất sắc (!!)",
  great: "hay (!)",
  best: "nước tốt nhất theo engine",
  good: "ổn, chênh lệch nhỏ so với nước tốt nhất",
  inaccuracy: "thiếu chính xác (?!)",
  mistake: "sai lầm (?)",
  blunder: "sai lầm nghiêm trọng (??)",
  book: "nước lý thuyết khai cuộc",
};

export const ANTI_HALLUCINATION_RULE =
  "Chỉ dựa DUY NHẤT vào số liệu được cung cấp ở trên — KHÔNG suy diễn, KHÔNG bịa thêm " +
  "nước đi, biến thể, hay tình huống nào ngoài số liệu đó.";

export function buildExplainMovePrompt(input: ExplainMoveInput): string {
  const mover = input.isWhite ? "Trắng" : "Đen";
  const moveLabel = `${input.moveNum}.${input.isWhite ? "" : ".."} ${input.san}`;
  const lines = [
    "Bạn là huấn luyện viên cờ vua, giọng văn trung thực và khích lệ.",
    `Hãy giải thích ngắn gọn (2-4 câu, tiếng Việt) nước đi sau:`,
    "",
    `- Nước đi: ${moveLabel} (${mover} đi)`,
    `- Đánh giá của engine: ${CLASSIFICATION_VI[input.classification]}` +
      (input.cpl > 0
        ? ` (mất ${input.cpl} centipawn so với nước tốt nhất)`
        : ""),
    input.bestMoveSan
      ? `- Nước tốt nhất theo engine tại thời điểm đó: ${input.bestMoveSan}`
      : "",
    `- Đánh giá trước nước đi (góc nhìn ${mover}, đơn vị quân Tốt): ${formatEval(input.scoreBefore)}`,
    `- Đánh giá sau nước đi (góc nhìn ${mover}): ${formatEval(input.scoreAfter)}`,
    `- FEN trước: ${input.fenBefore}`,
    `- FEN sau: ${input.fenAfter}`,
    "",
    "Nếu là sai lầm/thiếu chính xác: chỉ rõ vì sao dựa trên chênh lệch điểm và nước tốt hơn ở " +
      "trên. Nếu là nước tốt/hay/xuất sắc: khen và giải thích ngắn gọn ý đồ. Không chào hỏi, đi " +
      "thẳng vào giải thích.",
    "",
    ANTI_HALLUCINATION_RULE,
  ];
  return lines.filter((l) => l !== "").join("\n");
}

export async function explainMove(input: ExplainMoveInput) {
  return aiAsk(buildExplainMovePrompt(input));
}

// ---- Bình luận toàn ván ----

const MAX_TURNING_POINTS = 10;
const TURNING_POINT_CLASSES: MoveClassification[] = [
  "blunder",
  "mistake",
  "brilliant",
  "great",
];

export interface GameHeaders {
  white?: string;
  black?: string;
  result?: string;
  eco?: string;
}

export function pickTurningPoints(moves: ReviewedMove[]): ReviewedMove[] {
  return (
    moves
      .filter((m) => TURNING_POINT_CLASSES.includes(m.classification))
      .sort((a, b) => b.cpl - a.cpl)
      .slice(0, MAX_TURNING_POINTS)
      // Đưa lại về đúng thứ tự thời gian trong ván để AI kể chuyện mạch lạc.
      .sort(
        (a, b) =>
          a.moveNum - b.moveNum ||
          (a.isWhite === b.isWhite ? 0 : a.isWhite ? -1 : 1),
      )
  );
}

export function buildAnnotateGamePrompt(
  report: GameReviewReport,
  headers: GameHeaders = {},
): string {
  const turningPoints = pickTurningPoints(report.moves);
  const white = headers.white || "Trắng";
  const black = headers.black || "Đen";

  const statsLine = (stats: Record<MoveClassification, number>) =>
    Object.entries(stats)
      .filter(([, count]) => count > 0)
      .map(
        ([cls, count]) =>
          `${CLASSIFICATION_VI[cls as MoveClassification]}: ${count}`,
      )
      .join(", ");

  const turningPointLines = turningPoints.length
    ? turningPoints.map((m) => {
        const moveLabel = `${m.moveNum}.${m.isWhite ? "" : ".."} ${m.san}`;
        const best = m.bestMoveSan ? `, nước tốt hơn: ${m.bestMoveSan}` : "";
        return `  - ${moveLabel} — ${CLASSIFICATION_VI[m.classification]} (mất ${m.cpl}cp${best})`;
      })
    : ["  - (không có bước ngoặt đáng chú ý, ván đấu tương đối đều)"];

  const lines = [
    "Bạn là bình luận viên cờ vua chuyên nghiệp, giọng văn văn học nhưng dễ hiểu.",
    `Hãy viết một đoạn bình luận (150-250 từ, tiếng Việt) cho ván đấu sau giữa ${white} (Trắng) ` +
      `và ${black} (Đen)${headers.result ? `, kết quả ${headers.result}` : ""}` +
      `${headers.eco ? `, khai cuộc mã ECO ${headers.eco}` : ""}.`,
    "",
    `- Độ chính xác Trắng: ${report.whiteAccuracy.toFixed(1)}%, thống kê: ${statsLine(report.whiteStats)}`,
    `- Độ chính xác Đen: ${report.blackAccuracy.toFixed(1)}%, thống kê: ${statsLine(report.blackStats)}`,
    "- Các bước ngoặt chính (theo thứ tự ván đấu):",
    ...turningPointLines,
    "",
    "Nêu diễn biến chính và các bước ngoặt liệt kê ở trên, nhận xét ai kiểm soát thế trận và tại " +
      "sao. Không chào hỏi, đi thẳng vào bình luận.",
    "",
    ANTI_HALLUCINATION_RULE +
      " Không nhắc tới bất kỳ nước đi nào ngoài danh sách bước ngoặt trên.",
  ];
  return lines.join("\n");
}

export async function annotateGame(
  report: GameReviewReport,
  headers: GameHeaders = {},
) {
  return aiAsk(buildAnnotateGamePrompt(report, headers));
}
