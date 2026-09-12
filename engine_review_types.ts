// Local mirror of plugs/chess-engine/game_reviewer.ts's review result shapes.
// Duplicated (not imported cross-plug) so chess-ai builds standalone once
// split into its own repo — chess-engine's actual reviewGame()/
// isEngineNotInstalledError() are still called through
// ../chess-engine/plug_api.ts's syscall wrapper at runtime, only the TYPE
// shapes are copied here. Keep in sync with chess-engine/game_reviewer.ts by
// hand if that shape ever changes.

export type MoveClassification =
  | "brilliant" // !!
  | "great" // !
  | "best" // Best engine move
  | "good" // Minor difference
  | "inaccuracy" // ?! (CPL 30 - 75)
  | "mistake" // ? (CPL 75 - 150)
  | "blunder" // ?? (CPL > 150)
  | "book"; // Opening book move

export interface MoveListEntry {
  moveNum: number;
  isWhite: boolean;
  san: string;
  from: string;
  to: string;
  fenBefore: string;
  fenAfter: string;
}

export interface ReviewedMove extends MoveListEntry {
  scoreBefore: number; // in centipawns from White's perspective
  scoreAfter: number;
  cpl: number; // Centipawn loss (>= 0)
  classification: MoveClassification;
  bestMoveSan?: string;
}

export interface GameReviewReport {
  whiteAccuracy: number; // 0 - 100%
  blackAccuracy: number; // 0 - 100%
  whiteStats: Record<MoveClassification, number>;
  blackStats: Record<MoveClassification, number>;
  moves: ReviewedMove[];
  advantageGraph: { moveIdx: number; score: number }[]; // Scores from White perspective
}
