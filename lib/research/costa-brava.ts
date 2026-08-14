/**
 * Systematic discovery configuration for the Costa Brava (brief §1, §24).
 *
 * The point of holding this as data rather than as ad-hoc queries is that a
 * sweep becomes reproducible: the same municipality × subsector grid can be
 * re-run, resumed, and audited, and coverage gaps are visible instead of
 * implicit.
 */

export interface Municipality {
  name: string;
  /** Comarca, useful for grouping reports and for query disambiguation. */
  comarca: string;
  /** Marks towns whose economy is dominated by summer tourism (§36). */
  seasonal: boolean;
}

export const COSTA_BRAVA_MUNICIPALITIES: Municipality[] = [
  { name: "Blanes", comarca: "La Selva", seasonal: true },
  { name: "Lloret de Mar", comarca: "La Selva", seasonal: true },
  { name: "Tossa de Mar", comarca: "La Selva", seasonal: true },
  { name: "Sant Feliu de Guíxols", comarca: "Baix Empordà", seasonal: true },
  { name: "S'Agaró", comarca: "Baix Empordà", seasonal: true },
  { name: "Castell-Platja d'Aro", comarca: "Baix Empordà", seasonal: true },
  { name: "Platja d'Aro", comarca: "Baix Empordà", seasonal: true },
  { name: "Palamós", comarca: "Baix Empordà", seasonal: true },
  { name: "Calella de Palafrugell", comarca: "Baix Empordà", seasonal: true },
  { name: "Llafranc", comarca: "Baix Empordà", seasonal: true },
  { name: "Begur", comarca: "Baix Empordà", seasonal: true },
  { name: "Pals", comarca: "Baix Empordà", seasonal: true },
  { name: "L'Estartit", comarca: "Baix Empordà", seasonal: true },
  { name: "Torroella de Montgrí", comarca: "Baix Empordà", seasonal: false },
  { name: "L'Escala", comarca: "Alt Empordà", seasonal: true },
  { name: "Sant Pere Pescador", comarca: "Alt Empordà", seasonal: true },
  { name: "Roses", comarca: "Alt Empordà", seasonal: true },
  { name: "Empuriabrava", comarca: "Alt Empordà", seasonal: true },
  { name: "Cadaqués", comarca: "Alt Empordà", seasonal: true },
  { name: "Llançà", comarca: "Alt Empordà", seasonal: true },
  { name: "Port de la Selva", comarca: "Alt Empordà", seasonal: true },
  { name: "Figueres", comarca: "Alt Empordà", seasonal: false },
  { name: "Girona", comarca: "Gironès", seasonal: false },
];

export interface Subsector {
  name: string;
  /** Query fragments in Spanish/Catalan, as a local would search (§9). */
  keywords: string[];
}

export interface Sector {
  name: string;
  subsectors: Subsector[];
}

export const COSTA_BRAVA_SECTORS: Sector[] = [
  {
    name: "Turismo",
    subsectors: [
      { name: "Hoteles", keywords: ["hotel", "hotels"] },
      { name: "Apartahoteles", keywords: ["apartahotel", "aparthotel"] },
      { name: "Hostales", keywords: ["hostal", "pensión"] },
      { name: "Campings", keywords: ["camping"] },
      { name: "Apartamentos turísticos", keywords: ["apartamentos turísticos", "apartaments turístics"] },
      { name: "Casas rurales", keywords: ["casa rural", "masía turismo rural"] },
      { name: "Alquiler de villas", keywords: ["alquiler villas", "lloguer vil·les"] },
      { name: "Alquiler de barcos", keywords: ["alquiler de barcos", "lloguer d'embarcacions"] },
      { name: "Buceo", keywords: ["centro de buceo", "diving"] },
      { name: "Kayak y paddle surf", keywords: ["kayak", "paddle surf"] },
      { name: "Excursiones y tours", keywords: ["excursiones", "tours guiados"] },
      { name: "Alquiler de coches", keywords: ["alquiler de coches", "rent a car"] },
      { name: "Transfers", keywords: ["transfer aeropuerto", "traslados"] },
    ],
  },
  {
    name: "Hostelería",
    subsectors: [
      { name: "Restaurantes", keywords: ["restaurante", "restaurant"] },
      { name: "Chiringuitos", keywords: ["chiringuito", "beach bar"] },
      { name: "Bares y cafeterías", keywords: ["bar", "cafetería"] },
      { name: "Coctelerías", keywords: ["coctelería", "cocktail bar"] },
      { name: "Beach clubs", keywords: ["beach club"] },
      { name: "Discotecas", keywords: ["discoteca", "club nocturno"] },
      { name: "Gastrobares", keywords: ["gastrobar", "tapas"] },
    ],
  },
  {
    name: "Servicios locales",
    subsectors: [
      { name: "Gimnasios", keywords: ["gimnasio", "centro fitness"] },
      { name: "Clínicas estéticas", keywords: ["clínica estética", "medicina estética"] },
      { name: "Peluquerías y barberías", keywords: ["peluquería", "barbería", "perruqueria"] },
      { name: "Fisioterapia", keywords: ["fisioterapia", "fisioterapeuta"] },
      { name: "Clínicas dentales", keywords: ["clínica dental", "dentista"] },
      { name: "Centros médicos privados", keywords: ["centro médico privado", "clínica privada"] },
      { name: "Autoescuelas", keywords: ["autoescuela"] },
      { name: "Talleres", keywords: ["taller mecánico", "taller de coches"] },
      { name: "Reformas y construcción", keywords: ["empresa de reformas", "constructora"] },
      { name: "Arquitectos e interioristas", keywords: ["arquitecto", "interiorista"] },
      { name: "Fotógrafos", keywords: ["fotógrafo", "estudio fotográfico"] },
      { name: "Empresas de eventos", keywords: ["organización de eventos", "catering eventos"] },
      { name: "Empresas de limpieza", keywords: ["empresa de limpieza"] },
    ],
  },
  {
    name: "Inmobiliario",
    subsectors: [
      { name: "Inmobiliarias", keywords: ["inmobiliaria", "immobiliària"] },
      { name: "Agencias de villas", keywords: ["agencia villas lujo", "villa rentals"] },
      { name: "Gestión de alquiler vacacional", keywords: ["gestión alquiler vacacional", "property management"] },
      { name: "Administradores de fincas", keywords: ["administrador de fincas"] },
    ],
  },
  {
    name: "Comercio",
    subsectors: [
      { name: "Moda", keywords: ["tienda de ropa", "boutique"] },
      { name: "Joyerías", keywords: ["joyería"] },
      { name: "Deporte", keywords: ["tienda de deportes"] },
      { name: "Decoración", keywords: ["tienda de decoración", "muebles"] },
    ],
  },
];

export interface SweepCell {
  municipality: string;
  comarca: string;
  sector: string;
  subsector: string;
  /** The exact text query that will be sent to the discovery provider. */
  query: string;
  seasonal: boolean;
}

export interface SweepConfig {
  municipalities?: string[];
  sectors?: string[];
  subsectors?: string[];
  /** Extra free-text keywords appended to every generated query. */
  extraKeywords?: string[];
  maxResultsPerCell?: number;
}

/**
 * Expands a sweep configuration into the concrete grid of queries to run.
 * Returned as data (not executed) so a run can be counted and costed before
 * a single paid API call is made — one cell is at least one Places request.
 */
export function buildSweep(config: SweepConfig = {}): SweepCell[] {
  const municipalities = COSTA_BRAVA_MUNICIPALITIES.filter(
    (m) => !config.municipalities || config.municipalities.includes(m.name)
  );
  const sectors = COSTA_BRAVA_SECTORS.filter(
    (s) => !config.sectors || config.sectors.includes(s.name)
  );

  const cells: SweepCell[] = [];

  for (const municipality of municipalities) {
    for (const sector of sectors) {
      for (const subsector of sector.subsectors) {
        if (config.subsectors && !config.subsectors.includes(subsector.name)) continue;

        const keyword = subsector.keywords[0];
        const extras = config.extraKeywords?.length ? ` ${config.extraKeywords.join(" ")}` : "";

        cells.push({
          municipality: municipality.name,
          comarca: municipality.comarca,
          sector: sector.name,
          subsector: subsector.name,
          query: `${keyword} en ${municipality.name}${extras}`,
          seasonal: municipality.seasonal,
        });
      }
    }
  }

  return cells;
}

/** Cost preview for a sweep, so a run is never launched blind (§26/§27). */
export function estimateSweepRequests(cells: SweepCell[], maxResultsPerCell = 20): number {
  const pagesPerCell = Math.max(1, Math.ceil(maxResultsPerCell / 20));
  return cells.length * pagesPerCell;
}
