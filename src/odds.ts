// Odds math: American odds -> probabilities, vig removal, and implied team points.

export const impliedProb = (american: number) => (american < 0 ? -american / (-american + 100) : 100 / (american + 100));

// Two-way market without the bookmaker's margin: the first side's share of the total.
export const noVig = (a: number, b: number) => {
  const pa = impliedProb(a);
  return pa / (pa + impliedProb(b));
};

export const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

// Home team's expected points from the total and the home spread (negative = favored).
export const impliedPoints = (total: number, homeSpread: number) => ({ home: total / 2 - homeSpread / 2, away: total / 2 + homeSpread / 2 });
