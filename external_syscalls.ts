// Local mirror of the thin plug_api.ts wrappers chess-ai calls into on
// chess-core (chess.*), chess-engine (chess-engine.* / chess.engine*), and
// chess-db (chessSql.*/chessEmbedding.*) — duplicated here (rather than
// importing ../chess/plug_api.ts, ../chess-engine/plug_api.ts,
// ../chess-db/plug_api.ts directly) so chess-ai builds standalone once split
// into its own repo: the syscall names below are just strings, resolved at
// runtime against whichever installed plug backs them, so this file needs
// nothing beyond the standard, unmodified SilverBullet plug-api to build.
import { syscall } from "@silverbulletmd/silverbullet/syscall";
import {
  type ParseTree,
  renderToText,
} from "@silverbulletmd/silverbullet/lib/tree";
import type { ChessGameObject } from "./chess_game_types.ts";
import type { GameReviewReport } from "./engine_review_types.ts";

// ---- index (standard, non-chess plug — index.extractFrontmatter) ----
// See plugs/chess/external_syscalls.ts's extractFrontMatter doc comment for
// why this goes through the documented syscall instead of importing
// plugs/index/frontmatter.ts directly.

export type FrontMatter = { tags?: string[] } & Record<string, any>;

export async function extractFrontMatter(tree: ParseTree): Promise<FrontMatter> {
  const { frontmatter } = await syscall(
    "index.extractFrontmatter",
    renderToText(tree),
  );
  return frontmatter;
}

// ---- chess-core (chess.*) ----

export function extractKeywords(question: string): Promise<string[]> {
  return syscall("chess.textExtractKeywords", question);
}

export function extractChessGames(
  pageName: string,
  tree: ParseTree,
): Promise<ChessGameObject[]> {
  return syscall("chess.extractChessGames", pageName, tree);
}

// ---- chess-engine (chess.reviewGame / EngineNotInstalledError) ----

export function reviewGame(
  pgn: string,
  depth?: number,
): Promise<GameReviewReport> {
  return syscall("chess.reviewGame", pgn, depth);
}

// Mirrors plugs/chess-engine/arasan_engine.ts's ENGINE_NOT_INSTALLED_MESSAGE
// — a syscall error crossing the plug Worker boundary only carries
// `.message` (client/plugos/worker_runtime.ts), losing the
// EngineNotInstalledError class identity, so callers must match on this
// string instead of `instanceof`. Keep in sync by hand if that message ever
// changes.
const ENGINE_NOT_INSTALLED_MESSAGE =
  "Không tìm thấy file engine Arasan (arasan.wasm / arasanv8-20260906.nnue). " +
  "Bản build ChessNote chuẩn luôn kèm sẵn 2 file này — nếu thiếu, có thể đây là " +
  "bản build tùy chỉnh đã lược bỏ libraries/Library/Chess, hoặc Space này có file " +
  "trùng tên đang che khuất chúng.";

export function isEngineNotInstalledError(e: unknown): boolean {
  return e instanceof Error && e.message === ENGINE_NOT_INSTALLED_MESSAGE;
}

// ---- chess-db (chessSql.* / chessEmbedding.*) ----

export interface OpeningStatsQuery {
  playerName: string;
  sinceDate?: string;
}

export interface OpeningStatsRow {
  eco: string;
  wins: number;
  losses: number;
  draws: number;
  total: number;
}

export function queryOpeningStats(
  query: OpeningStatsQuery,
): Promise<OpeningStatsRow[]> {
  return syscall("chessSql.queryOpeningStats", query);
}

export interface SearchGamesQuery {
  keywords: string[];
  limit: number;
}

export interface SearchGameRow {
  ref: string;
  page: string;
  white: string;
  black: string;
  result: string;
  eco: string;
  event: string;
  summary: string;
}

export function searchGames(query: SearchGamesQuery): Promise<SearchGameRow[]> {
  return syscall("chessSql.searchGames", query);
}

export interface AiAnnotationUpsert {
  ref: string;
  page: string;
  summary: string;
  tags: string[];
  confidence: number | null;
  modelVersion: string;
}

export function upsertAiAnnotation(
  annotation: AiAnnotationUpsert,
): Promise<void> {
  return syscall("chessSql.upsertAiAnnotation", annotation);
}

export interface DebugChessGameRow {
  ref: string;
  page: string;
  white: string;
  black: string;
  result: string;
  dateRaw: string;
  eco: string;
  event: string;
  summary: string;
  whiteElo: number | null;
  blackElo: number | null;
  timeControl: string;
  opening: string;
  variation: string;
}

export interface DebugAiAnnotationRow {
  ref: string;
  page: string;
  summary: string;
  confidence: number | null;
  modelVersion: string | null;
  generatedAt: string | null;
  tags: string;
}

export interface RepertoireLineRow {
  ref: string;
  page: string;
  side: string;
  eco: string;
  openingName: string;
  variationName: string;
  movesSan: string;
  dueDate: string | null;
  easeFactor: number;
  intervalDays: number;
  reviewCount: number;
  lastGrade: string | null;
}

export interface DebugEmbeddingRow {
  ref: string;
  page: string;
  modelId: string;
  computedAt: string;
}

export interface DebugDump {
  chessGames: DebugChessGameRow[];
  aiAnnotations: DebugAiAnnotationRow[];
  repertoireLines: RepertoireLineRow[];
  embeddings: DebugEmbeddingRow[];
  ftsAvailable: boolean;
}

export function debugDump(): Promise<DebugDump> {
  return syscall("chessSql.debugDump");
}

export function computeForGame(
  ref: string,
  page: string,
  text: string,
): Promise<void> {
  return syscall("chessEmbedding.computeForGame", ref, page, text);
}

export function hasAnyEmbeddings(): Promise<boolean> {
  return syscall("chessEmbedding.hasAnyEmbeddings");
}

export interface EmbeddingSearchQuery {
  queryText: string;
  limit: number;
}

export type EmbeddingSearchRow = SearchGameRow & { score: number };

export function search(
  query: EmbeddingSearchQuery,
): Promise<EmbeddingSearchRow[]> {
  return syscall("chessEmbedding.search", query);
}
