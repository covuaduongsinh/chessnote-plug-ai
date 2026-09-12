// Local mirror of plugs/chess/index.ts's ChessGameFields/ChessGameObject
// shape. Duplicated (not imported cross-plug) so chess-ai builds standalone
// once split into its own repo. Keep in sync by hand if that shape changes.

import type { ObjectValue } from "@silverbulletmd/silverbullet/type/index";

export interface ChessGameFields {
  page: string;
  pgn: string;
  white: string;
  black: string;
  result: string;
  date: string;
  eco: string;
  event: string;
  comments: string;
  whiteElo: string;
  blackElo: string;
  timeControl: string;
  opening: string;
  variation: string;
}

export type ChessGameObject = ObjectValue<ChessGameFields>;
