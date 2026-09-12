// AI: Hỏi-đáp trên các ván cờ trong không gian ghi chú (Giai đoạn E của kế hoạch
// "AI phạm vi rộng nhiều ghi chú" — phần cuối cùng, phụ thuộc nhiều nhất vào các
// giai đoạn trước).
//
// Phạm vi có chủ đích: các ghi chú CÓ VÁN CỜ (chess-game object, Giai đoạn A) —
// không phải "mọi ghi chú bất kỳ loại nào" trong Space. Toàn bộ hạ tầng cross-note
// đã xây (Giai đoạn A-D) xoay quanh chess-game; mở rộng ra nội dung ghi chú bất kỳ
// cần một tầng index đoạn văn riêng, không tận dụng được gì từ các giai đoạn trước.
//
// Retrieval: thử tìm kiếm ngữ nghĩa trước (Phase 5, chessEmbedding.search —
// chỉ khi không gian này đã có ít nhất 1 ván được tính embedding qua lệnh
// "Chess: Tính embedding ngữ nghĩa", còn không thì bỏ qua ngay, không chờ tải
// model), rồi mới rơi xuống SQLite FTS5 (chessSql.searchGames, Phase 2) trên
// blob đã index sẵn tại thời điểm lưu trang (xem plugs/chess/index.ts's
// buildSearchBlob) — thay cho vòng lặp so khớp substring thủ công trên toàn
// bộ ván mỗi lần hỏi (bản cũ trước Phase 2). Vẫn KHÔNG dùng
// plug-api/lib/fuzzy.ts's rank(): hàm đó khớp kiểu AND-mọi-từ trên field
// ngắn (tên trang/alias) — hợp cho page picker, nhưng loại sạch MỌI ứng viên
// ngay khi câu hỏi tự nhiên chứa 1 từ không khớp field nào ("tôi", "tại sao",
// "hay"...). extractKeywords() (plugs/chess/ai/text_normalize.ts) đã lọc hư
// từ tiếng Việt trước khi đưa vào FTS5 để tránh đúng vấn đề đó.
import {
  chessEmbedding,
  chessSql,
  editor,
  space,
  system,
} from "@silverbulletmd/silverbullet/syscalls";
import { aiAsk } from "./bridge.ts";
import { ANTI_HALLUCINATION_RULE } from "./coach.ts";
import { extractKeywords } from "../chess/plug_api.ts";

const MAX_CONTEXT_GAMES = 15;

type SearchGameRow = Awaited<ReturnType<typeof chessSql.searchGames>>[number];

async function retrieveMatches(
  question: string,
): Promise<{ matches: SearchGameRow[]; method: "semantic" | "fts5" }> {
  if (await chessEmbedding.hasAnyEmbeddings()) {
    const matches = await chessEmbedding.search({
      queryText: question,
      limit: MAX_CONTEXT_GAMES,
    });
    return { matches, method: "semantic" };
  }
  const keywords = await extractKeywords(question);
  const matches = await chessSql.searchGames({
    keywords,
    limit: MAX_CONTEXT_GAMES,
  });
  return { matches, method: "fts5" };
}

export function citationLine(e: SearchGameRow): string {
  const parts = [
    `[[${e.page}]]`,
    `Trắng: ${e.white || "?"}`,
    `Đen: ${e.black || "?"}`,
    `Kết quả: ${e.result || "*"}`,
  ];
  if (e.eco) parts.push(`ECO: ${e.eco}`);
  if (e.summary) parts.push(e.summary);
  return parts.join(" — ");
}

export function buildQaPrompt(
  question: string,
  matches: SearchGameRow[],
): string {
  const sourceLines = matches.length
    ? matches.map((m, i) => `${i + 1}. ${citationLine(m)}`)
    : ["(không tìm thấy ván nào khớp từ khoá trong câu hỏi)"];

  const lines = [
    "Bạn là trợ lý tra cứu ghi chú cờ vua cho người dùng ChessNote.",
    `Câu hỏi: "${question}"`,
    "",
    `Danh sách ván có thể liên quan (đã lọc bằng tìm kiếm toàn văn, tối đa ${MAX_CONTEXT_GAMES} ván — ` +
      "KHÔNG PHẢI toàn bộ ván trong không gian ghi chú):",
    ...sourceLines,
    "",
    "Trả lời câu hỏi (tiếng Việt, ngắn gọn) CHỈ dựa trên danh sách trên. Với mỗi ván bạn nhắc " +
      "tới, PHẢI trích dẫn đúng dạng [[TênTrang]] đã cho ở trên, không tự đặt tên trang khác. " +
      "Nếu danh sách trống hoặc không đủ thông tin để trả lời, nói rõ là không tìm thấy dữ liệu " +
      "phù hợp thay vì cố trả lời. Không chào hỏi, đi thẳng vào câu trả lời.",
    "",
    ANTI_HALLUCINATION_RULE +
      " Không bịa thêm ván, tên trang, hay chi tiết nào ngoài danh sách trên.",
  ];
  return lines.join("\n");
}

/** Command "Chess: Hỏi AI". */
export async function commandAskAi() {
  if (await system.isCapacitor()) {
    await editor.flashNotification(
      "Tính năng AI cần bản Web hoặc Desktop, chưa hỗ trợ trên Mobile.",
      "error",
    );
    return;
  }

  const question = await editor.prompt(
    "Hỏi AI về các ván cờ trong không gian ghi chú:",
  );
  if (!question) return;

  const { matches, method } = await retrieveMatches(question);

  const ai = await aiAsk(buildQaPrompt(question, matches));

  const pad = (n: number) => String(n).padStart(2, "0");
  const d = new Date();
  const reportName =
    `Chess/Hỏi AI/${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;

  const sourcesMd = matches.length
    ? matches.map((m) => `- ${citationLine(m)}`).join("\n")
    : "_(không có ván nào khớp trong câu hỏi)_";
  const methodLabel =
    method === "semantic"
      ? "tìm kiếm ngữ nghĩa (embedding)"
      : "tìm kiếm toàn văn FTS5";

  const markdownReport = `# Hỏi AI: ${question}

## Trả lời

${ai.ok ? ai.text : `_(AI chưa trả lời được: ${ai.error || "lỗi không rõ"})_`}

## Nguồn đã dùng (tối đa ${MAX_CONTEXT_GAMES} ván, ${methodLabel})

${sourcesMd}
`;

  await space.writePage(reportName, markdownReport);
  await editor.navigate(reportName);

  if (!ai.ok) {
    await editor.flashNotification(
      `AI không trả lời được: ${ai.error || "lỗi không rõ"}`,
      "warning",
    );
  }
}
