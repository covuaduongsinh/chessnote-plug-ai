import { describe, expect, test } from "vitest";
import { escapeTableCell, renderDebugDumpMarkdown } from "./debug_dump.ts";

describe("escapeTableCell", () => {
  test("escapes pipe characters so they don't break the markdown table", () => {
    expect(escapeTableCell("a | b")).toBe("a \\| b");
  });

  test("collapses newlines to spaces", () => {
    expect(escapeTableCell("line1\nline2")).toBe("line1 line2");
    expect(escapeTableCell("line1\r\nline2")).toBe("line1 line2");
  });

  test("renders null/undefined as an empty string, not the literal 'null'", () => {
    expect(escapeTableCell(null)).toBe("");
  });

  test("stringifies numbers as-is", () => {
    expect(escapeTableCell(1850)).toBe("1850");
    expect(escapeTableCell(0)).toBe("0");
  });
});

describe("renderDebugDumpMarkdown", () => {
  const emptyDump = {
    chessGames: [],
    aiAnnotations: [],
    repertoireLines: [],
    embeddings: [],
    ftsAvailable: true,
  };

  test("shows a placeholder instead of an empty table for each empty section", () => {
    const md = renderDebugDumpMarkdown(emptyDump);
    expect(md).toContain("_(trống");
    expect(md).not.toContain("| page | white |"); // no chess_games header row rendered
  });

  test("reports when FTS5 is unavailable", () => {
    const md = renderDebugDumpMarkdown({ ...emptyDump, ftsAvailable: false });
    expect(md).toContain("❌ không");
  });

  test("renders one row per chess_games entry, including Phase 3 columns", () => {
    const md = renderDebugDumpMarkdown({
      ...emptyDump,
      chessGames: [
        {
          ref: "Page@0",
          page: "Page",
          white: "Alice",
          black: "Bob",
          result: "1-0",
          dateRaw: "2026.09.11",
          eco: "C50",
          event: "Casual",
          summary: "",
          whiteElo: 1850,
          blackElo: null,
          timeControl: "180+2",
          opening: "Italian Game",
          variation: "",
        },
      ],
    });
    expect(md).toContain(
      "| Page | Alice | Bob | 1-0 | C50 | 1850 |  | 180+2 | Italian Game |  |  |",
    );
  });

  test("renders repertoire_lines with SRS state columns", () => {
    const md = renderDebugDumpMarkdown({
      ...emptyDump,
      repertoireLines: [
        {
          ref: "Openings/Italian@0",
          page: "Openings/Italian",
          side: "White",
          eco: "C50",
          openingName: "Italian Game",
          variationName: "Main Line",
          movesSan: "e4 e5 Nf3 Nc6",
          dueDate: "2026-09-12",
          easeFactor: 2.5,
          intervalDays: 1,
          reviewCount: 1,
          lastGrade: "good",
        },
      ],
    });
    expect(md).toContain("Openings/Italian");
    expect(md).toContain("2026-09-12");
    expect(md).toContain("good");
  });
});
