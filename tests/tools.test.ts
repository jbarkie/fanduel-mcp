import { beforeEach, describe, expect, it } from "vitest";
import { clearMemo, DataCache, KEYS, type KVLike } from "../src/cache";
import { buildSlate, gamesFromPages } from "../src/slate";
import * as tools from "../src/tools";
import type { Cached, Slate } from "../src/types";
import { fx, GB_DET, NE_CHI, tabsFor } from "./helpers";

const FETCHED = "2026-10-21T23:30:00.000Z";

function slate(): Cached<Slate> {
  const scoreboard = fx("espn_scoreboard.json");
  const built = buildSlate({
    scoreboard,
    games: gamesFromPages(fx("nfl_page.json"), scoreboard),
    tabs: new Map([[NE_CHI, tabsFor(NE_CHI)], [GB_DET, tabsFor(GB_DET)]]),
    espnPlayers: fx("espn_players.json"),
    prev: null,
    now: new Date(FETCHED),
  });
  return { data: built.slate, fetched_at: FETCHED, source: "test", warnings: built.warnings };
}

class MemoryKV implements KVLike {
  constructor(public store: Map<string, string>) {}
  async get(key: string) { return this.store.get(key) ?? null; }
}

function deps(now = "2026-10-22T12:00:00Z", data: Cached<Slate> | null = slate()): tools.Deps {
  const store = new Map(data ? [[KEYS.slate, JSON.stringify(data)]] : []);
  return { cache: new DataCache(new MemoryKV(store)), now: () => new Date(now) };
}

beforeEach(() => clearMemo());

describe("get_games", () => {
  it("lists this week's games with implied points", async () => {
    const r: any = await tools.getGames(deps());
    expect(r.week).toBe(7);
    expect(r.games.length).toBe(14);
    const g = r.games.find((x: any) => x.game_id === NE_CHI);
    expect(g).toMatchObject({ game: "NE @ CHI", spread: { line: "CHI -3", home_spread: -3 }, total: { points: 50.5 }, implied_points: { NE: 23.75, CHI: 26.75 }, started: false });
    expect(g.win_prob.CHI).toBeCloseTo(0.586, 3);
    expect(r.data_gaps.join(" ")).toMatch(/No player props cached for: .*PIT @ NO/);
  });

  it("filters by team and week", async () => {
    const r: any = await tools.getGames(deps(), "Bears");
    expect(r.games.map((g: any) => g.game)).toEqual(["NE @ CHI"]);
    const next: any = await tools.getGames(deps(), "CHI", 8);
    expect(next.games.map((g: any) => g.game)).toEqual(["CHI @ SEA"]);
    await expect(tools.getGames(deps(), undefined, 12)).rejects.toThrow(/no games for week 12.*Weeks listed: 7, 8/);
    await expect(tools.getGames(deps(), "Nowhere")).rejects.toThrow(/Unknown team/);
  });

  it("flags a stale cache and a missing one", async () => {
    const r: any = await tools.getGames(deps("2026-10-22T06:00:00Z"));
    expect(r.data_gaps.join(" ")).toMatch(/stale/);
    clearMemo();
    await expect(tools.getGames(deps(undefined, null))).rejects.toThrow(/Refresh cache/);
  });

  it("shows line movement", async () => {
    const s = slate();
    s.data.games.find((g) => g.id === NE_CHI)!.spread![3] = -1.5;
    const r: any = await tools.getGames(deps(undefined, s), "CHI");
    expect(r.games[0].spread).toEqual({ line: "CHI -3", home_spread: -3, home_spread_opened: -1.5 });
  });
});

describe("get_player_props", () => {
  it("returns lines, TD odds and implied fantasy points", async () => {
    const r: any = await tools.getPlayerProps(deps(), ["Drake Maye", "jahmyr gibbs"], "ppr");
    const [maye, gibbs] = r.players;
    expect(maye).toMatchObject({ name: "Drake Maye", team: "NE", pos: "QB", opponent: "CHI", game: "NE @ CHI" });
    expect(maye.props.pass_yds).toEqual({ line: 246.5, over: -114, under: -114, over_prob: 0.5 });
    expect(maye.interception.prob).toBeGreaterThan(0.5);
    expect(maye.expected.ints).toBeGreaterThan(0.7);
    expect(maye.not_priced).toBeUndefined();
    // Gibbs has rush (93.5) and rush+rec (137.5) lines and a receiving line; the combo is not double counted.
    expect(gibbs.expected.rush_yds).toBe(93.5);
    expect(gibbs.expected.rush_rec_yds).toBeUndefined();
    expect(gibbs.implied_fpts).toBeGreaterThan(20);
    expect(r.method).toMatch(/Poisson/);
  });

  it("scores receptions by preset", async () => {
    const ppr: any = await tools.getPlayerProps(deps(), ["Amon-Ra St. Brown"], "ppr");
    const std: any = await tools.getPlayerProps(deps(), ["Amon-Ra St. Brown"], "standard");
    const p = ppr.players[0];
    expect(p.implied_fpts - std.players[0].implied_fpts).toBeCloseTo(p.expected.receptions, 0);
  });

  it("handles partial, ambiguous, team-qualified and unknown names", async () => {
    const r: any = await tools.getPlayerProps(deps(), ["St. Brown", "Brown", "Williams CHI", "Nobody Atall"], "ppr");
    expect(r.players[0].name).toBe("Amon-Ra St. Brown");
    expect(r.players[1].status).toBe("ambiguous");
    expect(r.players[1].candidates.map((c: any) => c.name)).toContain("A.J. Brown");
    expect(r.players[2].name).toBe("Caleb Williams");
    expect(r.players[3].status).toBe("no_props");
  });

  it("prefers this week's game when a player has props in next week's too", async () => {
    const s = slate();
    const maye = s.data.players.find((p) => p.name === "Drake Maye")!;
    const nextWeek = s.data.games.find((g) => g.week === 8 && (g.home === "NE" || g.away === "NE"))!;
    s.data.players.push({ ...structuredClone(maye), game: nextWeek.id });
    const r: any = await tools.getPlayerProps(deps(undefined, s), ["Drake Maye"], "ppr");
    expect(r.players[0]).toMatchObject({ name: "Drake Maye", game: "NE @ CHI", week: 7, started: false });
  });

  it("falls back to the combined yards line when only it is priced", async () => {
    const s = slate();
    const gibbs = s.data.players.find((p) => p.name === "Jahmyr Gibbs")!;
    delete gibbs.lines.rush_yds;
    delete gibbs.lines.rec_yds;
    const r: any = await tools.getPlayerProps(deps(undefined, s), ["Jahmyr Gibbs"], "ppr");
    expect(r.players[0].expected.rush_rec_yds).toBe(137.5);
  });
});

describe("get_game_props", () => {
  it("finds a game by teams and ranks its players", async () => {
    const r: any = await tools.getGameProps(deps(), "Patriots @ Bears", "half");
    expect(r.game).toBe("NE @ CHI");
    expect(r.players.length).toBeGreaterThan(20);
    const pts = r.players.map((p: any) => p.implied_fpts).filter((x: any) => x !== null);
    expect(pts).toEqual([...pts].sort((a, b) => b - a));
    expect((await tools.getGameProps(deps(), "lions", "ppr") as any).game).toBe("GB @ DET");
    expect((await tools.getGameProps(deps(), "GB at DET", "ppr") as any).game).toBe("GB @ DET");
    await expect(tools.getGameProps(deps(), "BUF", "ppr")).rejects.toThrow(/No game this week for BUF/);
  });
});

describe("rank_players", () => {
  it("ranks by implied points, TD odds and lines with filters", async () => {
    const r: any = await tools.rankPlayers(deps(), "implied_fpts", "ppr", { limit: 5 });
    expect(r.players.map((p: any) => p.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(r.players[0].value).toBeGreaterThanOrEqual(r.players[4].value);
    const te: any = await tools.rankPlayers(deps(), "anytime_td", "ppr", { position: "TE", limit: 50 });
    expect(te.players.every((p: any) => p.pos === "TE")).toBe(true);
    const det: any = await tools.rankPlayers(deps(), "rush_yds", "ppr", { team: "DET", limit: 1 });
    expect(det.players[0]).toMatchObject({ name: "Jahmyr Gibbs", value: 93.5 });
  });

  it("leaves out started games unless asked", async () => {
    const during = "2026-10-23T01:00:00Z"; // NE @ CHI in progress
    const r: any = await tools.rankPlayers(deps(during), "implied_fpts", "ppr", { limit: 50 });
    expect(r.players.some((p: any) => p.game === "NE @ CHI")).toBe(false);
    expect(r.data_gaps.join(" ")).toMatch(/already started/);
    const all: any = await tools.rankPlayers(deps(during), "implied_fpts", "ppr", { limit: 50, include_started: true });
    expect(all.players.some((p: any) => p.game === "NE @ CHI")).toBe(true);
  });
});
