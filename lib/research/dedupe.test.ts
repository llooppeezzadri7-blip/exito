import { describe, expect, it } from "vitest";
import {
  dedupeBatch,
  findDuplicate,
  normalizeAddress,
  normalizeName,
  normalizePhone,
  registrableDomain,
} from "./dedupe";

describe("normalizePhone", () => {
  it("colapsa los formatos españoles al mismo número", () => {
    const expected = "972373401";
    expect(normalizePhone("+34 972 37 34 01")).toBe(expected);
    expect(normalizePhone("972373401")).toBe(expected);
    expect(normalizePhone("+34972373401")).toBe(expected);
    expect(normalizePhone("972-37-34-01")).toBe(expected);
    expect(normalizePhone("(972) 373 401")).toBe(expected);
  });

  it("descarta cadenas demasiado cortas para ser un teléfono", () => {
    expect(normalizePhone("123")).toBeNull();
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });
});

describe("registrableDomain", () => {
  it("iguala www, protocolo y ruta", () => {
    expect(registrableDomain("https://www.ejemplo.es/carta")).toBe("ejemplo.es");
    expect(registrableDomain("http://ejemplo.es")).toBe("ejemplo.es");
    expect(registrableDomain("ejemplo.es")).toBe("ejemplo.es");
  });

  it("trata los subdominios como el mismo negocio", () => {
    expect(registrableDomain("https://tienda.ejemplo.es")).toBe("ejemplo.es");
  });

  it("respeta los TLD de dos niveles", () => {
    expect(registrableDomain("https://www.ejemplo.com.es/x")).toBe("ejemplo.com.es");
  });

  it("devuelve null ante basura en vez de adivinar", () => {
    expect(registrableDomain("no es una url")).toBeNull();
    expect(registrableDomain(null)).toBeNull();
  });
});

describe("normalizeName y normalizeAddress", () => {
  it("ignora acentos, mayúsculas y palabras genéricas del sector", () => {
    expect(normalizeName("Restaurante El Gaucho")).toBe(normalizeName("EL GAUCHO"));
    expect(normalizeName("Perruqueria Mireia")).toBe(normalizeName("Peluquería Mireia"));
  });

  it("no vacía un nombre compuesto solo por palabras genéricas", () => {
    expect(normalizeName("Restaurant Bar")).not.toBe("");
  });

  it("normaliza el tipo de vía", () => {
    expect(normalizeAddress("Carrer de la Vila, 39")).toBe(normalizeAddress("C/ de la Vila 39"));
  });
});

describe("findDuplicate", () => {
  const existing = [
    {
      id: "1",
      name: "Restaurante El Gaucho",
      gbp_place_id: "ChIJ_gaucho",
      phone: "+34 972 37 34 01",
      website_url: "https://steakhouselloret.com/",
      address: "Carrer de la Vila, 39",
      city: "Lloret de Mar",
    },
  ];

  it("detecta el mismo negocio por place_id", () => {
    const match = findDuplicate({ name: "Otro nombre", gbp_place_id: "ChIJ_gaucho" }, existing);
    expect(match?.reason).toBe("place_id");
    expect(match?.confidence).toBe("strong");
  });

  it("detecta el mismo negocio por teléfono con otro formato", () => {
    const match = findDuplicate({ name: "El Gaucho Steak House", phone: "972373401" }, existing);
    expect(match?.reason).toBe("phone");
  });

  it("detecta el mismo negocio por dominio aunque la marca sea distinta", () => {
    const match = findDuplicate(
      { name: "Steak House Costa Brava", website_url: "http://www.steakhouselloret.com" },
      existing
    );
    expect(match?.reason).toBe("domain");
    expect(match?.confidence).toBe("strong");
  });

  it("marca como débil una coincidencia de nombre y ciudad", () => {
    const match = findDuplicate({ name: "El Gaucho", city: "Lloret de Mar" }, existing);
    expect(match?.reason).toBe("name_and_city_exact");
    expect(match?.confidence).toBe("weak");
  });

  it("NO confunde dos negocios con el mismo nombre en pueblos distintos", () => {
    const match = findDuplicate({ name: "El Gaucho", city: "Roses" }, existing);
    expect(match).toBeNull();
  });

  it("NO confunde negocios distintos que comparten ciudad", () => {
    const match = findDuplicate({ name: "Can Guidet", city: "Lloret de Mar" }, existing);
    expect(match).toBeNull();
  });

  it("no inventa coincidencias cuando no hay identificadores", () => {
    expect(findDuplicate({ name: "Negocio Nuevo" }, existing)).toBeNull();
  });
});

describe("dedupeBatch", () => {
  it("elimina duplicados dentro de un mismo lote y dice por qué", () => {
    const { unique, duplicates } = dedupeBatch([
      { name: "Taller AUTOPRO", phone: "+34 656 99 00 11", gbp_place_id: "a" },
      { name: "AUTOPRO Lloret", phone: "656990011", gbp_place_id: "b" },
      { name: "Espai d'Automobil", phone: "+34 972 11 57 12", gbp_place_id: "c" },
    ]);

    expect(unique).toHaveLength(2);
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0].reason).toBe("phone");
  });

  it("no descarta nada cuando todos son negocios distintos", () => {
    const { unique, duplicates } = dedupeBatch([
      { name: "A", gbp_place_id: "1" },
      { name: "B", gbp_place_id: "2" },
    ]);

    expect(unique).toHaveLength(2);
    expect(duplicates).toHaveLength(0);
  });
});
