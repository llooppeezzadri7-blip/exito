import { describe, expect, it } from "vitest";
import {
  COSTA_BRAVA_MUNICIPALITIES,
  COSTA_BRAVA_SECTORS,
  buildSweep,
  estimateSweepRequests,
} from "./costa-brava";

describe("configuración de la Costa Brava", () => {
  it("cubre los municipios pedidos en el brief", () => {
    const names = COSTA_BRAVA_MUNICIPALITIES.map((m) => m.name);
    for (const required of [
      "Blanes",
      "Lloret de Mar",
      "Tossa de Mar",
      "Sant Feliu de Guíxols",
      "Palamós",
      "Begur",
      "L'Escala",
      "Roses",
      "Cadaqués",
      "Figueres",
      "Girona",
    ]) {
      expect(names).toContain(required);
    }
  });

  it("no tiene municipios duplicados", () => {
    const names = COSTA_BRAVA_MUNICIPALITIES.map((m) => m.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("cubre sectores más allá de la hostelería", () => {
    const sectors = COSTA_BRAVA_SECTORS.map((s) => s.name);
    expect(sectors).toContain("Turismo");
    expect(sectors).toContain("Inmobiliario");
    expect(sectors).toContain("Servicios locales");
    expect(sectors).toContain("Comercio");
  });
});

describe("buildSweep", () => {
  it("genera una consulta por municipio y subsector", () => {
    const cells = buildSweep({ municipalities: ["Lloret de Mar"], sectors: ["Hostelería"] });
    const hosteleria = COSTA_BRAVA_SECTORS.find((s) => s.name === "Hostelería")!;

    expect(cells).toHaveLength(hosteleria.subsectors.length);
    expect(cells[0].query).toContain("en Lloret de Mar");
    expect(cells[0].municipality).toBe("Lloret de Mar");
  });

  it("permite acotar por subsector concreto", () => {
    const cells = buildSweep({
      municipalities: ["Lloret de Mar"],
      subsectors: ["Restaurantes"],
    });

    expect(cells).toHaveLength(1);
    expect(cells[0].subsector).toBe("Restaurantes");
    expect(cells[0].query).toBe("restaurante en Lloret de Mar");
  });

  it("añade palabras clave extra a la consulta", () => {
    const cells = buildSweep({
      municipalities: ["Begur"],
      subsectors: ["Restaurantes"],
      extraKeywords: ["con terraza"],
    });

    expect(cells[0].query).toBe("restaurante en Begur con terraza");
  });

  it("marca la estacionalidad del municipio en cada celda", () => {
    const lloret = buildSweep({ municipalities: ["Lloret de Mar"], subsectors: ["Restaurantes"] })[0];
    const girona = buildSweep({ municipalities: ["Girona"], subsectors: ["Restaurantes"] })[0];

    expect(lloret.seasonal).toBe(true);
    expect(girona.seasonal).toBe(false);
  });

  it("una configuración vacía barre toda la costa", () => {
    const cells = buildSweep();
    const totalSubsectors = COSTA_BRAVA_SECTORS.reduce((sum, s) => sum + s.subsectors.length, 0);

    expect(cells).toHaveLength(COSTA_BRAVA_MUNICIPALITIES.length * totalSubsectors);
  });
});

describe("estimateSweepRequests", () => {
  it("permite conocer el coste antes de gastar una sola llamada", () => {
    const cells = buildSweep({ municipalities: ["Lloret de Mar"], subsectors: ["Restaurantes"] });

    expect(estimateSweepRequests(cells, 20)).toBe(1);
    expect(estimateSweepRequests(cells, 60)).toBe(3);
  });

  it("escala con el tamaño del barrido", () => {
    const cells = buildSweep({ sectors: ["Hostelería"] });
    expect(estimateSweepRequests(cells, 20)).toBe(cells.length);
  });
});
