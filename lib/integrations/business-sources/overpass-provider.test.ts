import { describe, expect, it, vi } from "vitest";
import {
  OverpassBusinessSourceProvider,
  buildOverpassQuery,
  mapElementToRecord,
  OSM_CATEGORIES,
} from "./overpass-provider";

const RESTAURANTS = OSM_CATEGORIES["Restaurantes"];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function element(tags: Record<string, string>, id = 1) {
  return { type: "node" as const, id, lat: 41.67, lon: 2.79, tags };
}

describe("buildOverpassQuery", () => {
  it("acota la búsqueda al término municipal, no a un rectángulo", () => {
    const query = buildOverpassQuery("Blanes", RESTAURANTS, 20);

    expect(query).toContain('area["name"="Blanes"]["boundary"="administrative"]');
    expect(query).toContain('node["amenity"="restaurant"](area.searchArea);');
    expect(query).toContain("out center tags 20;");
  });

  it("escapa las comillas del nombre del municipio", () => {
    expect(buildOverpassQuery('L"Escala', RESTAURANTS, 5)).toContain('L\\"Escala');
  });
});

describe("mapElementToRecord", () => {
  it("copia solo las etiquetas presentes", () => {
    const record = mapElementToRecord(
      element({
        name: "Can Prova",
        phone: "+34 972 33 44 55",
        website: "https://canprova.example",
        "addr:street": "Carrer Ample",
        "addr:housenumber": "3",
      }),
      RESTAURANTS
    )!;

    expect(record.name).toBe("Can Prova");
    expect(record.phone).toBe("+34 972 33 44 55");
    expect(record.website_url).toBe("https://canprova.example");
    expect(record.address).toBe("Carrer Ample, 3");
    expect(record.source).toBe("openstreetmap");
    expect(record.sector).toBe("Hostelería");
  });

  it("nunca inventa valoración ni reseñas: OSM no las tiene", () => {
    const record = mapElementToRecord(element({ name: "Can Prova" }), RESTAURANTS)!;

    expect(record.rating).toBeUndefined();
    expect(record.review_count).toBeUndefined();
  });

  it("acepta las variantes contact:* de las etiquetas", () => {
    const record = mapElementToRecord(
      element({ name: "X", "contact:phone": "972000000", "contact:website": "ejemplo.cat" }),
      RESTAURANTS
    )!;

    expect(record.phone).toBe("972000000");
    // Un host suelto se normaliza a URL absoluta para que sea navegable.
    expect(record.website_url).toBe("https://ejemplo.cat");
  });

  it("descarta elementos sin nombre en vez de inventarlo", () => {
    expect(mapElementToRecord(element({ amenity: "restaurant" }), RESTAURANTS)).toBeNull();
  });
});

describe("OverpassBusinessSourceProvider", () => {
  it("está siempre activo: no necesita clave", () => {
    const provider = new OverpassBusinessSourceProvider();
    expect(provider.isActive).toBe(true);
    expect(provider.costPerRequestUsd).toBe(0);
  });

  it("devuelve registros reales a partir de la respuesta de Overpass", async () => {
    const provider = new OverpassBusinessSourceProvider();
    const fetchImpl = vi.fn().mockImplementation(async () =>
      jsonResponse({
        elements: [
          element({ name: "Can Prova", phone: "972334455" }, 1),
          element({ name: "Bar Nou" }, 2),
        ],
      })
    );

    const result = await provider.search({
      municipality: "Blanes",
      category: "Restaurantes",
      fetchImpl,
    });

    expect(result.records).toHaveLength(2);
    expect(result.records[0].city).toBe("Blanes");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("no consulta categorías sin equivalencia en OSM en vez de adivinar la etiqueta", async () => {
    const provider = new OverpassBusinessSourceProvider();
    const fetchImpl = vi.fn();

    const result = await provider.search({
      municipality: "Blanes",
      category: "Astrofísica aplicada",
      fetchImpl,
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.records).toHaveLength(0);
    expect(result.errors[0].message).toContain("sin equivalencia");
  });

  it("respeta el máximo de resultados pedido", async () => {
    const provider = new OverpassBusinessSourceProvider();
    const fetchImpl = vi.fn().mockImplementation(async () =>
      jsonResponse({
        elements: Array.from({ length: 30 }, (_, i) => element({ name: `Negocio ${i}` }, i)),
      })
    );

    const result = await provider.search({
      municipality: "Blanes",
      category: "Restaurantes",
      maxResults: 10,
      fetchImpl,
    });

    expect(result.records).toHaveLength(10);
  });

  it("reintenta cuando Overpass está saturado y acaba respondiendo", async () => {
    const provider = new OverpassBusinessSourceProvider();
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fetchImpl = vi
      .fn()
      .mockImplementationOnce(async () => jsonResponse({}, 429))
      .mockImplementationOnce(async () => jsonResponse({ elements: [element({ name: "X" })] }));

    const result = await provider.search({
      municipality: "Blanes",
      category: "Restaurantes",
      fetchImpl,
      sleep,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(result.records).toHaveLength(1);
  });

  it("se rinde con un error tipado tras agotar los reintentos", async () => {
    const provider = new OverpassBusinessSourceProvider();
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fetchImpl = vi.fn().mockImplementation(async () => jsonResponse({}, 504));

    await expect(
      provider.search({ municipality: "Blanes", category: "Restaurantes", fetchImpl, sleep })
    ).rejects.toMatchObject({ name: "OverpassError", status: 504 });

    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});
