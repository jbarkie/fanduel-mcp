import { DataCache, type KVLike } from "./cache";
import { handleMcp, type ToolDef } from "./mcp";
import * as tools from "./tools";

export interface Env {
  CACHE: KVLike;
  // Secret path segment; the server only answers at /mcp/<MCP_PATH_TOKEN>.
  MCP_PATH_TOKEN: string;
}

const TEAM = { type: "string", description: 'Team abbreviation or name, e.g. "CHI" or "Bears"' };
const POSITION = { type: "string", enum: ["QB", "RB", "WR", "TE", "DEF"] };
const ro = { readOnlyHint: true, openWorldHint: true };

export function buildTools(deps: tools.Deps): ToolDef[] {
  return [
    {
      name: "get_games",
      description: "FanDuel NFL game lines for this week (or a given week): spread, total, moneyline, implied team points, win probability with the sportsbook margin removed, line movement since first seen, and how many players have props. Good for a quick look at the slate or one team's game.",
      inputSchema: {
        type: "object",
        properties: { team: TEAM, week: { type: "integer", minimum: 1, maximum: 18 } },
        additionalProperties: false,
      },
      annotations: ro,
      handler: (a) => tools.getGames(deps, a.team, a.week),
    },
    {
      name: "get_player_props",
      description: "FanDuel player props for named players this week: over/under lines with odds, the no-vig over probability and line movement, anytime and 2+ TD odds, and QB interception odds. Ambiguous names return candidates; players without props say so.",
      inputSchema: {
        type: "object",
        properties: {
          players: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 20, description: 'Player names; add a team to break ties, e.g. "Mike Williams NYJ"' },
        },
        required: ["players"], additionalProperties: false,
      },
      annotations: ro,
      handler: (a) => tools.getPlayerProps(deps, a.players),
    },
    {
      name: "get_game_props",
      description: "Everything FanDuel prices for one game this week: game lines plus every player's props, listed by anytime TD probability.",
      inputSchema: {
        type: "object",
        properties: { game: { type: "string", description: 'One or both teams, e.g. "CHI" or "Patriots @ Bears", or a FanDuel game id' } },
        required: ["game"], additionalProperties: false,
      },
      annotations: ro,
      handler: (a) => tools.getGameProps(deps, a.game),
    },
    {
      name: "rank_players",
      description: "Rank this week's players across all games by anytime TD probability or by a prop line (yards, receptions, passing TDs). Filter by position or team. Good for browsing the market, e.g. the highest receiving-yard lines or the most likely touchdown scorers.",
      inputSchema: {
        type: "object",
        properties: {
          stat: { type: "string", enum: [...tools.RANK_STATS] },
          position: POSITION,
          team: TEAM,
          limit: { type: "integer", minimum: 1, maximum: 50 },
          include_started: { type: "boolean", description: "Keep games that already kicked off (default false)" },
        },
        required: ["stat"], additionalProperties: false,
      },
      annotations: ro,
      handler: (a) => tools.rankPlayers(deps, a.stat, { position: a.position, team: a.team, limit: a.limit ?? 20, include_started: a.include_started }),
    },
  ];
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!env.MCP_PATH_TOKEN || url.pathname !== `/mcp/${env.MCP_PATH_TOKEN}`) return new Response("Not found", { status: 404 });
    return handleMcp(request, buildTools({ cache: new DataCache(env.CACHE), now: () => new Date() }));
  },
};
