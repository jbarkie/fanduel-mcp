import { describe, expect, it } from "vitest";
import { assignPositions, carryOpeningLines, parseGames, parseProps, weekFor, weekWindows } from "../src/fanduel";
import { impliedPoints, impliedProb, noVig } from "../src/odds";
import { buildSlate, gamesFromPages, wantsProps } from "../src/slate";
import { resolveTeam, teamFromDefense, teamFromLogo } from "../src/teams";
import { fx, GB_DET, NE_CHI, tabsFor } from "./helpers";

describe("odds math", () => {
  it("converts American odds and removes the vig", () => {
    expect(impliedProb(-110)).toBeCloseTo(0.5238, 4);
    expect(impliedProb(150)).toBeCloseTo(0.4, 4);
    expect(noVig(-110, -110)).toBeCloseTo(0.5, 6);
    expect(noVig(-156, 132)).toBeCloseTo(0.586, 3);
  });

  it("splits a total by the home spread", () => {
    expect(impliedPoints(50.5, -3)).toEqual({ home: 26.75, away: 23.75 });
  });
});

describe("teams", () => {
  it("maps logos, defenses and free-text team names", () => {
    expect(teamFromLogo("https://assets.sportsbook.fanduel.com/images/team/nfl/pittsburgh_steelers_jersey.png")).toBe("PIT");
    expect(teamFromLogo("https://assets.sportsbook.fanduel.com/images/team/nfl/san_francisco_49ers.png")).toBe("SF");
    expect(teamFromLogo(undefined)).toBeNull();
    expect(teamFromDefense("Chicago Defense")).toBe("CHI");
    expect(teamFromDefense("NY Giants Defense")).toBe("NYG");
    expect(teamFromDefense("LA Rams Defense")).toBe("LAR");
    expect(teamFromDefense("New York Defense")).toBeNull(); // ambiguous
    expect(resolveTeam("chi")).toBe("CHI");
    expect(resolveTeam("Bears")).toBe("CHI");
    expect(resolveTeam("Chicago Bears")).toBe("CHI");
    expect(resolveTeam("wsh")).toBe("WAS");
    expect(resolveTeam("New York")).toBeNull();
  });
});

describe("FanDuel parsing", () => {
  it("parses game lines from the NFL page and skips futures", () => {
    const games = parseGames(fx("nfl_page.json"));
    expect(games.length).toBe(28);
    const g = games.find((x) => x.id === NE_CHI)!;
    expect(g).toMatchObject({ away: "NE", home: "CHI", kickoff: "2026-10-23T00:16:00.000Z", spread: [-3, -105, -115, -3], total: [50.5, -110, -110, 50.5], moneyline: [-156, 132] });
    expect(games.map((x) => x.kickoff)).toEqual([...games.map((x) => x.kickoff)].sort());
  });

  it("assigns ESPN weeks", () => {
    const windows = weekWindows(fx("espn_scoreboard.json"));
    expect(windows.length).toBe(18);
    expect(weekFor("2026-10-23T00:16:00.000Z", windows)).toBe(7);
    expect(weekFor("2026-11-03T01:16:00.000Z", windows)).toBe(8);
    expect(weekFor("2030-01-01T00:00:00.000Z", windows)).toBeNull();
  });

  it("merges props across tabs", () => {
    const players = parseProps(NE_CHI, tabsFor(NE_CHI));
    const maye = players.find((p) => p.name === "Drake Maye")!;
    expect(maye).toMatchObject({ team: "NE", game: NE_CHI, interception: [-128, -102] });
    expect(maye.lines.pass_yds).toEqual([246.5, -114, -114, 246.5]);
    expect(maye.lines.pass_tds?.[0]).toBe(1.5);
    expect(maye.anytime_td).toBeTypeOf("number");
    const def = players.find((p) => p.name === "Chicago Defense")!;
    expect(def).toMatchObject({ team: "CHI", pos: "DEF", lines: {} });
    expect(new Set(players.map((p) => p.norm)).size).toBe(players.length);
  });

  it("drops suspended markets", () => {
    const tabs = tabsFor(NE_CHI);
    for (const m of Object.values(tabs[0].attachments.markets) as any[]) {
      if (m.marketType === "PLAYER_A_INTERCEPTION") m.marketStatus = "SUSPENDED";
    }
    expect(parseProps(NE_CHI, tabs).find((p) => p.name === "Drake Maye")!.interception).toBeNull();
  });

  it("assigns positions from ESPN and fills a missing team", () => {
    const games = gamesFromPages(fx("nfl_page.json"), fx("espn_scoreboard.json"));
    const players = parseProps(GB_DET, tabsFor(GB_DET));
    const gibbs = players.find((p) => p.name === "Jahmyr Gibbs")!;
    gibbs.team = null;
    assignPositions(players, fx("espn_players.json"), games);
    expect(gibbs).toMatchObject({ pos: "RB", team: "DET" });
    expect(players.find((p) => p.name === "Jared Goff")!.pos).toBe("QB");
    // Without ESPN, passers are still QBs.
    const bare = parseProps(GB_DET, tabsFor(GB_DET));
    assignPositions(bare, [], games);
    expect(bare.find((p) => p.name === "Jordan Love")!.pos).toBe("QB");
    expect(bare.find((p) => p.name === "Jahmyr Gibbs")!.pos).toBeNull();
  });

  it("carries opening lines from the previous slate", () => {
    const games = parseGames(fx("nfl_page.json")).map((g) => ({ ...g, week: 7, props_fetched: true }));
    const players = parseProps(NE_CHI, tabsFor(NE_CHI));
    const prevGames = structuredClone(games);
    const prevPlayers = structuredClone(players);
    prevGames.find((g) => g.id === NE_CHI)!.total![3] = 48.5;
    prevPlayers.find((p) => p.name === "Drake Maye")!.lines.pass_yds![3] = 230.5;
    carryOpeningLines(games, players, { games: prevGames, players: prevPlayers });
    expect(games.find((g) => g.id === NE_CHI)!.total).toEqual([50.5, -110, -110, 48.5]);
    expect(players.find((p) => p.name === "Drake Maye")!.lines.pass_yds![3]).toBe(230.5);
  });
});

describe("slate assembly", () => {
  const now = new Date("2026-10-21T23:30:00Z");

  it("only wants props for upcoming games within the horizon", () => {
    expect(wantsProps({ kickoff: "2026-10-23T00:16:00.000Z" }, now)).toBe(true);
    expect(wantsProps({ kickoff: "2026-10-21T20:00:00.000Z" }, now)).toBe(false);
    expect(wantsProps({ kickoff: "2026-11-03T01:16:00.000Z" }, now)).toBe(false);
  });

  it("keeps a started game's pre-game lines and props from the previous slate", () => {
    const scoreboard = fx("espn_scoreboard.json");
    const tabs = new Map([[NE_CHI, tabsFor(NE_CHI)], [GB_DET, tabsFor(GB_DET)]]);
    const first = buildSlate({ scoreboard, games: gamesFromPages(fx("nfl_page.json"), scoreboard), tabs, espnPlayers: fx("espn_players.json"), prev: null, now });
    expect(first.slate).toMatchObject({ season: 2026, week: 7 });
    expect(first.slate.games.filter((g) => g.props_fetched).map((g) => g.id).sort()).toEqual([GB_DET, NE_CHI].sort());

    // An hour into NE @ CHI, FanDuel shows live odds; the job stops fetching its props.
    const later = new Date("2026-10-23T01:16:00Z");
    const live = gamesFromPages(fx("nfl_page.json"), scoreboard);
    live.find((g) => g.id === NE_CHI)!.total = [41.5, -110, -110, 41.5];
    const second = buildSlate({ scoreboard, games: live, tabs: new Map([[GB_DET, tabsFor(GB_DET)]]), espnPlayers: null, prev: first.slate, now: later });
    const g = second.slate.games.find((x) => x.id === NE_CHI)!;
    expect(g.total![0]).toBe(50.5);
    expect(g.props_fetched).toBe(true);
    expect(second.slate.players.some((p) => p.name === "Drake Maye")).toBe(true);
    expect(second.warnings.join(" ")).toMatch(/ESPN player list failed/);
  });
});
