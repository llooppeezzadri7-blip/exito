import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GooglePlacesBusinessSourceProvider, mapPlaceToRecord } from "./google-places-provider";

/**
 * The live API is never called here — these pin the contract we implement
 * against (pagination, retries, field mapping) and, above all, that nothing
 * is fabricated when Places omits a field.
 */

const ORIGINAL_KEY = process.env.GOOGLE_PLACES_API_KEY;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function place(overrides: Record<string, unknown> = {}) {
  return {
    id: "ChIJ_test_1",
    displayName: { text: "Restaurant Can Prova" },
    formattedAddress: "Carrer de la Vila, 39, 17310 Lloret de Mar, Girona, España",
    addressComponents: [
      { longText: "Lloret de Mar", types: ["locality"] },
      { longText: "Girona", types: ["administrative_area_level_2"] },
      { longText: "España", types: ["country"] },
      { longText: "17310", types: ["postal_code"] },
    ],
    internationalPhoneNumber: "+34 972 37 34 01",
    websiteUri: "https://canprova.test/",
    rating: 4.4,
    userRatingCount: 1051,
    location: { latitude: 41.7, longitude: 2.84 },
    businessStatus: "OPERATIONAL",
    primaryTypeDisplayName: { text: "Restaurante" },
    ...overrides,
  };
}

describe("mapPlaceToRecord", () => {
  it("copia únicamente los campos que Places devuelve", () => {
    const record = mapPlaceToRecord(place(), "Restaurantes")!;

    expect(record.name).toBe("Restaurant Can Prova");
    expect(record.gbp_place_id).toBe("ChIJ_test_1");
    expect(record.phone).toBe("+34 972 37 34 01");
    expect(record.website_url).toBe("https://canprova.test/");
    expect(record.rating).toBe(4.4);
    expect(record.review_count).toBe(1051);
    expect(record.city).toBe("Lloret de Mar");
    expect(record.postal_code).toBe("17310");
    expect(record.source).toBe("google_places");
    expect(record.sector).toBe("Restaurantes");
  });

  it("no inventa web, teléfono ni valoración cuando Places no los devuelve", () => {
    const record = mapPlaceToRecord(
      place({ websiteUri: undefined, internationalPhoneNumber: undefined, rating: undefined })
    )!;

    expect(record).not.toHaveProperty("website_url");
    expect(record).not.toHaveProperty("phone");
    expect(record).not.toHaveProperty("rating");
    // Ausencia, no cadena vacía: "" pasaría por un valor real aguas abajo.
    expect(record.website_url).toBeUndefined();
  });

  it("descarta negocios cerrados permanentemente", () => {
    expect(mapPlaceToRecord(place({ businessStatus: "CLOSED_PERMANENTLY" }))).toBeNull();
  });

  it("descarta resultados sin nombre en vez de inventar uno", () => {
    expect(mapPlaceToRecord(place({ displayName: undefined }))).toBeNull();
  });
});

describe("GooglePlacesBusinessSourceProvider", () => {
  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.GOOGLE_PLACES_API_KEY;
    else process.env.GOOGLE_PLACES_API_KEY = ORIGINAL_KEY;
    vi.resetModules();
  });

  describe("sin credenciales", () => {
    beforeEach(() => {
      delete process.env.GOOGLE_PLACES_API_KEY;
    });

    it("lanza un error tipado y no devuelve datos simulados", async () => {
      vi.resetModules();
      const { GooglePlacesBusinessSourceProvider: Provider } = await import(
        "./google-places-provider"
      );
      const provider = new Provider();

      expect(provider.isActive).toBe(false);
      // Se comprueba el contrato del error (nombre + mensaje accionable), no
      // la identidad de clase: vi.resetModules() reimporta el módulo y crea
      // una clase distinta, así que instanceof sería frágil aquí.
      await expect(provider.search({ query: "restaurante en Lloret de Mar" })).rejects.toMatchObject({
        name: "ProviderNotConfiguredError",
        message: expect.stringContaining("GOOGLE_PLACES_API_KEY"),
      });
    });
  });

  describe("con credenciales", () => {
    let provider: GooglePlacesBusinessSourceProvider;

    beforeEach(async () => {
      process.env.GOOGLE_PLACES_API_KEY = "clave-de-prueba";
      vi.resetModules();
      const mod = await import("./google-places-provider");
      provider = new mod.GooglePlacesBusinessSourceProvider();
    });

    it("envía la consulta y el field mask correctos", async () => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ places: [place()] }));

      await provider.search({ query: "restaurante en Lloret de Mar", fetchImpl });

      const [url, init] = fetchImpl.mock.calls[0];
      expect(url).toBe("https://places.googleapis.com/v1/places:searchText");
      expect(init.method).toBe("POST");
      expect(init.headers["X-Goog-Api-Key"]).toBe("clave-de-prueba");
      expect(init.headers["X-Goog-FieldMask"]).toContain("places.websiteUri");
      expect(JSON.parse(init.body).textQuery).toBe("restaurante en Lloret de Mar");
      expect(JSON.parse(init.body).pageSize).toBeLessThanOrEqual(20);
    });

    it("sigue la paginación hasta alcanzar el máximo pedido", async () => {
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse({
            places: Array.from({ length: 20 }, (_, i) =>
              place({ id: `p${i}`, displayName: { text: `Negocio ${i}` } })
            ),
            nextPageToken: "token-2",
          })
        )
        .mockResolvedValueOnce(
          jsonResponse({
            places: Array.from({ length: 5 }, (_, i) =>
              place({ id: `q${i}`, displayName: { text: `Otro ${i}` } })
            ),
          })
        );

      const result = await provider.search({ query: "hoteles en Roses", maxResults: 25, fetchImpl });

      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(JSON.parse(fetchImpl.mock.calls[1][1].body).pageToken).toBe("token-2");
      expect(result.records).toHaveLength(25);
    });

    it("no pide más páginas cuando no hay nextPageToken", async () => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ places: [place()] }));

      const result = await provider.search({ query: "x", maxResults: 60, fetchImpl });

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(result.records).toHaveLength(1);
    });

    it("reintenta con backoff exponencial ante un 429", async () => {
      const sleep = vi.fn().mockResolvedValue(undefined);
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ error: "rate limited" }, 429))
        .mockResolvedValueOnce(jsonResponse({ error: "rate limited" }, 429))
        .mockResolvedValueOnce(jsonResponse({ places: [place()] }));

      const result = await provider.search({ query: "x", fetchImpl, sleep });

      expect(fetchImpl).toHaveBeenCalledTimes(3);
      expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000, 2000]);
      expect(result.records).toHaveLength(1);
    });

    it("no reintenta ante un error de credenciales y lo reporta tipado", async () => {
      const sleep = vi.fn();
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: "denied" }, 403));

      await expect(provider.search({ query: "x", fetchImpl, sleep })).rejects.toMatchObject({
        name: "PlacesApiError",
        status: 403,
        retryable: false,
      });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(sleep).not.toHaveBeenCalled();
    });

    it("se rinde tras agotar los reintentos en vez de colgarse", async () => {
      const sleep = vi.fn().mockResolvedValue(undefined);
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 503));

      await expect(provider.search({ query: "x", fetchImpl, sleep })).rejects.toMatchObject({
        name: "PlacesApiError",
        status: 503,
      });
      expect(fetchImpl).toHaveBeenCalledTimes(4); // intento inicial + 3 reintentos
    });

    it("cuenta las peticiones realizadas para poder imputar el coste", async () => {
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ places: [place()], nextPageToken: "t" }))
        .mockResolvedValueOnce(jsonResponse({ places: [place({ id: "b" })] }));

      await provider.search({ query: "x", maxResults: 40, fetchImpl });

      expect(provider.lastRequestCount).toBe(2);
    });

    it("informa de los resultados descartados en vez de ocultarlos", async () => {
      const fetchImpl = vi.fn().mockResolvedValue(
        jsonResponse({
          places: [place(), place({ id: "cerrado", businessStatus: "CLOSED_PERMANENTLY" })],
        })
      );

      const result = await provider.search({ query: "x", fetchImpl });

      expect(result.records).toHaveLength(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain("cerrado");
    });
  });
});
