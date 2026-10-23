# fanduel-mcp

A read-only remote MCP server that lets Claude explore FanDuel Sportsbook's NFL betting markets: spreads, totals, moneylines, player prop lines and anytime touchdown odds, with the sportsbook's margin removed where possible. It runs statelessly on Cloudflare Workers Free.

It never logs in to FanDuel and never places bets. It only reads the public odds that the sportsbook website shows to logged-out visitors, and it covers FanDuel alone, so it can't compare prices across sportsbooks.

| Tool | What it returns |
|---|---|
| `get_games` | This week's (or a given week's) games: spread, total, moneyline, implied team points, win probability, line movement, number of players with props |
| `get_player_props` | For named players: over/under lines (pass/rush/rec yards, receptions, pass TDs, rush+rec yards) with odds, no-vig over probability and movement, anytime and 2+ TD odds, QB interception odds |
| `get_game_props` | One game's lines plus every player's props, listed by anytime TD probability |
| `rank_players` | Players across this week's slate ranked by anytime TD probability or a prop line; filter by position or team |

**How the numbers are derived** (`src/odds.ts`, `src/tools.ts`):
- Two-way markets (over/under, spread, moneyline, interception yes/no) have the margin removed by normalizing both sides. Anytime and 2+ TD markets are one-sided, so their probabilities still include FanDuel's margin and run a little high.
- Implied team points = total / 2 ∓ spread / 2.
- A prop line is roughly the median outcome, not the average.

**Keeping requests under the free plan's 10 ms CPU limit.** FanDuel's pages are about 1 MB per game. A GitHub Action fetches them hourly (every 20 minutes on Sunday late mornings, when inactives come out) and writes one compact ~80 KB slate to Workers KV. The Worker only reads that slate, and it uses the small hand-written MCP handler, so it has no runtime dependencies. In a local benchmark on 2026-10-21, a cold request (parse plus ranking all 388 players) took a few milliseconds, and warm requests took under 1 ms.

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

1. Run `npx wrangler login` .
2. Run `npx wrangler kv namespace create fanduel-mcp-cache` (the name must be unique in your account) and put the returned id in `wrangler.toml`. Keep the binding name `CACHE`.
3. Run `openssl rand -hex 16 | npx wrangler secret put MCP_PATH_TOKEN`, then `npm run deploy`.
4. In this GitHub repo, set:
   - Secrets: `CLOUDFLARE_API_TOKEN` (needs the "Workers KV Storage: Edit" permission) and `CLOUDFLARE_ACCOUNT_ID`.
   - Variable: `KV_NAMESPACE_ID`.
   Then run the "Refresh cache" workflow manually and check its log for the game and player counts.
5. On claude.ai, go to Settings → Connectors → Add custom connector. Enter `https://fanduel-mcp.<subdomain>.workers.dev/mcp/<token>` with no sign-in.
6. Paste the block in `docs/claude-project-instructions.md` into a Claude Project's instructions.

The URL token is the only access control. Keep the URL private so nobody else uses up the free quota.

## Notes

- FanDuel doesn't offer a public API, and its terms don't cover automated access. This reads only public, logged-out odds pages, about 60 requests an hour, for personal use. Don't run it commercially or at a higher rate. If FanDuel starts blocking GitHub's runners, the workflow fails with the HTTP status, and the Worker keeps serving the last slate and marks it stale after 3 hours.
- FanDuel usually posts props for the next week's games on Monday or Tuesday, and adds more players as the week goes on. Players who are out or have small roles get no props, and the tools say so instead of guessing.
- GitHub Actions on a private repo has 2,000 free minutes a month. This schedule runs about 780 times a month, and each run is billed as 1–2 minutes.
- GitHub disables scheduled workflows after 60 days without repo activity. If that happens, re-enable the workflow from the Actions tab.
