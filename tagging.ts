// AI: Gợi ý tag + tóm tắt ngắn cho 1 ván (Giai đoạn C của kế hoạch "AI phạm vi rộng").
//
// Khác với "hook vào page:saved, tự động chạy khi lưu" như phác thảo gốc: autosave
// của SilverBullet debounce chỉ 1 giây (client/content_manager.ts: autoSaveInterval)
// — nghĩa là page:saved bắn ra liên tục trong lúc đang gõ, kể cả khi người dùng chỉ
// sửa văn bản xung quanh không đụng tới PGN. Tự động gọi AI (và tệ hơn, tự động bật
// hộp thoại xác nhận) mỗi lần như vậy sẽ vừa tốn quota AI vừa làm gián đoạn việc gõ
// phím. Thay vào đó, tính năng này là một NÚT BẤM trong pgnWidget ("🏷️ AI Gợi ý
// tag"), đúng khuôn "AI Giải thích"/"AI Bình luận ván" đã có — người dùng chủ động
// bấm khi muốn, không có lượt gọi AI nào xảy ra ngoài ý muốn.
import {
  chessSql,
  markdown,
  space,
  system,
} from "@silverbulletmd/silverbullet/syscalls";
import type { YamlPatch } from "../../plug-api/lib/yaml.ts";
import { extractFrontMatter } from "../index/frontmatter.ts";
import { extractChessGames } from "../chess/plug_api.ts";
import { aiAsk } from "./bridge.ts";

export interface TagSuggestionInput {
  white: string;
  black: string;
  result: string;
  eco: string;
  event: string;
  /** Vài nước mở đầu dạng SAN nối chuỗi (vd "e4 e5 Nf3 Nc6") — không phải toàn bộ PGN. */
  openingMoves: string;
}

export interface TagSuggestion {
  tags: string[];
  summary: string;
}

const MAX_TAGS = 4;

export function buildTagSuggestionPrompt(input: TagSuggestionInput): string {
  const lines = [
    "Bạn là trợ lý tổ chức thư viện ván cờ. Dựa trên thông tin ván đấu dưới đây, đề xuất:",
    `1. Tối đa ${MAX_TAGS} tag ngắn gọn (khai cuộc, chủ đề chiến thuật, giai đoạn ván nổi bật...), mỗi ` +
      "tag 1-3 từ tiếng Việt không dấu, nối bằng gạch ngang nếu nhiều từ (vd: sicilian, hy-sinh-quan).",
    "2. Một câu tóm tắt ngắn gọn (tối đa 25 từ, tiếng Việt có dấu) mô tả ván đấu.",
    "",
    `- Trắng: ${input.white}, Đen: ${input.black}, Kết quả: ${input.result}`,
    input.eco ? `- Mã khai cuộc (ECO): ${input.eco}` : "",
    input.event ? `- Giải đấu: ${input.event}` : "",
    `- Các nước mở đầu: ${input.openingMoves || "(không có)"}`,
    "",
    "Trả lời ĐÚNG theo định dạng sau, không thêm chữ nào khác, không giải thích thêm:",
    "TAGS: tag1, tag2, tag3",
    "TOMTAT: <câu tóm tắt>",
  ];
  return lines.filter((l) => l !== "").join("\n");
}

/**
 * Chỉ parse nghiêm ngặt đúng khuôn "TAGS: ...\nTOMTAT: ..." — trả về null nếu AI
 * không theo đúng định dạng, để lớp gọi báo lỗi rõ ràng thay vì áp dụng nhầm dữ
 * liệu đã đoán mò vào ghi chú của người dùng.
 */
export function parseTagSuggestion(aiText: string): TagSuggestion | null {
  const tagsMatch = /^TAGS:\s*(.+)$/im.exec(aiText);
  const summaryMatch = /^TOMTAT:\s*(.+)$/im.exec(aiText);
  if (!tagsMatch || !summaryMatch) return null;
  const tags = tagsMatch[1]
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 0)
    .slice(0, MAX_TAGS);
  const summary = summaryMatch[1].trim();
  if (tags.length === 0 || !summary) return null;
  return { tags, summary };
}

export async function suggestTags(
  input: TagSuggestionInput,
): Promise<
  | { ok: true; tags: string[]; summary: string; model: string }
  | { ok: false; error: string }
> {
  const result = await aiAsk(buildTagSuggestionPrompt(input));
  if (!result.ok) return result;
  const parsed = parseTagSuggestion(result.text);
  if (!parsed) {
    return {
      ok: false,
      error: "AI trả lời sai định dạng, không tự áp dụng được.",
    };
  }
  return { ok: true, ...parsed, model: result.model };
}

/**
 * Gộp tag AI gợi ý vào tag đã có của trang (không xoá/ghi đè tag cũ nào), và ghi
 * một câu tóm tắt vào frontmatter `chessSummary`. Chỉ gọi khi người dùng đã bấm
 * "Áp dụng" trên gợi ý hiện ra trên widget — không bao giờ tự động chạy.
 *
 * Phase 5b (docs/plans/2026-09-11-dbms-sqlite-wasm-tich-hop.md): sau khi ghi
 * frontmatter, gọi thêm chessSql.upsertAiAnnotation cho mỗi ván chess-game
 * trên trang (thường chỉ 1) để lưu confidence/model — 2 field không có
 * tương đương trong frontmatter nên không thể tự động suy ra lại từ việc
 * reindex trang (xem chess_sql_store.ts's syncAiAnnotationFromFrontmatter).
 * `confidence` để `null`: chưa có tín hiệu nào để tính con số đó (định dạng
 * TAGS/TOMTAT chỉ đúng/sai nhị phân, không phải một thang điểm) — cột giữ
 * chỗ sẵn cho khi có, không bịa số giả.
 */
export async function applyTagSuggestion(
  pageName: string,
  tags: string[],
  summary: string,
  modelVersion = "",
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const text = await space.readPage(pageName);
    const tree = await markdown.parseMarkdown(text);
    const frontmatter = extractFrontMatter(tree);
    const existingTags = frontmatter.tags || [];
    const existingLower = new Set(existingTags.map((t) => t.toLowerCase()));
    const mergedTags = [...existingTags];
    for (const t of tags) {
      if (!existingLower.has(t.toLowerCase())) mergedTags.push(t);
    }
    const patches: YamlPatch[] = [
      { op: "set-key", path: "tags", value: mergedTags },
      { op: "set-key", path: "chessSummary", value: summary },
    ];
    const patchedText: string = await system.invokeFunction(
      "index.patchFrontmatter",
      text,
      patches,
    );
    await space.writePage(pageName, patchedText);

    const games = await extractChessGames(pageName, tree);
    for (const g of games) {
      await chessSql.upsertAiAnnotation({
        ref: g.ref,
        page: pageName,
        summary,
        tags: mergedTags,
        confidence: null,
        modelVersion,
      });
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message || "Không áp dụng được." };
  }
}
