import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PROP_TABS } from "../src/fanduel";

// Fixtures are live FanDuel and ESPN responses captured on 2026-10-21 (NFL week 7, Wednesday),
// trimmed by scripts/make-fixtures.ts.
export const fx = (name: string) => JSON.parse(readFileSync(join(__dirname, "fixtures", name), "utf8"));
export const NE_CHI = "36190129";
export const GB_DET = "36189005";
export const tabsFor = (id: string) => PROP_TABS.map((t) => fx(`event_${id}_${t}.json`));
