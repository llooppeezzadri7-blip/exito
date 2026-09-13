import { afterEach, describe, expect, it, vi } from "vitest";
import { DemoOddsProvider } from "./demo";
import { TheOddsApiProvider } from "./the-odds-api";
import { resolveOddsProvider } from "./index";
import { LA_LIGA } from "./types";

const API_RESPONSE = [
  {
    id: "evt1",
    sport_title: "La Liga - Spain",
    commence_time: "2026-09-13T14:15:00Z",
    home_team: "Levante",
    away_team: "Barcelona",
    bookmakers: [
      {
        key: "sportium",
        title: "Sportium",
        last_update: "2026-09-13T10:02:00Z",
        markets: [
          { key: "h2h", outcomes: [{ name: "Levante", price: 11 }, { name: "Barcelona", price: 1.22 }] },
          {
            key: "totals",
            outcomes: [
              { name: "Over", price: 1.55, point: 2.5 },
              { name: "Under", price: 2.45, point: 2.5 },
            ],
          },
        ],
      },
    ],
  },
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("demo provider", () => {
  it("tags every quote as demo with a DEMO bookmaker", async () => {
    const snapshot = await new DemoOddsProvider().fetchOdds({ sport: LA_LIGA });

    expect(snapshot.provenance).toBe("demo");
    expect(snapshot.quotes.length).toBeGreaterThan(0);
    for (const quote of snapshot.quotes) {
      expect(quote.provenance).toBe("demo");
      expect(quote.bookmaker).toBe("DEMO");
    }
  });

  it("uses fictional teams so a demo row cannot be mistaken for a real fixture", async () => {
    const { quotes } = await new DemoOddsProvider().fetchOdds({ sport: LA_LIGA });
    const teams = new Set(quotes.flatMap((q) => [q.homeTeam, q.awayTeam]));

    for (const real of ["Barcelona", "Levante", "Real Madrid", "Sevilla"]) {
      expect(teams.has(real)).toBe(false);
    }
    expect(teams.has("Demo FC")).toBe(true);
  });

  it("always produces upcoming fixtures", async () => {
    const { quotes } = await new DemoOddsProvider().fetchOdds({ sport: LA_LIGA });
    for (const quote of quotes) {
      expect(new Date(quote.commenceTime).getTime()).toBeGreaterThan(Date.now());
    }
  });
});

describe("the odds api provider", () => {
  it("is unconfigured without a key and explains what to do", async () => {
    const provider = new TheOddsApiProvider(undefined);
    expect(provider.isConfigured()).toBe(false);
    expect(provider.configurationHint()).toMatch(/ODDS_API_KEY/);

    const snapshot = await provider.fetchOdds({ sport: LA_LIGA });
    expect(snapshot.quotes).toHaveLength(0);
    expect(snapshot.error).toMatch(/ODDS_API_KEY/);
  });

  it("flattens the nested response into one row per price", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(API_RESPONSE), { status: 200 })));

    const { quotes, provenance } = await new TheOddsApiProvider("key").fetchOdds({ sport: LA_LIGA });

    expect(provenance).toBe("real");
    expect(quotes).toHaveLength(4);
    for (const quote of quotes) {
      expect(quote.provenance).toBe("real");
      expect(quote.bookmaker).toBe("Sportium");
      expect(quote.homeTeam).toBe("Levante");
    }
  });

  it("labels totals as Spanish over/under lines", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(API_RESPONSE), { status: 200 })));

    const { quotes } = await new TheOddsApiProvider("key").fetchOdds({ sport: LA_LIGA });
    const selections = quotes.map((q) => q.selection);

    expect(selections).toContain("Más de 2.5");
    expect(selections).toContain("Menos de 2.5");
    expect(selections).toContain("Barcelona");
  });

  it("prefers the market's own timestamp over the request time", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(API_RESPONSE), { status: 200 })));

    const { quotes } = await new TheOddsApiProvider("key").fetchOdds({ sport: LA_LIGA });
    expect(quotes[0].fetchedAt).toBe("2026-09-13T10:02:00Z");
  });

  it("discards prices of 1.00 or below rather than emitting a broken quote", async () => {
    const broken = [
      { ...API_RESPONSE[0], bookmakers: [{ key: "x", title: "X", markets: [{ key: "h2h", outcomes: [{ name: "A", price: 1 }, { name: "B", price: 2 }] }] }] },
    ];
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(broken), { status: 200 })));

    const { quotes } = await new TheOddsApiProvider("key").fetchOdds({ sport: LA_LIGA });
    expect(quotes).toHaveLength(1);
    expect(quotes[0].odds).toBe(2);
  });

  it("explains an auth failure and a spent quota in plain Spanish", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 401 })));
    expect((await new TheOddsApiProvider("bad").fetchOdds({ sport: LA_LIGA })).error).toMatch(/no es válida/);

    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 429 })));
    expect((await new TheOddsApiProvider("key").fetchOdds({ sport: LA_LIGA })).error).toMatch(/cuota mensual/);
  });

  it("reports a network failure instead of throwing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));

    const snapshot = await new TheOddsApiProvider("key").fetchOdds({ sport: LA_LIGA });
    expect(snapshot.quotes).toHaveLength(0);
    expect(snapshot.error).toMatch(/ECONNREFUSED/);
  });
});

describe("provider resolution", () => {
  it("falls back to demo without a key and says what is missing", () => {
    const { provider, usingRealData, notice } = resolveOddsProvider(undefined);
    expect(provider.provenance).toBe("demo");
    expect(usingRealData).toBe(false);
    expect(notice).toMatch(/ODDS_API_KEY/);
  });

  it("uses the real provider once a key exists", () => {
    const { provider, usingRealData } = resolveOddsProvider("key");
    expect(provider.provenance).toBe("real");
    expect(usingRealData).toBe(true);
  });

  it("never silently substitutes demo data for real", () => {
    expect(resolveOddsProvider(undefined).provider.provenance).not.toBe("real");
  });
});
