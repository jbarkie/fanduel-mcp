# fanduel-mcp

A read-only remote MCP server that gives Claude FanDuel Sportsbook's NFL lines and player props as fantasy football signals: implied team totals, prop lines with no-vig probabilities, anytime TD odds, and market-implied fantasy points. It's a companion to [fantasy-football-mcp](https://github.com/jbarkie/fantasy-football-mcp), which knows the rosters; this one knows what the betting market expects. Like that server, it runs statelessly on Cloudflare Workers Free.

It never logs in to FanDuel and never places bets. It only reads the public odds that the sportsbook website shows to logged-out visitors.

| Tool | What it returns |
|---|---|
| `get_games` | This week's (or a given week's) games: spread, total, implied team points, no-vig win probability, line movement, number of players with props |
| `get_player_props` | For named players: O/U lines (pass/rush/rec yards, receptions, pass TDs, rush+rec yards) with no-vig over probability and movement, anytime and 2+ TD odds, QB interception odds, expected stats, implied fantasy points |
| `get_game_props` | One game's lines plus every player's props, ranked by implied fantasy points |
| `rank_players` | Players across this week's slate ranked by implied fantasy points, anytime TD probability, or a prop line; filter by position or team |

**How the numbers are derived** (`src/odds.ts`, `src/tools.ts`):
- Two-way markets (O/U, spread, moneyline, interception yes/no) are de-vigged by normalizing both sides. Anytime and 2+ TD markets are one-sided, so their probabilities still include FanDuel's margin and run a little high.
- Implied team points = total / 2 ∓ spread / 2.
- Expected counts (pass TDs, INTs, receptions, rush+rec TDs) come from fitting a Poisson mean to the line and its no-vig price. Yardage uses the line itself; a line is a median, so expected yards run slightly higher than the line.
- `implied_fpts` scores those expectations with Sleeper defaults (4-point pass TD, -1 INT, 0.04/pass yd, 0.1/rush+rec yd, 6/TD) plus `ppr` (default), `half` or `standard` reception scoring. Fumbles and 2-point conversions are ignored. `not_priced` lists any market FanDuel didn't offer for that player, which leaves their total low.

**Keeping requests under the free plan's 10 ms CPU limit.** FanDuel's pages are about 1 MB per game. A GitHub Action fetches them hourly (every 20 minutes on Sunday late mornings, when inactives come out) and writes one compact ~80 KB slate to Workers KV. The Worker only reads that slate, and it uses the same small hand-written MCP handler as fantasy-football-mcp, so it has no runtime dependencies. In a local benchmark on 2026-10-21, a cold request (parse plus ranking all 388 players) took about 6.5 ms, and warm requests took under 1 ms.

**Data sources.** Every response includes `as_of`, `sources` and `data_gaps`.
- FanDuel Sportsbook's public web API (`sbapi.nj.sportsbook.fanduel.com`), which is unofficial and undocumented. It uses the web app's public `_ak` key. The `content-managed-page` endpoint lists games and their main lines, and the `event-page` endpoint (passing, receiving, rushing and TD-scorer tabs) has player props.
- ESPN's scoreboard calendar maps games to NFL weeks. ESPN's public player list supplies positions, matched on name and team; passers default to QB.
- Once a game kicks off, FanDuel switches to live odds. The cache job stops fetching that game and keeps its last pre-game lines and props from the previous slate.
- "Opened" values are the first line *this job* saw, not FanDuel's true opening line.

## Development

```sh
npm install
npm test                       # unit + tool tests on saved live data
npm run typecheck
npm run build-cache -- --out .cache/bulk.json
npx wrangler kv bulk put .cache/bulk.json --binding CACHE --local
echo MCP_PATH_TOKEN=devtoken > .dev.vars
npm run dev                    # serves /mcp/devtoken
npx tsx scripts/smoke.ts http://localhost:8787/mcp/devtoken
```

To refresh test fixtures, run `npm run build-cache -- --save-raw .cache/raw`, then run `npx tsx scripts/make-fixtures.ts .cache/raw <event id> <event id>` and update the assertions in `tests/`.

## Deploy (one time)

1. Run `npx wrangler login` (use the same Cloudflare account as fantasy-football-mcp).
2. Run `npx wrangler kv namespace create CACHE` and replace `REPLACE_WITH_KV_NAMESPACE_ID` in `wrangler.toml` with the returned id.
3. Run `openssl rand -hex 16 | npx wrangler secret put MCP_PATH_TOKEN`, then `npm run deploy`.
4. In this GitHub repo, set:
   - Secrets: `CLOUDFLARE_API_TOKEN` (needs the "Workers KV Storage: Edit" permission) and `CLOUDFLARE_ACCOUNT_ID`. The token from fantasy-football-mcp works.
   - Variable: `KV_NAMESPACE_ID`.
   Then run the "Refresh cache" workflow manually and check its log for the game and player counts.
5. On claude.ai, go to Settings → Connectors → Add custom connector. Enter `https://fanduel-mcp.<subdomain>.workers.dev/mcp/<token>` with no sign-in.
6. Add the snippet in `docs/claude-project-instructions.md` to the Fantasy Football Claude Project.

The URL token is the only access control. Keep the URL private so nobody else uses up the free quota.

## Notes

- FanDuel doesn't offer a public API, and its terms don't cover automated access. This reads only public, logged-out odds pages, about 60 requests an hour, for personal use. Don't run it commercially or at a higher rate. If FanDuel starts blocking GitHub's runners, the workflow fails with the HTTP status, and the Worker keeps serving the last slate and marks it stale after 3 hours.
- FanDuel usually posts props for the next week's games on Monday or Tuesday, and adds more players as the week goes on. Players who are out or have small roles get no props, and the tools say so instead of guessing.
- GitHub Actions on a private repo has 2,000 free minutes a month. This schedule runs about 780 times a month, and each run is billed as 1–2 minutes.
- GitHub disables scheduled workflows after 60 days without repo activity. If that happens, re-enable the workflow from the Actions tab.
