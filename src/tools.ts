import type { DataCache } from "./cache";
import { normalizeName } from "./names";
import { BASE_SCORING, impliedPoints, impliedProb, noVig, poissonMean, round, SCORING, type ScoringPreset } from "./odds";
import { resolveTeam } from "./teams";
import type { Cached, GameLine, Line, PlayerProps, Slate, Stat } from "./types";

export interface Deps {
  cache: DataCache;
  now: () => Date;
}

const SOURCES = {
  odds: "FanDuel Sportsbook public web API (UNOFFICIAL, undocumented), cached about hourly",
  weeks: "ESPN scoreboard calendar (UNOFFICIAL)",
  positions: "ESPN public player list (UNOFFICIAL)",
};

const METHOD =
  "Probabilities are no-vig (both sides normalized) except TD odds, which are one-sided and include FanDuel's margin. " +
  "Expected counts (TDs, INTs, receptions) come from a Poisson fit to each line and price; yardage uses the line itself, " +
  "which is a median and runs a little below the mean. implied_fpts scores these expectations with Sleeper defaults " +
  "(4-pt pass TD, -1 INT, 0.04/pass yd, 0.1/rush+rec yd, 6/TD) and ignores fumbles and 2-pt conversions.";

// The cache job runs hourly; allow for GitHub's cron delays before calling it stale.
const STALE_MS = 3 * 3600 * 1000;

interface Loaded {
  slate: Slate;
  cached: Cached<Slate>;
  games: Map<string, GameLine>;
  now: Date;
  gaps: string[];
}

async function load(deps: Deps): Promise<Loaded> {
  const cached = await deps.cache.slate();
  if (!cached) throw new Error("No FanDuel data is cached yet. Run the \"Refresh cache\" GitHub workflow.");
  const now = deps.now();
  const gaps = [...cached.warnings.map((w) => `Cache warning: ${w}`)];
  if (now.getTime() - Date.parse(cached.fetched_at) > STALE_MS) gaps.push(`FanDuel cache is stale (fetched ${cached.fetched_at}); lines may have moved.`);
  return { slate: cached.data, cached, games: new Map(cached.data.games.map((g) => [g.id, g])), now, gaps };
}

// This week's games: ESPN's current week, or (outside the regular season) the next 8 days.
function weekGames(d: Loaded, week?: number) {
  const w = week ?? d.slate.week;
  if (w != null) return d.slate.games.filter((g) => g.week === w);
  const t = d.now.getTime();
  return d.slate.games.filter((g) => Date.parse(g.kickoff) > t - 12 * 3600 * 1000 && Date.parse(g.kickoff) < t + 8 * 24 * 3600 * 1000);
}

function scopeGaps(d: Loaded, games: GameLine[]) {
  const gaps: string[] = [];
  const noProps = games.filter((g) => !g.props_fetched).map(label);
  if (noProps.length) gaps.push(`No player props cached for: ${noProps.join(", ")} (not posted yet, or the game started before the first fetch).`);
  const started = games.filter((g) => hasStarted(d, g)).map(label);
  if (started.length) gaps.push(`Started games show their last pre-game lines: ${started.join(", ")}.`);
  return gaps;
}

const label = (g: GameLine) => `${g.away} @ ${g.home}`;
const hasStarted = (d: Loaded, g: GameLine) => Date.parse(g.kickoff) <= d.now.getTime();

function envelope(d: Loaded, body: Record<string, unknown>, extraGaps: string[] = [], method = false) {
  return {
    season: d.slate.season,
    current_week: d.slate.week,
    ...body,
    ...(method ? { method: METHOD } : {}),
    as_of: d.cached.fetched_at,
    sources: SOURCES,
    data_gaps: [...d.gaps, ...extraGaps],
  };
}

const moved = (l: Line) => (l[0] !== l[3] ? { opened: l[3] } : {});

function gameView(d: Loaded, g: GameLine, playerCount: number) {
  const out: Record<string, unknown> = {
    game: label(g),
    game_id: g.id,
    week: g.week,
    kickoff: g.kickoff,
    started: hasStarted(d, g),
  };
  if (g.spread) {
    const h = g.spread[0];
    out.spread = { line: h === 0 ? "PK" : h < 0 ? `${g.home} ${h}` : `${g.away} ${-h}`, home_spread: h, ...(h !== g.spread[3] ? { home_spread_opened: g.spread[3] } : {}) };
  }
  if (g.total) out.total = { points: g.total[0], over_prob: round(noVig(g.total[1], g.total[2]), 3), ...moved(g.total) };
  if (g.total && g.spread) {
    const p = impliedPoints(g.total[0], g.spread[0]);
    out.implied_points = { [g.away]: round(p.away), [g.home]: round(p.home) };
  }
  if (g.moneyline) {
    const home = noVig(g.moneyline[0], g.moneyline[1]);
    out.win_prob = { [g.away]: round(1 - home, 3), [g.home]: round(home, 3) };
    out.moneyline = { [g.away]: g.moneyline[1], [g.home]: g.moneyline[0] };
  }
  out.players_with_props = playerCount;
  return out;
}

// Market-implied stat expectations and fantasy points.
function expectations(p: PlayerProps, scoring: ScoringPreset) {
  const L = p.lines;
  const ov = (l: Line) => noVig(l[1], l[2]);
  const count = (l: Line | undefined) => (l ? poissonMean(Math.ceil(l[0]), ov(l)) : null);
  let rush = L.rush_yds?.[0] ?? null, rec = L.rec_yds?.[0] ?? null;
  const combo = L.rush_rec_yds?.[0] ?? null;
  // Fill one side from the combined line when FanDuel only prices one of them.
  if (combo !== null && rush !== null && rec === null) rec = Math.max(0, combo - rush);
  if (combo !== null && rec !== null && rush === null) rush = Math.max(0, combo - rec);
  const exp = {
    pass_yds: L.pass_yds?.[0] ?? null,
    pass_tds: count(L.pass_tds),
    ints: p.interception ? poissonMean(1, noVig(p.interception[0], p.interception[1])) : null,
    rush_yds: rush,
    rec_yds: rec,
    rush_rec_yds: rush === null && rec === null ? combo : null,
    receptions: count(L.receptions),
    tds: p.anytime_td !== null ? poissonMean(1, impliedProb(p.anytime_td)) : null,
  };

  const isQB = p.pos === "QB";
  const missing: string[] = [];
  if (isQB) {
    if (exp.pass_yds === null) missing.push("pass_yds");
    if (exp.pass_tds === null) missing.push("pass_tds");
    if (exp.ints === null) missing.push("interception");
  } else {
    if (exp.rush_yds === null && exp.rec_yds === null && exp.rush_rec_yds === null) missing.push("yards");
    if (p.pos !== "RB" && exp.receptions === null) missing.push("receptions");
  }
  if (exp.tds === null) missing.push("anytime_td");

  const hasYards = exp.pass_yds !== null || exp.rush_yds !== null || exp.rec_yds !== null || exp.rush_rec_yds !== null;
  const s = { ...BASE_SCORING, ...SCORING[scoring] };
  const fpts = hasYards && p.pos !== "DEF"
    ? (exp.pass_yds ?? 0) * s.pass_yd + (exp.pass_tds ?? 0) * s.pass_td + (exp.ints ?? 0) * s.int +
      ((exp.rush_yds ?? 0) + (exp.rec_yds ?? 0) + (exp.rush_rec_yds ?? 0)) * s.rush_yd +
      (exp.receptions ?? 0) * s.rec + (exp.tds ?? 0) * s.td
    : null;
  const expected = Object.fromEntries(Object.entries(exp).filter(([, v]) => v !== null).map(([k, v]) => [k, round(v!)]));
  return { expected, implied_fpts: fpts === null ? null : round(fpts, 1), missing };
}

function playerView(d: Loaded, p: PlayerProps, scoring: ScoringPreset) {
  const g = d.games.get(p.game);
  const props = Object.fromEntries(
    (Object.entries(p.lines) as Array<[Stat, Line]>).map(([stat, l]) => [stat, { line: l[0], over: l[1], under: l[2], over_prob: round(noVig(l[1], l[2]), 3), ...moved(l) }]),
  );
  const opp = g && p.team ? (p.team === g.home ? g.away : p.team === g.away ? g.home : null) : null;
  const e = expectations(p, scoring);
  return {
    name: p.name,
    team: p.team,
    pos: p.pos,
    opponent: opp,
    game: g ? label(g) : p.game,
    week: g?.week ?? null,
    kickoff: g?.kickoff ?? null,
    started: g ? hasStarted(d, g) : false,
    props,
    anytime_td: p.anytime_td === null ? null : { odds: p.anytime_td, implied_prob: round(impliedProb(p.anytime_td), 3) },
    two_plus_td: p.two_plus_td === null ? null : { odds: p.two_plus_td, implied_prob: round(impliedProb(p.two_plus_td), 3) },
    ...(p.interception ? { interception: { yes: p.interception[0], no: p.interception[1], prob: round(noVig(p.interception[0], p.interception[1]), 3) } } : {}),
    expected: e.expected,
    implied_fpts: e.implied_fpts,
    ...(e.missing.length ? { not_priced: e.missing } : {}),
  };
}

// Exact normalized name, then a unique "all words present" match. An optional trailing
// team ("Mike Williams NYJ") narrows duplicates.
function resolvePlayer(players: PlayerProps[], query: string): { hit?: PlayerProps; candidates?: PlayerProps[] } {
  const words = query.trim().split(/\s+/);
  const team = words.length > 1 ? resolveTeam(words[words.length - 1]) : null;
  const q = normalizeName(team ? words.slice(0, -1).join(" ") : query);
  const pool = team ? players.filter((p) => p.team === team) : players;
  const exact = pool.filter((p) => p.norm === q);
  if (exact.length === 1) return { hit: exact[0] };
  if (exact.length > 1) return { candidates: exact };
  const tokens = q.split(" ").filter(Boolean);
  const partial = pool.filter((p) => tokens.every((t) => p.norm.split(" ").some((w) => w.startsWith(t))));
  if (partial.length === 1) return { hit: partial[0] };
  return { candidates: partial };
}

const candidateView = (d: Loaded, p: PlayerProps) => ({ name: p.name, team: p.team, pos: p.pos, game: d.games.get(p.game) ? label(d.games.get(p.game)!) : p.game });

function findGame(d: Loaded, query: string, games: GameLine[]): GameLine {
  const id = games.find((g) => g.id === query.trim());
  if (id) return id;
  const parts = query.split(/\s*@\s*|\s+(?:vs\.?|v\.?|at)\s+/i).map((s) => s.trim()).filter(Boolean);
  const teams = parts.map(resolveTeam);
  if (teams.some((t) => t === null)) throw new Error(`Unknown team in "${query}". Use a team name or abbreviation, e.g. "CHI" or "Patriots @ Bears".`);
  const hits = games.filter((g) => teams.every((t) => g.home === t || g.away === t));
  if (hits.length === 0) throw new Error(`No game this week for ${teams.join(" and ")}. This week: ${games.map(label).join(", ")}`);
  return hits[0];
}

export async function getGames(deps: Deps, team?: string, week?: number) {
  const d = await load(deps);
  let games = weekGames(d, week);
  if (week !== undefined && games.length === 0) {
    const listed = [...new Set(d.slate.games.map((g) => g.week).filter((w) => w !== null))];
    throw new Error(`FanDuel lists no games for week ${week}. Weeks listed: ${listed.join(", ") || "none"}.`);
  }
  if (team) {
    const t = resolveTeam(team);
    if (!t) throw new Error(`Unknown team "${team}".`);
    games = games.filter((g) => g.home === t || g.away === t);
  }
  const counts = new Map<string, number>();
  for (const p of d.slate.players) counts.set(p.game, (counts.get(p.game) ?? 0) + 1);
  return envelope(d, { week: week ?? d.slate.week, games: games.map((g) => gameView(d, g, counts.get(g.id) ?? 0)) }, scopeGaps(d, games));
}

export async function getPlayerProps(deps: Deps, names: string[], scoring: ScoringPreset) {
  const d = await load(deps);
  // This week's games first, so a player with props in next week's game too isn't ambiguous.
  const thisWeek = new Set(weekGames(d).map((g) => g.id));
  const current = d.slate.players.filter((p) => thisWeek.has(p.game));
  const players = names.map((name) => {
    let r = resolvePlayer(current, name);
    if (!r.hit && !r.candidates?.length) r = resolvePlayer(d.slate.players, name);
    if (r.hit) return { query: name, ...playerView(d, r.hit, scoring) };
    if (r.candidates?.length) return { query: name, status: "ambiguous", candidates: r.candidates.slice(0, 8).map((p) => candidateView(d, p)) };
    return {
      query: name,
      status: "no_props",
      reason: "FanDuel has no props for this name this week. It skips players who are out, on bye, or in small roles; props may also not be posted yet for later games.",
    };
  });
  return envelope(d, { scoring, players }, scopeGaps(d, weekGames(d)), true);
}

export async function getGameProps(deps: Deps, game: string, scoring: ScoringPreset) {
  const d = await load(deps);
  const g = findGame(d, game, weekGames(d));
  const players = d.slate.players.filter((p) => p.game === g.id).map((p) => playerView(d, p, scoring));
  players.sort((a, b) => (b.implied_fpts ?? -1) - (a.implied_fpts ?? -1) || (b.anytime_td?.implied_prob ?? 0) - (a.anytime_td?.implied_prob ?? 0));
  return envelope(d, { scoring, ...gameView(d, g, players.length), players }, scopeGaps(d, [g]), true);
}

export const RANK_STATS = ["implied_fpts", "anytime_td", "pass_yds", "pass_tds", "rush_yds", "rec_yds", "receptions", "rush_rec_yds"] as const;
export type RankStat = (typeof RANK_STATS)[number];

export async function rankPlayers(deps: Deps, stat: RankStat, scoring: ScoringPreset, opts: { position?: string; team?: string; limit: number; include_started?: boolean }) {
  const d = await load(deps);
  const games = weekGames(d).filter((g) => opts.include_started || !hasStarted(d, g));
  const ids = new Set(games.map((g) => g.id));
  const team = opts.team ? resolveTeam(opts.team) : null;
  if (opts.team && !team) throw new Error(`Unknown team "${opts.team}".`);
  const pool = d.slate.players.filter((p) => ids.has(p.game) && (!opts.position || p.pos === opts.position) && (!team || p.team === team));
  const value = (p: PlayerProps, v: ReturnType<typeof playerView>) =>
    stat === "implied_fpts" ? v.implied_fpts : stat === "anytime_td" ? v.anytime_td?.implied_prob ?? null : p.lines[stat]?.[0] ?? null;
  const ranked = pool
    .map((p) => ({ p, v: playerView(d, p, scoring) }))
    .map((x) => ({ ...x, value: value(x.p, x.v) }))
    .filter((x) => x.value !== null)
    .sort((a, b) => b.value! - a.value!)
    .slice(0, opts.limit)
    .map(({ v, value }, i) => ({ rank: i + 1, value, ...v }));
  const gaps = scopeGaps(d, games);
  if (!opts.include_started && games.length < weekGames(d).length) gaps.push("Games that already started are left out (pass include_started to keep them).");
  if (stat === "implied_fpts") gaps.push("Players whose not_priced list includes yards or anytime_td are under-projected; FanDuel posts fewer props for low-volume players.");
  return envelope(d, { scoring, stat, ...(opts.position ? { position: opts.position } : {}), ...(team ? { team } : {}), players: ranked }, gaps, true);
}
