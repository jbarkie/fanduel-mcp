// FanDuel Sportsbook's public (unofficial, undocumented) web API and the parsers that turn
// its pages into compact cache records. Only the cache job calls FanDuel; the Worker
// reads the result from KV.
import { normalizeName } from "./names";
import { ESPN_TEAMS, isDefense, TEAMS, teamFromDefense, teamFromLogo } from "./teams";
import type { GameLine, Line, PlayerProps, Stat } from "./types";

// The sportsbook web app's public app key. Odds are the same across state hosts; NJ is used.
export const FD_API = "https://sbapi.nj.sportsbook.fanduel.com/api";
export const FD_KEY = "FhMFpcPWXMeyZxOx";
export const PROP_TABS = ["passing-props", "receiving-props", "rushing-props", "td-scorer-props"];

export const nflPageUrl = () => `${FD_API}/content-managed-page?page=CUSTOM&customPageId=nfl&_ak=${FD_KEY}&timezone=America%2FNew_York`;
export const eventTabUrl = (eventId: string, tab: string) => `${FD_API}/event-page?_ak=${FD_KEY}&eventId=${eventId}&tab=${tab}`;

const STAT_NAMES: Record<string, Stat> = {
  "Passing Yds": "pass_yds",
  "Passing TDs": "pass_tds",
  "Rushing Yds": "rush_yds",
  "Receiving Yds": "rec_yds",
  "Total Receptions": "receptions",
  "Rushing + Receiving Yds": "rush_rec_yds",
};

const odds = (r: any): number | null => {
  const o = r?.winRunnerOdds?.americanDisplayOdds;
  const v = o?.americanOddsInt ?? o?.americanOdds;
  return typeof v === "number" && r.runnerStatus === "ACTIVE" ? v : null;
};
const openMarkets = (page: any): any[] => Object.values(page?.attachments?.markets ?? {}).filter((m: any) => m.marketStatus === "OPEN");

// NFL games ("Away Team @ Home Team") with their spread, total and moneyline.
export function parseGames(page: any): Omit<GameLine, "week" | "props_fetched">[] {
  const markets = openMarkets(page);
  const games: Omit<GameLine, "week" | "props_fetched">[] = [];
  for (const e of Object.values(page?.attachments?.events ?? {}) as any[]) {
    const [awayName, homeName] = String(e.name).split(" @ ");
    const away = TEAMS[awayName], home = TEAMS[homeName];
    if (!away || !home) continue; // futures, specials, draft
    const id = String(e.eventId);
    const mine = markets.filter((m) => String(m.eventId) === id);
    const byType = (t: string) => mine.find((m) => m.marketType === t);
    const runner = (m: any, name: string) => m?.runners.find((r: any) => r.runnerName === name);

    let spread: Line | null = null;
    const s = byType("MATCH_HANDICAP_(2-WAY)");
    const sh = runner(s, homeName), sa = runner(s, awayName);
    if (sh && sa && odds(sh) !== null && odds(sa) !== null) spread = [sh.handicap, odds(sh)!, odds(sa)!, sh.handicap];

    let total: Line | null = null;
    const t = byType("TOTAL_POINTS_(OVER/UNDER)");
    const over = runner(t, "Over"), under = runner(t, "Under");
    if (over && under && odds(over) !== null && odds(under) !== null) total = [over.handicap, odds(over)!, odds(under)!, over.handicap];

    let moneyline: [number, number] | null = null;
    const ml = byType("MONEY_LINE");
    const mh = odds(runner(ml, homeName)), ma = odds(runner(ml, awayName));
    if (mh !== null && ma !== null) moneyline = [mh, ma];

    games.push({ id, kickoff: new Date(e.openDate).toISOString(), away, home, spread, total, moneyline });
  }
  return games.sort((a, b) => a.kickoff.localeCompare(b.kickoff) || a.id.localeCompare(b.id));
}

// Player props for one game, merged across FanDuel's prop tabs (markets repeat between tabs).
export function parseProps(eventId: string, tabs: any[]): PlayerProps[] {
  const seen = new Set<string>();
  const markets = tabs.flatMap(openMarkets).filter((m) => String(m.eventId) === eventId && !seen.has(m.marketId) && seen.add(m.marketId));
  const players = new Map<string, PlayerProps>();
  const get = (name: string, team: string | null) => {
    const norm = normalizeName(name);
    let p = players.get(norm);
    if (!p) {
      p = { name, norm, team: team ?? teamFromDefense(name), pos: isDefense(name) ? "DEF" : null, game: eventId, lines: {}, anytime_td: null, two_plus_td: null, interception: null };
      players.set(norm, p);
    }
    p.team ??= team;
    return p;
  };

  for (const m of markets) {
    const type: string = m.marketType;
    if (/^PLAYER_X_(?!ALT_)/.test(type)) {
      const [name, statName] = String(m.marketName).split(" - ");
      const stat = STAT_NAMES[statName];
      const over = m.runners.find((r: any) => r.runnerName === `${name} Over`);
      const under = m.runners.find((r: any) => r.runnerName === `${name} Under`);
      if (!stat || !over || !under || odds(over) === null || odds(under) === null) continue;
      get(name, teamFromLogo(over.secondaryLogo ?? over.logo)).lines[stat] = [over.handicap, odds(over)!, odds(under)!, over.handicap];
    } else if (type === "ANY_TIME_TOUCHDOWN_SCORER" || type === "TO_SCORE_2+_TOUCHDOWNS") {
      for (const r of m.runners) {
        const o = odds(r);
        if (o === null) continue;
        const p = get(r.runnerName, teamFromLogo(r.secondaryLogo ?? r.logo));
        if (type === "ANY_TIME_TOUCHDOWN_SCORER") p.anytime_td = o;
        else p.two_plus_td = o;
      }
    } else if (/^PLAYER_[AB]_INTERCEPTION$/.test(type)) {
      const yes = m.runners.find((r: any) => / Yes$/.test(r.runnerName));
      const no = m.runners.find((r: any) => / No$/.test(r.runnerName));
      if (!yes || !no || odds(yes) === null || odds(no) === null) continue;
      get(yes.runnerName.replace(/ Yes$/, ""), teamFromLogo(yes.secondaryLogo ?? yes.logo)).interception = [odds(yes)!, odds(no)!];
    }
  }
  return [...players.values()];
}

// Regular-season week windows from ESPN's scoreboard calendar.
export function weekWindows(scoreboard: any): Array<{ week: number; start: number; end: number }> {
  const regular = scoreboard?.leagues?.[0]?.calendar?.find((c: any) => c.label === "Regular Season");
  return (regular?.entries ?? []).map((e: any) => ({ week: Number(e.value), start: Date.parse(e.startDate), end: Date.parse(e.endDate) }));
}

export const weekFor = (kickoff: string, windows: ReturnType<typeof weekWindows>) =>
  windows.find((w) => Date.parse(kickoff) >= w.start && Date.parse(kickoff) <= w.end)?.week ?? null;

// Positions from ESPN's public player list, matched on name + team, then on name alone when
// that is unique. Players ESPN can't place keep null, except passers, who are QBs. A player
// FanDuel shows without a team logo takes ESPN's team when it is one of the game's teams.
const ESPN_POSITIONS: Record<number, string> = { 1: "QB", 2: "RB", 3: "WR", 4: "TE", 5: "K" };
export function assignPositions(players: PlayerProps[], espnPlayers: any[], games: GameLine[]): number {
  const byKey = new Map<string, string>();
  const byName = new Map<string, Array<{ pos: string; team: string | null }>>();
  for (const e of espnPlayers) {
    const pos = ESPN_POSITIONS[e.defaultPositionId];
    if (!pos || !e.fullName) continue;
    const norm = normalizeName(e.fullName);
    const team = ESPN_TEAMS[e.proTeamId] ?? null;
    byKey.set(`${norm}|${team ?? ""}`, pos);
    byName.set(norm, [...(byName.get(norm) ?? []), { pos, team }]);
  }
  const gameTeams = new Map(games.map((g) => [g.id, [g.home, g.away]]));
  let unmatched = 0;
  for (const p of players) {
    const named = byName.get(p.norm);
    const only = named?.length === 1 ? named[0] : null;
    if (!p.team && only?.team && gameTeams.get(p.game)?.includes(only.team)) p.team = only.team;
    if (p.pos) continue;
    p.pos = byKey.get(`${p.norm}|${p.team ?? ""}`) ?? only?.pos ?? (p.lines.pass_yds ? "QB" : null);
    if (!p.pos) unmatched++;
  }
  return unmatched;
}

// Keeps the first line the cache job saw for each game and player prop, so tools can show
// movement. Lines that disappear and come back start fresh.
export function carryOpeningLines(games: GameLine[], players: PlayerProps[], prev: { games: GameLine[]; players: PlayerProps[] } | null) {
  if (!prev) return;
  const prevGames = new Map(prev.games.map((g) => [g.id, g]));
  for (const g of games) {
    const old = prevGames.get(g.id);
    if (g.spread && old?.spread) g.spread[3] = old.spread[3];
    if (g.total && old?.total) g.total[3] = old.total[3];
  }
  const prevPlayers = new Map(prev.players.map((p) => [`${p.game}|${p.norm}`, p]));
  for (const p of players) {
    const old = prevPlayers.get(`${p.game}|${p.norm}`);
    if (!old) continue;
    for (const [stat, line] of Object.entries(p.lines) as Array<[Stat, Line]>) {
      const was = old.lines[stat];
      if (was) line[3] = was[3];
    }
  }
}
