import { describe, expect, it } from "vitest";
import { corroborate, explainStatus } from "./corroboration";
import type { RawBusinessRecord } from "@/lib/integrations/business-sources/types";

function osm(overrides: Partial<RawBusinessRecord> = {}): RawBusinessRecord {
  return {
    name: "Restaurant Can Prova",
    source: "openstreetmap",
    city: "Blanes",
    phone: "+34 972 33 44 55",
    ...overrides,
  };
}

function registre(overrides: Partial<RawBusinessRecord> = {}): RawBusinessRecord {
  return {
    name: "Restaurant Can Prova",
    source: "turisme_cat",
    city: "Blanes",
    phone: "972334455",
    ...overrides,
  };
}

describe("regla de corroboración", () => {
  it("una sola fuente nunca pasa de PROBABLE", () => {
    const { businesses, summary } = corroborate([osm()]);

    expect(businesses).toHaveLength(1);
    expect(businesses[0].status).toBe("PROBABLE");
    expect(businesses[0].sources).toEqual(["openstreetmap"]);
    expect(summary.PROBABLE).toBe(1);
    expect(summary.VERIFICADO).toBe(0);
  });

  it("dos fuentes independientes que coinciden dan VERIFICADO", () => {
    const { businesses, summary } = corroborate([osm(), registre()]);

    expect(businesses).toHaveLength(1);
    expect(businesses[0].status).toBe("VERIFICADO");
    expect(businesses[0].sources).toEqual(["openstreetmap", "turisme_cat"]);
    expect(summary.VERIFICADO).toBe(1);
  });

  it("la misma fuente repetida NO cuenta como segunda fuente", () => {
    const { businesses } = corroborate([osm(), osm({ address: "Carrer Ample, 3" })]);

    expect(businesses).toHaveLength(1);
    expect(businesses[0].sources).toEqual(["openstreetmap"]);
    expect(businesses[0].status).toBe("PROBABLE");
  });

  it("fuentes que se contradicen dejan el negocio en NO_VERIFICADO", () => {
    // Mismo negocio por nombre y ciudad, pero con webs de dominios distintos.
    const { businesses } = corroborate([
      osm({ website_url: "https://canprova.example/" }),
      registre({ website_url: "https://otra-marca.example/" }),
    ]);

    expect(businesses).toHaveLength(1);
    expect(businesses[0].status).toBe("NO_VERIFICADO");
    expect(businesses[0].conflicts[0].field).toBe("website_url");
    expect(businesses[0].conflicts[0].values).toHaveLength(2);
  });

  it("rellena huecos sin sobrescribir lo que ya había", () => {
    const { businesses } = corroborate([
      osm({ website_url: "https://canprova.example/" }),
      registre({ email: "hola@canprova.example", address: "Carrer Ample, 3" }),
    ]);

    const record = businesses[0].record;
    expect(record.website_url).toBe("https://canprova.example/");
    expect(record.email).toBe("hola@canprova.example");
    expect(record.address).toBe("Carrer Ample, 3");
  });

  it("no funde dos negocios distintos del mismo municipio", () => {
    const { businesses } = corroborate([
      osm({ name: "Can Prova", phone: "+34 972 11 11 11" }),
      osm({ name: "Can Bosch", phone: "+34 972 22 22 22" }),
    ]);

    expect(businesses).toHaveLength(2);
    expect(businesses.every((b) => b.status === "PROBABLE")).toBe(true);
  });

  it("explica el estado en términos accionables", () => {
    const uno = corroborate([osm()]).businesses[0];
    const dos = corroborate([osm(), registre()]).businesses[0];

    expect(explainStatus(uno)).toContain("Una sola fuente");
    expect(explainStatus(dos)).toContain("2 fuentes");
  });

  it("deja rastro de cómo se armó cada registro", () => {
    const { businesses } = corroborate([osm(), registre()]);

    expect(businesses[0].notes[0]).toContain("Descubierto por openstreetmap");
    expect(businesses[0].notes[1]).toContain("Corroborado por turisme_cat");
  });
});
