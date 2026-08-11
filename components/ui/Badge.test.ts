import { describe, expect, it } from "vitest";
import { scoreBucket } from "./Badge";

describe("scoreBucket", () => {
  it("buckets scores per ARCHITECTURE.md §5", () => {
    expect(scoreBucket(0).label).toBe("Baja");
    expect(scoreBucket(30).label).toBe("Baja");
    expect(scoreBucket(31).label).toBe("Moderada");
    expect(scoreBucket(50).label).toBe("Moderada");
    expect(scoreBucket(51).label).toBe("Alta");
    expect(scoreBucket(70).label).toBe("Alta");
    expect(scoreBucket(71).label).toBe("Muy alta");
    expect(scoreBucket(85).label).toBe("Muy alta");
    expect(scoreBucket(86).label).toBe("Prioridad máxima");
    expect(scoreBucket(100).label).toBe("Prioridad máxima");
  });
});
