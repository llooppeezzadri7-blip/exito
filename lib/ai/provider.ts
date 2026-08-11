import Anthropic from "@anthropic-ai/sdk";
import { env, hasAnthropic } from "@/lib/config/env";
import { ProviderNotConfiguredError } from "@/lib/integrations/business-sources/types";
import type { Business, Score, Settings, WebsiteScan } from "@/lib/database/types";

export interface AuditReport {
  summary: string;
  problems: string[];
  opportunities: string[];
  commercial_impact: string;
  recommendations: string[];
  priorities: string[];
}

export interface ProposalContent {
  title: string;
  services: string[];
  timeline: string;
  maintenance_terms: string;
  next_steps: string;
  content: string;
}

export interface OutreachMessage {
  subject: string;
  body: string;
}

export interface DemoCopy {
  headline: string;
  subheadline: string;
  about: string;
  cta_text: string;
}

const NO_HALLUCINATION_RULE = `REGLAS ESTRICTAS (no negociables):
- NUNCA inventes cifras de tráfico web, ingresos, número de clientes/ventas perdidas, posiciones en Google, tasas de conversión reales, ni ninguna métrica que no esté explícitamente en los datos proporcionados.
- Basa cada afirmación únicamente en los datos técnicos/de negocio proporcionados.
- Cuando falte un dato cuantitativo, usa lenguaje cualificado ("podría estar limitando", "existe una oportunidad de", "conviene analizar", "es probable que") en vez de una cifra concreta no verificada.
- Nunca prometas resultados garantizados (posiciones nº1, X% más ventas, etc).
- Idioma: español. Tono: profesional, directo, orientado a argumentario comercial — nunca genérico ni de relleno.`;

const AUDIT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    summary: { type: "string", description: "Resumen ejecutivo, 2-4 frases" },
    problems: { type: "array", items: { type: "string" }, description: "Problemas detectados, uno por línea, concretos" },
    opportunities: { type: "array", items: { type: "string" } },
    commercial_impact: { type: "string", description: "Impacto comercial estimado, en lenguaje cualitativo si no hay cifras reales" },
    recommendations: { type: "array", items: { type: "string" } },
    priorities: { type: "array", items: { type: "string" }, description: "Ordenadas de mayor a menor prioridad" },
  },
  required: ["summary", "problems", "opportunities", "commercial_impact", "recommendations", "priorities"],
  additionalProperties: false,
};

const PROPOSAL_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    title: { type: "string" },
    services: { type: "array", items: { type: "string" } },
    timeline: { type: "string" },
    maintenance_terms: { type: "string" },
    next_steps: { type: "string" },
    content: { type: "string", description: "Cuerpo completo de la propuesta en markdown" },
  },
  required: ["title", "services", "timeline", "maintenance_terms", "next_steps", "content"],
  additionalProperties: false,
};

const OUTREACH_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    subject: { type: "string" },
    body: { type: "string" },
  },
  required: ["subject", "body"],
  additionalProperties: false,
};

const DEMO_COPY_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    headline: { type: "string", description: "Titular corto para el hero de la web, basado en el nombre/categoría reales" },
    subheadline: { type: "string" },
    about: { type: "string", description: "Párrafo breve de 'sobre nosotros', basado SOLO en los datos reales proporcionados" },
    cta_text: { type: "string", description: "Texto del botón de llamada a la acción, ej. 'Reserva ahora', 'Pide cita'" },
  },
  required: ["headline", "subheadline", "about", "cta_text"],
  additionalProperties: false,
};

export interface AIProvider {
  readonly isActive: boolean;
  generateAudit(input: { business: Business; scan: WebsiteScan | null; score: Score | null }): Promise<AuditReport>;
  generateProposal(input: {
    business: Business;
    audit: AuditReport | null;
    settings: Settings;
  }): Promise<ProposalContent>;
  generateOutreachMessage(input: { business: Business; audit: AuditReport }): Promise<OutreachMessage>;
  generateDemoCopy(input: { business: Business }): Promise<DemoCopy>;
  /** Token usage from the most recent generate* call, for cost tracking (§25). Null before any call. */
  getLastUsage(): { model: string; inputTokens: number; outputTokens: number } | null;
}

export class AnthropicAIProvider implements AIProvider {
  private lastUsage: { model: string; inputTokens: number; outputTokens: number } | null = null;

  get isActive() {
    return hasAnthropic;
  }

  getLastUsage() {
    return this.lastUsage;
  }

  private client(): Anthropic {
    if (!hasAnthropic) throw new ProviderNotConfiguredError("Anthropic API", ["ANTHROPIC_API_KEY"]);
    return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY! });
  }

  private async createStructured<T>(params: {
    model: string;
    system: string;
    prompt: string;
    schema: Record<string, unknown>;
  }): Promise<T> {
    const client = this.client();
    const response = await client.messages.create({
      model: params.model,
      max_tokens: 4096,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium", format: { type: "json_schema", schema: params.schema } },
      system: params.system,
      messages: [{ role: "user", content: params.prompt }],
    });

    this.lastUsage = {
      model: params.model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };

    if (response.stop_reason === "refusal") {
      throw new Error("La generación fue rechazada por los filtros de seguridad del modelo.");
    }

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") throw new Error("Respuesta de IA vacía.");
    return JSON.parse(textBlock.text) as T;
  }

  async generateAudit(input: {
    business: Business;
    scan: WebsiteScan | null;
    score: Score | null;
  }): Promise<AuditReport> {
    const { business, scan, score } = input;

    const prompt = `Genera una auditoría digital para este negocio, a partir ÚNICAMENTE de estos datos reales (nunca inventes datos adicionales):

NEGOCIO:
${JSON.stringify({ name: business.name, category: business.category, sector: business.sector, city: business.city, website_url: business.website_url, rating: business.rating, review_count: business.review_count }, null, 2)}

ESCANEO TÉCNICO DE LA WEB (null si no se ha escaneado / no tiene web):
${scan ? JSON.stringify({ technical: scan.technical, seo: scan.seo, conversion: scan.conversion, unavailable_metrics: scan.unavailable_metrics }, null, 2) : "null — este negocio no tiene web o no ha sido escaneada todavía"}

PUNTUACIÓN CALCULADA (null si no se ha calculado):
${score ? JSON.stringify({ opportunity_score: score.opportunity_score, buying_intent_score: score.buying_intent_score, opportunity_breakdown: score.opportunity_breakdown }, null, 2) : "null"}`;

    return this.createStructured<AuditReport>({
      model: "claude-sonnet-5",
      system: `Eres un consultor senior de una agencia digital que escribe auditorías de presencia digital para negocios locales, a partir de datos técnicos reales de escaneo web. ${NO_HALLUCINATION_RULE}`,
      prompt,
      schema: AUDIT_SCHEMA,
    });
  }

  async generateProposal(input: {
    business: Business;
    audit: AuditReport | null;
    settings: Settings;
  }): Promise<ProposalContent> {
    const { business, audit, settings } = input;

    const prompt = `Genera una propuesta comercial para este negocio, usando SOLO los servicios y precios reales configurados por la agencia (nunca inventes servicios ni precios):

NEGOCIO: ${JSON.stringify({ name: business.name, category: business.category, city: business.city })}

AUDITORÍA PREVIA (contexto, puede ser null): ${audit ? JSON.stringify(audit) : "null"}

SERVICIOS DISPONIBLES DE LA AGENCIA: ${JSON.stringify(settings.services)}
PRECIOS CONFIGURADOS: ${JSON.stringify(settings.pricing)}
NOMBRE DE LA AGENCIA: ${settings.agency_name}`;

    return this.createStructured<ProposalContent>({
      model: "claude-sonnet-5",
      system: `Eres un consultor comercial de una agencia digital que redacta propuestas personalizadas. ${NO_HALLUCINATION_RULE} Usa solo los servicios y precios que te doy — si no hay precio configurado para un servicio, indica "a consultar" en vez de inventar una cifra.`,
      prompt,
      schema: PROPOSAL_SCHEMA,
    });
  }

  async generateOutreachMessage(input: { business: Business; audit: AuditReport }): Promise<OutreachMessage> {
    const { business, audit } = input;

    const prompt = `Redacta un mensaje de primer contacto hiperpersonalizado (no genérico) para este negocio, basado en los problemas concretos detectados:

NEGOCIO: ${JSON.stringify({ name: business.name, category: business.category, city: business.city })}
PROBLEMAS DETECTADOS: ${JSON.stringify(audit.problems)}
OPORTUNIDADES: ${JSON.stringify(audit.opportunities)}

Nunca empieces con "Hola, hacemos páginas web." Referencia problemas concretos y reales de este negocio.`;

    return this.createStructured<OutreachMessage>({
      model: "claude-sonnet-5",
      system: `Eres un SDR de una agencia digital que escribe mensajes de primer contacto breves, concretos y hiperpersonalizados (nunca plantillas genéricas). ${NO_HALLUCINATION_RULE}`,
      prompt,
      schema: OUTREACH_SCHEMA,
    });
  }

  async generateDemoCopy(input: { business: Business }): Promise<DemoCopy> {
    const { business } = input;

    const prompt = `Escribe el copy para una página de demostración de nueva web para este negocio, usando ÚNICAMENTE estos datos reales:

${JSON.stringify({ name: business.name, category: business.category, sector: business.sector, city: business.city, address: business.address, phone: business.phone, rating: business.rating, review_count: business.review_count })}

No inventes servicios, precios, historia ni testimonios que no estén aquí. Si falta un dato, no lo menciones.`;

    return this.createStructured<DemoCopy>({
      model: "claude-sonnet-5",
      system: `Eres un copywriter de una agencia digital que escribe el texto de una página de aterrizaje de demostración para un negocio local, a partir de datos reales. ${NO_HALLUCINATION_RULE}`,
      prompt,
      schema: DEMO_COPY_SCHEMA,
    });
  }
}
