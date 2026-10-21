// Trims pages saved by `build-cache.ts --save-raw <dir>` into small test fixtures: two games'
// prop tabs, the NFL page's game markets, ESPN's calendar, and ESPN players in those games.
//   npx tsx scripts/make-fixtures.ts <raw dir> <event id> <event id>
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PROP_TABS } from "../src/fanduel";
import { normalizeName } from "../src/names";

const [rawDir, ...events] = process.argv.slice(2);
if (!rawDir || events.length === 0) throw new Error("usage: make-fixtures.ts <raw dir> <event id>...");
const out = join(import.meta.dirname, "..", "tests", "fixtures");
const read = (f: string) => JSON.parse(readFileSync(join(rawDir, f), "utf8"));
const write = (f: string, v: unknown) => writeFileSync(join(out, f), JSON.stringify(v));

const KEEP_RUNNER = ["selectionId", "runnerName", "handicap", "runnerStatus", "winRunnerOdds", "logo", "secondaryLogo"];
const KEEP_MARKET = ["marketId", "eventId", "marketName", "marketType", "marketStatus"];
const pick = (o: any, keys: string[]) => Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]));
const trimMarkets = (markets: Record<string, any>, keep: (m: any) => boolean) =>
  Object.fromEntries(Object.entries(markets).filter(([, m]) => keep(m)).map(([id, m]) => [id, { ...pick(m, KEEP_MARKET), runners: m.runners.map((r: any) => pick(r, KEEP_RUNNER)) }]));

const GAME_MARKETS = new Set(["MONEY_LINE", "MATCH_HANDICAP_(2-WAY)", "TOTAL_POINTS_(OVER/UNDER)"]);
const page = read("nfl_page.json");
write("nfl_page.json", {
  attachments: {
    events: page.attachments.events,
    markets: trimMarkets(page.attachments.markets, (m) => GAME_MARKETS.has(m.marketType)),
  },
});

const PROP_MARKET = /^PLAYER_X_(?!ALT_)|^ANY_TIME_TOUCHDOWN_SCORER$|^TO_SCORE_2\+_TOUCHDOWNS$|^PLAYER_[AB]_INTERCEPTION$/;
const names = new Set<string>();
for (const id of events) {
  for (const tab of PROP_TABS) {
    const p = read(`event_${id}_${tab}.json`);
    const markets = trimMarkets(p.attachments.markets ?? {}, (m) => PROP_MARKET.test(m.marketType));
    for (const m of Object.values(markets) as any[]) for (const r of m.runners) names.add(normalizeName(String(r.runnerName).replace(/ (Over|Under|Yes|No)$/, "")));
    write(`event_${id}_${tab}.json`, { attachments: { markets } });
  }
}

const board = read("espn_scoreboard.json");
write("espn_scoreboard.json", { season: board.season, week: { number: board.week.number }, leagues: [{ calendar: board.leagues[0].calendar }] });

const players = read("espn_players.json");
write("espn_players.json", players.filter((p: any) => names.has(normalizeName(p.fullName ?? ""))).map((p: any) => pick(p, ["id", "fullName", "proTeamId", "defaultPositionId"])));
console.log(`wrote fixtures for ${events.join(", ")}; ${names.size} player names`);
