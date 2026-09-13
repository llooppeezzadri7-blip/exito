import { describe, expect, it } from "vitest";
import { parseFootballDataCsv, parseFootballDataDate, parseSeasons, toMatchRow } from "./football-data";

const HEADER =
  "Div,Date,Time,HomeTeam,AwayTeam,FTHG,FTAG,FTR,HS,AS,HST,AST,HF,AF,HC,AC,HY,AY,HR,AR,B365H,B365D,B365A,MaxC>2.5,AvgC>2.5";

const CSV = [
  HEADER,
  "SP1,17/08/25,21:00,Barcelona,Sevilla,3,0,H,18,4,9,1,9,15,11,2,1,4,0,1,1.25,6.50,11.00,1.55,1.48",
  "SP1,18/08/25,19:30,Getafe,Rayo Vallecano,1,1,D,9,11,3,4,19,17,4,6,4,5,0,0,2.40,3.10,3.20,2.05,1.98",
  "E0,23/08/25,15:00,Arsenal,Everton,2,1,H,16,7,6,3,10,12,8,3,2,1,0,0,1.40,5.00,8.00,1.70,1.65",
].join("\n");

describe("date parsing", () => {
  it("reads both two- and four-digit years", () => {
    expect(parseFootballDataDate("17/08/25")).toBe("2025-08-17");
    expect(parseFootballDataDate("17/08/2025")).toBe("2025-08-17");
    expect(parseFootballDataDate(" 01/01/24 ")).toBe("2024-01-01");
  });

  it("returns null for anything else", () => {
    expect(parseFootballDataDate("2025-08-17")).toBeNull();
    expect(parseFootballDataDate("")).toBeNull();
    expect(parseFootballDataDate("garbage")).toBeNull();
  });
});

describe("row normalisation", () => {
  it("maps results, corners and cards into typed pairs", () => {
    const { matches } = parseFootballDataCsv(CSV);
    const [first] = matches;
    expect(first.division).toBe("SP1");
    expect(first.date).toBe("2025-08-17");
    expect(first.homeTeam).toBe("Barcelona");
    expect(first.goals).toEqual({ home: 3, away: 0 });
    expect(first.corners).toEqual({ home: 11, away: 2 });
    expect(first.yellows).toEqual({ home: 1, away: 4 });
    expect(first.reds).toEqual({ home: 0, away: 1 });
    expect(first.shotsOnTarget).toEqual({ home: 9, away: 1 });
  });

  it("sweeps up odds columns and leaves stat columns out of them", () => {
    const { matches } = parseFootballDataCsv(CSV);
    expect(matches[0].odds["B365H"]).toBe(1.25);
    expect(matches[0].odds["MaxC>2.5"]).toBe(1.55);
    expect(matches[0].odds["HC"]).toBeUndefined();
    expect(matches[0].odds["FTHG"]).toBeUndefined();
  });

  it("drops footer and blank rows instead of emitting broken matches", () => {
    const withJunk = [CSV, ",,,,,,,,,,,,,,,,,,,,,,,,", "SP1,,,,,,,,,,,,,,,,,,,,,,,,"].join("\n");
    const { matches, skipped } = parseFootballDataCsv(withJunk);
    expect(matches).toHaveLength(3);
    expect(skipped).toBeGreaterThanOrEqual(1);
  });

  it("keeps a match whose stats are missing but nulls those fields", () => {
    const row = toMatchRow({ Div: "SP1", Date: "17/08/25", HomeTeam: "Barcelona", AwayTeam: "Sevilla" });
    expect(row).not.toBeNull();
    expect(row?.goals).toBeNull();
    expect(row?.corners).toBeNull();
  });

  it("rejects a row with no teams", () => {
    expect(toMatchRow({ Div: "SP1", Date: "17/08/25" })).toBeNull();
  });
});

describe("multi-season loading", () => {
  it("merges files and sorts everything chronologically", () => {
    const older = [HEADER, "SP1,10/05/24,21:00,Valencia,Betis,0,2,A,8,12,2,5,14,11,3,7,3,2,0,0,3.10,3.40,2.30,1.90,1.85"].join("\n");
    const { matches } = parseSeasons([CSV, older]);
    expect(matches).toHaveLength(4);
    expect(matches[0].date).toBe("2024-05-10");
    expect(matches.map((m) => m.date)).toEqual([...matches.map((m) => m.date)].sort());
  });

  it("handles an empty file without throwing", () => {
    expect(parseFootballDataCsv("").matches).toHaveLength(0);
  });
});
