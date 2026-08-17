import { describe, expect, it, vi } from "vitest";
import { TurismeCatBusinessSourceProvider, mapRowToRecord } from "./turisme-cat-provider";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("mapRowToRecord", () => {
  it("mapea una fila del registro oficial", () => {
    const record = mapRowToRecord(
      {
        nom: "Hotel Blanes Mar",
        municipi: "Blanes",
        adreca: "Passeig de Dintre, 10",
        telefon: "972330000",
        web: "hotelblanesmar.cat",
        tipus: "Hotel",
        comarca: "La Selva",
      },
      "Blanes"
    )!;

    expect(record.name).toBe("Hotel Blanes Mar");
    expect(record.source).toBe("turisme_cat");
    expect(record.sector).toBe("Turismo");
    expect(record.city).toBe("Blanes");
    expect(record.website_url).toBe("https://hotelblanesmar.cat");
    expect(record.category).toBe("Hotel");
  });

  it("acepta los nombres alternativos de columna del dataset", () => {
    const record = mapRowToRecord(
      { nom_establiment: "Càmping Sol", tel_fon: "972111111", adre_a: "Ctra. Costa, 1" },
      "Blanes"
    )!;

    expect(record.name).toBe("Càmping Sol");
    expect(record.phone).toBe("972111111");
    expect(record.address).toBe("Ctra. Costa, 1");
  });

  it("descarta filas sin nombre en vez de inventarlo", () => {
    expect(mapRowToRecord({ municipi: "Blanes" }, "Blanes")).toBeNull();
  });

  it("no inventa web cuando la columna viene vacía", () => {
    const record = mapRowToRecord({ nom: "Hostal X", web: "" }, "Blanes")!;
    expect(record.website_url).toBeUndefined();
  });
});

describe("TurismeCatBusinessSourceProvider", () => {
  it("está activo sin clave y sin coste", () => {
    const provider = new TurismeCatBusinessSourceProvider();
    expect(provider.isActive).toBe(true);
    expect(provider.costPerRequestUsd).toBe(0);
  });

  it("filtra por municipio en la consulta", async () => {
    const provider = new TurismeCatBusinessSourceProvider();
    const fetchImpl = vi.fn().mockImplementation(async () => jsonResponse([]));

    await provider.search({ municipality: "Blanes", fetchImpl });

    const url = String(fetchImpl.mock.calls[0][0]);
    expect(url).toContain("analisi.transparenciacatalunya.cat");
    expect(decodeURIComponent(url)).toContain("upper(municipi)='BLANES'");
  });

  it("devuelve los establecimientos del registro", async () => {
    const provider = new TurismeCatBusinessSourceProvider();
    const fetchImpl = vi.fn().mockImplementation(async () =>
      jsonResponse([
        { nom: "Hotel A", municipi: "Blanes" },
        { nom: "Càmping B", municipi: "Blanes" },
      ])
    );

    const result = await provider.search({ municipality: "Blanes", fetchImpl });

    expect(result.records).toHaveLength(2);
    expect(result.records.every((r) => r.source === "turisme_cat")).toBe(true);
  });

  it("reporta un error tipado si el registro no responde", async () => {
    const provider = new TurismeCatBusinessSourceProvider();
    const fetchImpl = vi.fn().mockImplementation(async () => jsonResponse({}, 503));

    await expect(provider.search({ municipality: "Blanes", fetchImpl })).rejects.toMatchObject({
      name: "TurismeCatError",
      status: 503,
    });
  });
});
