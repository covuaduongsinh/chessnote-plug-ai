// AI: Tính embedding ngữ nghĩa cho toàn bộ ván — Phase 5 (stretch) của
// docs/plans/2026-09-11-dbms-sqlite-wasm-tich-hop.md.
//
// Theo đúng UX pattern đã có ở ai/trends.ts's commandAnalyzeTrends (hộp
// thoại xác nhận + thông báo tiến độ từng ván) — KHÔNG tự động chạy khi lưu
// trang, cùng lý do ai/tagging.ts đã nêu (autosave debounce 1 giây, chạy tự
// động sẽ tốn kém/gián đoạn), càng đúng hơn ở đây vì lần chạy đầu còn phải
// tải cả model AI (xem plugs/chess-db/embedding_store.ts's module comment
// về kích thước).
import {
  editor,
  index,
  markdown,
  space,
  system,
} from "@silverbulletmd/silverbullet/syscalls";
import type {
  ChessGameFields,
  ChessGameObject,
} from "./chess_game_types.ts";
import { computeForGame, extractFrontMatter } from "./external_syscalls.ts";

/** Đọc `chessSummary` (Giai đoạn C) trực tiếp từ trang — chấp nhận được ở đây (lệnh chạy theo lô, không phải đường hỏi-đáp nóng mà Phase 2 đã tối ưu tránh việc này). */
async function readSummary(page: string): Promise<string> {
  try {
    const text = await space.readPage(page);
    const tree = await markdown.parseMarkdown(text);
    const frontmatter = await extractFrontMatter(tree);
    return typeof frontmatter.chessSummary === "string"
      ? frontmatter.chessSummary
      : "";
  } catch {
    return "";
  }
}

/** Văn bản tự nhiên đưa vào model embedding — KHÔNG bỏ dấu/chuẩn hoá như blob FTS5 (Phase 2): model embedding hoạt động tốt hơn trên văn bản tự nhiên. */
export function buildEmbeddingText(
  game: Pick<ChessGameFields, "white" | "black" | "eco" | "event" | "comments">,
  summary: string,
): string {
  const parts = [
    game.white && game.black
      ? `Ván cờ giữa ${game.white} và ${game.black}.`
      : "",
    game.eco ? `Mã khai cuộc: ${game.eco}.` : "",
    game.event ? `Giải đấu: ${game.event}.` : "",
    summary,
    game.comments,
  ].filter(Boolean);
  return parts.join(" ");
}

/** Command "Chess: Tính embedding ngữ nghĩa". */
export async function commandComputeEmbeddings() {
  if (await system.isCapacitor()) {
    await editor.flashNotification(
      "Tính năng AI cần bản Web hoặc Desktop, chưa hỗ trợ trên Mobile.",
      "error",
    );
    return;
  }

  const games = await index.queryLuaObjects<ChessGameFields>("chess-game", {});
  if (games.length === 0) {
    await editor.flashNotification(
      "Không tìm thấy ván cờ nào (khối ```pgn```) trong không gian ghi chú.",
      "info",
    );
    return;
  }

  const proceed = await editor.confirm(
    `Tính embedding ngữ nghĩa cho ${games.length} ván. Lần chạy đầu tiên sẽ tải model AI ` +
      "(vài chục MB, chỉ tải 1 lần, được trình duyệt lưu cache cho các lần sau). Tiếp tục?",
  );
  if (!proceed) return;

  let done = 0;
  let failed = 0;
  for (const g of games as ChessGameObject[]) {
    try {
      const summary = await readSummary(g.page);
      const text = buildEmbeddingText(g, summary);
      await computeForGame(g.ref, g.page, text);
      done++;
      await editor.flashNotification(
        `Đang tính embedding: ${done + failed}/${games.length} ván...`,
        "info",
      );
    } catch (e) {
      failed++;
      console.warn(
        "[chess semantic_index]",
        `Bỏ qua ván ${g.ref}:`,
        (e as Error).message,
      );
    }
  }

  await editor.flashNotification(
    failed > 0
      ? `Đã tính embedding cho ${done}/${games.length} ván (${failed} ván lỗi, xem console).`
      : `Đã tính xong embedding ngữ nghĩa cho ${done} ván.`,
    failed > 0 ? "warning" : "info",
  );
}
