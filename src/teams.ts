// FanDuel full team names -> standard NFL abbreviations.
export const TEAMS: Record<string, string> = {
  "Arizona Cardinals": "ARI", "Atlanta Falcons": "ATL", "Baltimore Ravens": "BAL", "Buffalo Bills": "BUF",
  "Carolina Panthers": "CAR", "Chicago Bears": "CHI", "Cincinnati Bengals": "CIN", "Cleveland Browns": "CLE",
  "Dallas Cowboys": "DAL", "Denver Broncos": "DEN", "Detroit Lions": "DET", "Green Bay Packers": "GB",
  "Houston Texans": "HOU", "Indianapolis Colts": "IND", "Jacksonville Jaguars": "JAX", "Kansas City Chiefs": "KC",
  "Las Vegas Raiders": "LV", "Los Angeles Chargers": "LAC", "Los Angeles Rams": "LAR", "Miami Dolphins": "MIA",
  "Minnesota Vikings": "MIN", "New England Patriots": "NE", "New Orleans Saints": "NO", "New York Giants": "NYG",
  "New York Jets": "NYJ", "Philadelphia Eagles": "PHI", "Pittsburgh Steelers": "PIT", "San Francisco 49ers": "SF",
  "Seattle Seahawks": "SEA", "Tampa Bay Buccaneers": "TB", "Tennessee Titans": "TEN", "Washington Commanders": "WAS",
};

// FanDuel runner logos are named after the team: .../team/nfl/pittsburgh_steelers.png
const BY_SLUG = Object.fromEntries(Object.entries(TEAMS).map(([name, abbr]) => [name.toLowerCase().replace(/ /g, "_"), abbr]));
export function teamFromLogo(url: string | undefined): string | null {
  const slug = url?.match(/\/team\/nfl\/([a-z0-9_]+?)(?:_jersey)?\.png/)?.[1];
  return slug ? BY_SLUG[slug] ?? null : null;
}

export const isDefense = (name: string) => / (?:Defense|D\/ST)$/.test(name);

// "Pittsburgh Defense" -> PIT. FanDuel names defenses by city, or "NY Giants" / "LA Rams" style
// for shared cities.
export function teamFromDefense(name: string): string | null {
  const m = name.match(/^(.*) (?:Defense|D\/ST)$/);
  if (!m) return null;
  const city = m[1].replace(/^NY /, "New York ").replace(/^LA /, "Los Angeles ");
  const hits = Object.entries(TEAMS).filter(([full]) => full.startsWith(city + " ") || full === city);
  return hits.length === 1 ? hits[0][1] : null;
}

// ESPN proTeamId -> abbreviation (ESPN's player list uses numeric team ids).
export const ESPN_TEAMS: Record<number, string> = {
  1: "ATL", 2: "BUF", 3: "CHI", 4: "CIN", 5: "CLE", 6: "DAL", 7: "DEN", 8: "DET", 9: "GB", 10: "TEN",
  11: "IND", 12: "KC", 13: "LV", 14: "LAR", 15: "MIA", 16: "MIN", 17: "NE", 18: "NO", 19: "NYG", 20: "NYJ",
  21: "PHI", 22: "ARI", 23: "PIT", 24: "LAC", 25: "SF", 26: "SEA", 27: "TB", 28: "WAS", 29: "CAR", 30: "JAX",
  33: "BAL", 34: "HOU",
};

// Accepts an abbreviation, full name, city or nickname: "chi", "Bears", "Chicago Bears".
export function resolveTeam(query: string): string | null {
  const q = query.trim().toLowerCase();
  const abbrs = Object.values(TEAMS);
  const exact = abbrs.find((a) => a.toLowerCase() === q) ?? (q === "wsh" ? "WAS" : undefined);
  if (exact) return exact;
  const hits = Object.entries(TEAMS).filter(([full]) => {
    const f = full.toLowerCase();
    return f === q || f.endsWith(" " + q) || f.startsWith(q + " ");
  });
  return hits.length === 1 ? hits[0][1] : null;
}
