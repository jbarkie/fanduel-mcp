// Odds math: American odds -> probabilities, vig removal, and market-implied stat
// expectations for fantasy scoring.

export const impliedProb = (american: number) => (american < 0 ? -american / (-american + 100) : 100 / (american + 100));

// Two-way market without the bookmaker's margin: the first side's share of the total.
export const noVig = (a: number, b: number) => {
  const pa = impliedProb(a);
  return pa / (pa + impliedProb(b));
};

export const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

// P(X >= k) for a Poisson(lambda) count.
function poissonAtLeast(k: number, lambda: number) {
  let term = Math.exp(-lambda);
  let below = 0;
  for (let i = 0; i < k; i++) {
    below += term;
    term *= lambda / (i + 1);
  }
  return 1 - below;
}

// Poisson mean that makes P(X >= k) equal p, by bisection. Used for TD and INT counts,
// where a half-point line plus its over price pins down the expected count.
export function poissonMean(k: number, p: number) {
  if (p <= 0) return 0;
  if (k <= 1) return -Math.log(1 - Math.min(p, 0.999));
  let lo = 0, hi = 15;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (poissonAtLeast(k, mid) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// Home team's expected points from the total and the home spread (negative = favored).
export const impliedPoints = (total: number, homeSpread: number) => ({ home: total / 2 - homeSpread / 2, away: total / 2 + homeSpread / 2 });

export const SCORING = {
  ppr: { rec: 1 },
  half: { rec: 0.5 },
  standard: { rec: 0 },
} as const;
export type ScoringPreset = keyof typeof SCORING;
// Shared by every preset: Sleeper's defaults.
export const BASE_SCORING = { pass_yd: 0.04, pass_td: 4, int: -1, rush_yd: 0.1, rec_yd: 0.1, td: 6 };
