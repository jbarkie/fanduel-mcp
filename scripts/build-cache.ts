// Fetches FanDuel's NFL lines and player props and writes one compact slate as a wrangler
// `kv bulk put` file. FanDuel's pages run to ~1 MB per game, far too much for a Workers
// Free request, so the Worker only ever reads this prebuilt slate.
//   npx tsx scripts/build-cache.ts --out .cache/bulk.json [--prev prev.json] [--save-raw dir]
// --prev is the slate currently in KV (`wrangler kv key get slate`); it carries opening lines
// and keeps pre-game lines for games in progress.
// --save-raw keeps every fetched page, for refreshing test fixtures (scripts/make-fixtures.ts).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { KEYS } from "../src/cache";
import { eventTabUrl, nflPageUrl, PROP_TABS } from "../src/fanduel";
import { buildSlate, gamesFromPages, wantsProps } from "../src/slate";
import type { Cached, Slate } from "../src/types";

const args = process.argv.slice(2);
const flag = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const out = flag("--out") ?? ".cache/bulk.json";
const prevFile = flag("--prev");
const rawDir = flag("--save-raw");
if (rawDir) mkdirSync(rawDir, { recursive: true });

async function getJson(url: string, saveAs: string, headers: Record<string, string> = {}): Promise<any> {
  const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (fanduel-mcp cache builder)", accept: "application/json", ...headers } });
  if (!res.ok) throw new Error(`${url.split("?")[0]} returned HTTP ${res.status}`);
  const body = await res.json();
  if (rawDir) writeFileSync(join(rawDir, saveAs), JSON.stringify(body));
  return body;
}

const now = new Date();
const warnings: string[] = [];

const scoreboard = await getJson("https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard", "espn_scoreboard.json");
const games = gamesFromPages(await getJson(nflPageUrl(), "nfl_page.json"), scoreboard);
if (!games.length) throw new Error("FanDuel's NFL page listed no games; refusing to overwrite the cache.");

const tabs = new Map<string, any[]>();
for (const g of games.filter((g) => wantsProps(g, now))) {
  try {
    const pages = [];
    for (const tab of PROP_TABS) pages.push(await getJson(eventTabUrl(g.id, tab), `event_${g.id}_${tab}.json`));
    tabs.set(g.id, pages);
  } catch (e) {
    warnings.push(`${g.away} @ ${g.home} props: ${(e as Error).message}`);
  }
}

// ESPN's public player list (no login) supplies positions.
let espnPlayers: any[] | null = null;
try {
  espnPlayers = await getJson(
    `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${scoreboard?.season?.year}/players?scoringPeriodId=0&view=players_wl`,
    "espn_players.json",
    { "x-fantasy-filter": JSON.stringify({ filterActive: { value: true } }) },
  );
} catch (e) {
  warnings.push(`ESPN player list: ${(e as Error).message}`);
}

// `wrangler kv key get` prints a message instead of JSON when the key is missing (first run).
let prev: Slate | null = null;
if (prevFile && existsSync(prevFile)) {
  try {
    prev = (JSON.parse(readFileSync(prevFile, "utf8")) as Cached<Slate>).data ?? null;
  } catch {
    console.log(`${prevFile} is not a cached slate; starting without opening lines.`);
  }
}
const built = buildSlate({ scoreboard, games, tabs, espnPlayers, prev, now });
const slate: Cached<Slate> = {
  data: built.slate,
  fetched_at: new Date().toISOString(),
  source: "fanduel-sportsbook-unofficial:content-managed-page + event-page; espn-unofficial:scoreboard + players_wl",
  warnings: [...warnings, ...built.warnings],
};
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify([{ key: KEYS.slate, value: JSON.stringify(slate) }]));
const s = slate.data;
console.log(`season ${s.season} week ${s.week}: ${s.games.length} games (${s.games.filter((g) => g.props_fetched).length} with props), ${s.players.length} players, ${(JSON.stringify(slate).length / 1024).toFixed(0)} KB`);
console.log(`warnings: ${slate.warnings.length ? slate.warnings.join(" | ") : "none"}`);
