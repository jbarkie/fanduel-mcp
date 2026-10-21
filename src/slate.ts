// Assembles the cached slate from fetched pages. Kept free of I/O so tests run the same
// pipeline as the cache job.
import { assignPositions, carryOpeningLines, parseGames, parseProps, weekFor, weekWindows } from "./fanduel";
import type { GameLine, PlayerProps, Slate } from "./types";

// Props are only fetched for games kicking off within this window; later games rarely have any.
const PROPS_HORIZON_MS = 8 * 24 * 3600 * 1000;

// Started games are skipped: FanDuel now shows live in-game odds for them.
export const wantsProps = (g: { kickoff: string }, now: Date) => {
  const until = Date.parse(g.kickoff) - now.getTime();
  return until > 0 && until <= PROPS_HORIZON_MS;
};

export function gamesFromPages(page: any, scoreboard: any): GameLine[] {
  const windows = weekWindows(scoreboard);
  return parseGames(page).map((g) => ({ ...g, week: weekFor(g.kickoff, windows), props_fetched: false }));
}

export interface SlateInput {
  scoreboard: any;
  games: GameLine[]; // from gamesFromPages
  tabs: Map<string, any[]>; // event id -> its prop tab pages (only for games fetched)
  espnPlayers: any[] | null; // null when ESPN's list failed
  prev: Slate | null;
  now: Date;
}

export function buildSlate(input: SlateInput): { slate: Slate; warnings: string[] } {
  const { scoreboard, games, tabs, prev, now } = input;
  const warnings: string[] = [];
  if (!weekWindows(scoreboard).length) warnings.push("ESPN calendar had no regular-season weeks; games have week: null.");

  const players: PlayerProps[] = [];
  for (const g of games) {
    const pages = tabs.get(g.id);
    if (!pages) continue;
    players.push(...parseProps(g.id, pages));
    g.props_fetched = true;
  }

  // A started game keeps its last pre-game lines and props from the previous slate.
  if (prev) {
    for (const g of games.filter((g) => !g.props_fetched && Date.parse(g.kickoff) <= now.getTime())) {
      const old = prev.games.find((x) => x.id === g.id);
      if (old) Object.assign(g, { spread: old.spread, total: old.total, moneyline: old.moneyline });
      const kept = prev.players.filter((p) => p.game === g.id);
      if (kept.length) {
        players.push(...kept);
        g.props_fetched = true;
      }
    }
  }
  carryOpeningLines(games, players, prev);

  const unmatched = assignPositions(players, input.espnPlayers ?? [], games);
  if (input.espnPlayers === null) warnings.push("ESPN player list failed; positions are missing except QBs and defenses.");
  else if (unmatched) warnings.push(`${unmatched} players with props have no position (not in ESPN's player list).`);

  const season: number | null = scoreboard?.season?.year ?? null;
  const week: number | null = scoreboard?.season?.type === 2 ? scoreboard?.week?.number ?? null : null;
  return { slate: { season, week, games, players }, warnings };
}
