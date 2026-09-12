// Lệnh debug "Chess: Kiểm tra dữ liệu SQLite (debug)" — không thuộc phase
// nào trong docs/plans/2026-09-11-dbms-sqlite-wasm-tich-hop.md, thêm riêng
// để có cách XEM ĐƯỢC dữ liệu mà Phase 3 (white_elo/black_elo/time_control/
// opening/variation), Phase 5b (ai_annotations/ai_annotation_tags), và Phase
// 5 (game_embeddings) ghi vào SQLite — không có UI nào khác hiển thị các
// bảng này. Cách khác (không cần lệnh này) là mở DevTools console và gọi
// trực tiếp `client.clientSystem.chessSqlStore.debugDump()` — lệnh này chỉ
// là bản thân thiện hơn, xuất luôn ra 1 trang ghi chú đọc được.
import { chessSql, editor, space } from "@silverbulletmd/silverbullet/syscalls";

/** Thoát ký tự `|` và xuống dòng để không phá bảng markdown — dữ liệu thật (PGN comment, AI summary...) có thể chứa cả hai. */
export function escapeTableCell(value: string | number | null): string {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function row(cells: (string | number | null)[]): string {
  return `| ${cells.map(escapeTableCell).join(" | ")} |`;
}

function formatDateForPageName(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`
  );
}

type DebugDump = Awaited<ReturnType<typeof chessSql.debugDump>>;

/** Thuần — dựng toàn bộ báo cáo markdown từ 1 DebugDump, tách khỏi phần gọi syscall để test được không cần WASM. */
export function renderDebugDumpMarkdown(dump: DebugDump): string {
  const chessGamesTable = [
    "| page | white | black | result | eco | white_elo | black_elo | time_control | opening | variation | summary |",
    "|---|---|---|---|---|---|---|---|---|---|---|",
    ...dump.chessGames.map((g) =>
      row([
        g.page,
        g.white,
        g.black,
        g.result,
        g.eco,
        g.whiteElo,
        g.blackElo,
        g.timeControl,
        g.opening,
        g.variation,
        g.summary,
      ]),
    ),
  ].join("\n");

  const aiAnnotationsTable = [
    "| page | summary | confidence | model_version | generated_at | tags |",
    "|---|---|---|---|---|---|",
    ...dump.aiAnnotations.map((a) =>
      row([
        a.page,
        a.summary,
        a.confidence,
        a.modelVersion,
        a.generatedAt,
        a.tags,
      ]),
    ),
  ].join("\n");

  const repertoireTable = [
    "| page | side | eco | opening_name | variation_name | due_date | ease_factor | interval_days | review_count | last_grade |",
    "|---|---|---|---|---|---|---|---|---|---|",
    ...dump.repertoireLines.map((r) =>
      row([
        r.page,
        r.side,
        r.eco,
        r.openingName,
        r.variationName,
        r.dueDate,
        r.easeFactor,
        r.intervalDays,
        r.reviewCount,
        r.lastGrade,
      ]),
    ),
  ].join("\n");

  const embeddingsTable = [
    "| page | model_id | computed_at |",
    "|---|---|---|",
    ...dump.embeddings.map((e) => row([e.page, e.modelId, e.computedAt])),
  ].join("\n");

  return `# Debug: dữ liệu SQLite ChessNote

FTS5 khả dụng: ${dump.ftsAvailable ? "✅ có" : "❌ không — tìm kiếm toàn văn (Phase 2) sẽ luôn trả về rỗng trên bản dựng WASM này"}

## \`chess_games\` (${dump.chessGames.length} dòng — Phase 1-3)

${dump.chessGames.length ? chessGamesTable : "_(trống — chưa có trang nào có khối ```pgn```)_"}

## \`ai_annotations\` + \`ai_annotation_tags\` (${dump.aiAnnotations.length} dòng — Phase 5b)

${dump.aiAnnotations.length ? aiAnnotationsTable : "_(trống — chưa ván nào có `chessSummary`/tag AI trong frontmatter)_"}

## \`repertoire_lines\` (${dump.repertoireLines.length} dòng — Phase 4)

${dump.repertoireLines.length ? repertoireTable : "_(trống — chưa có trang `tags: repertoire` nào với khối ```pgn```)_"}

## \`game_embeddings\` (${dump.embeddings.length} dòng — Phase 5)

${dump.embeddings.length ? embeddingsTable : '_(trống — chưa chạy lệnh "Chess: Tính embedding ngữ nghĩa")_'}
`;
}

/** Command "Chess: Kiểm tra dữ liệu SQLite (debug)". */
export async function commandDebugDumpSql() {
  const dump = await chessSql.debugDump();
  const reportName = `Chess/Debug SQL/${formatDateForPageName(new Date())}`;
  await space.writePage(reportName, renderDebugDumpMarkdown(dump));
  await editor.navigate(reportName);
  await editor.flashNotification(
    "Đã tạo báo cáo debug dữ liệu SQLite.",
    "info",
  );
}
