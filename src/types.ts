// Two-way prop line: [line, over American odds, under American odds, first line this job saw].
export type Line = [number, number, number, number];

// Stat keys for FanDuel's main (non-alt) over/under player props.
export const STATS = ["pass_yds", "pass_tds", "rush_yds", "rec_yds", "receptions", "rush_rec_yds"] as const;
export type Stat = (typeof STATS)[number];

export interface PlayerProps {
  name: string;
  norm: string; // normalized name for lookups
  team: string | null; // NFL abbreviation
  pos: string | null; // from ESPN's player list; QB inferred from passing props when missing
  game: string; // FanDuel event id
  lines: Partial<Record<Stat, Line>>;
  anytime_td: number | null; // American odds
  two_plus_td: number | null;
  interception: [number, number] | null; // [yes, no] American odds; QBs only
}

export interface GameLine {
  id: string; // FanDuel event id
  week: number | null;
  kickoff: string; // ISO UTC
  away: string;
  home: string;
  // Home team's spread: [points, home odds, away odds, first points seen]. Negative = home favored.
  spread: Line | null;
  total: Line | null; // [points, over, under, first points seen]
  moneyline: [number, number] | null; // [home, away]
  props_fetched: boolean;
}

export interface Slate {
  season: number | null;
  week: number | null; // ESPN's current week (regular season only)
  games: GameLine[];
  players: PlayerProps[];
}

export interface Cached<T> {
  data: T;
  fetched_at: string;
  source: string;
  warnings: string[];
}
