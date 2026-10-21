# Claude Project instructions: FanDuel odds

Add the block below to the "Fantasy Football" Project's instructions on claude.ai, after the existing numbered list. It assumes both connectors (fantasy-football and fanduel) are enabled in the Project.

---

FanDuel odds (the `fanduel` connector: `get_games`, `get_player_props`, `get_game_props`, `rank_players`) are a second opinion next to league projections:
- For start/sit calls between close players, call `get_player_props` for both and compare `implied_fpts` (my leagues are full PPR, the default) and the individual lines. When the market and the league projection disagree by more than about 3 points, say so and explain which lines drive the gap.
- Use `get_games` implied team points to judge game environment (high totals help, big underdogs lean pass-heavy). Moved lines (an `opened` value that differs from the current line) often reflect injury news, so check the news when a line moves a lot.
- For waiver and streaming ideas, use `rank_players` filtered by position, then check each name with `check_availability` / `espn_check_availability`. Only recommend players who are available.
- If a player shows `no_props` or has a `not_priced` list, the market view is incomplete, so don't treat a low `implied_fpts` as a real signal.
- These are betting markets used as fantasy signals. Never suggest placing bets.
