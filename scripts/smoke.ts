// End-to-end check through a real MCP client: lists tools and calls each one.
//   npx tsx scripts/smoke.ts https://<worker>/mcp/<token>
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = process.argv[2];
if (!url) throw new Error("usage: smoke.ts <mcp url>");
const client = new Client({ name: "smoke", version: "1.0.0" });
await client.connect(new StreamableHTTPClientTransport(new URL(url)));
const { tools } = await client.listTools();
console.log("tools:", tools.map((t) => t.name).join(", "));

const calls: Array<[string, Record<string, unknown>]> = [
  ["get_games", {}],
  ["get_games", { team: "KC" }],
  ["get_player_props", { players: ["Patrick Mahomes", "Brown", "Nobody Atall"] }],
  ["get_game_props", { game: "DET" }],
  ["rank_players", { stat: "implied_fpts", position: "WR", limit: 5 }],
  ["rank_players", { stat: "anytime_td", limit: 5, scoring: "half" }],
];
for (const [name, args] of calls) {
  const t0 = Date.now();
  const res: any = await client.callTool({ name, arguments: args });
  const text = res.content?.[0]?.text ?? "";
  const body = res.isError ? null : JSON.parse(text);
  console.log(`\n## ${name} ${JSON.stringify(args)}  ${Date.now() - t0} ms, ${(text.length / 1024).toFixed(1)} KB${res.isError ? "  ERROR: " + text : ""}`);
  if (body) console.log(JSON.stringify(body, null, 0).slice(0, 700));
}
await client.close();
