import { describe, expect, it } from "vitest";
import { CsvBusinessSourceProvider } from "./csv-provider";

describe("CsvBusinessSourceProvider", () => {
  const provider = new CsvBusinessSourceProvider();

  it("parses a well-formed CSV with Spanish headers", () => {
    const csv = [
      "nombre,ciudad,sector,telefono,web,rating",
      "Restaurante La Marina,Lloret de Mar,Restaurantes,+34972000111,http://example.com,4.2",
    ].join("\n");

    const { records, errors } = provider.importFromText(csv);

    expect(errors).toHaveLength(0);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      name: "Restaurante La Marina",
      city: "Lloret de Mar",
      sector: "Restaurantes",
      rating: 4.2,
      source: "csv_import",
    });
  });

  it("accepts English header aliases too", () => {
    const csv = ["name,city,phone", "Test Biz,Girona,123456789"].join("\n");
    const { records } = provider.importFromText(csv);
    expect(records[0].name).toBe("Test Biz");
    expect(records[0].city).toBe("Girona");
  });

  it("rejects rows missing the required name field without failing the whole import", () => {
    const csv = ["nombre,ciudad", ",Girona", "Negocio Válido,Girona"].join("\n");
    const { records, errors } = provider.importFromText(csv);

    expect(records).toHaveLength(1);
    expect(records[0].name).toBe("Negocio Válido");
    expect(errors).toHaveLength(1);
    expect(errors[0].row).toBe(2);
  });

  it("rejects an invalid website URL for a row but keeps other rows", () => {
    const csv = ["nombre,web", "Negocio A,not-a-url", "Negocio B,http://valid.example"].join("\n");
    const { records, errors } = provider.importFromText(csv);

    expect(records).toHaveLength(1);
    expect(records[0].name).toBe("Negocio B");
    expect(errors).toHaveLength(1);
  });
});
