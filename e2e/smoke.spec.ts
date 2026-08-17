import { test, expect } from "@playwright/test";

// These run in mock-data mode (no Supabase/Anthropic/Google/Webflow secrets
// in CI — see playwright.config.ts and .github/workflows/ci.yml), so the
// auth gate no-ops (lib/supabase/proxy.ts) and /dashboard is reachable
// without logging in. They cover the "dashboard shell w/ mock data" part of
// ROADMAP.md Phase 1, end to end through a real browser.

test("root redirects to the dashboard", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("login page renders the auth form", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Iniciar sesión" })).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Contraseña")).toBeVisible();
  await expect(page.getByRole("button", { name: "Entrar" })).toBeVisible();
});

test("signup page renders", async ({ page }) => {
  await page.goto("/signup");
  await expect(page.locator("form")).toBeVisible();
});

test("dashboard shell renders with sidebar nav and KPI tiles", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByText("AI Digital Agency OS")).toBeVisible();
  await expect(page.getByRole("link", { name: "Prospectos" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByText("Leads de alta prioridad")).toBeVisible();
  await expect(page.getByText("Modo demo", { exact: false })).toBeVisible();
});

test("sidebar navigates across every dashboard section without error", async ({ page }) => {
  await page.goto("/dashboard");

  const sections: Array<[string, string | RegExp]> = [
    ["Prospectos", /\/dashboard\/prospects$/],
    ["Auditorías", /\/dashboard\/audits$/],
    ["Informes", /\/dashboard\/reports$/],
    ["Demos", /\/dashboard\/demos$/],
    ["Propuestas", /\/dashboard\/proposals$/],
    ["Pipeline", /\/dashboard\/pipeline$/],
    ["Memoria", /\/dashboard\/memory$/],
    ["Configuración", /\/dashboard\/settings$/],
  ];

  for (const [label, urlPattern] of sections) {
    await page.getByRole("link", { name: label }).click();
    await expect(page).toHaveURL(urlPattern);
    // No client-side exception boundary / Next.js error overlay.
    await expect(page.getByText("Application error")).toHaveCount(0);
  }
});

test("prospects list links through to a prospect detail page", async ({ page }) => {
  await page.goto("/dashboard/prospects");
  const firstRow = page.locator("main a[href^='/dashboard/prospects/']").first();
  await expect(firstRow).toBeVisible();
  await firstRow.click();
  await expect(page).toHaveURL(/\/dashboard\/prospects\/[^/]+$/);
});

test("settings page saves scoring weights and normalizes them to 100%", async ({ page }) => {
  await page.goto("/dashboard/settings");

  const seo = page.getByLabel("SEO (porcentaje)", { exact: true });
  await expect(seo).toBeVisible();

  // Deliberately push the group past 100% — the server normalizes on save.
  await seo.fill("40");
  await expect(page.getByText(/al guardar se normalizará a 100%/)).toBeVisible();

  await page.getByRole("button", { name: "Guardar pesos" }).click();
  await expect(page.getByText(/Pesos guardados y normalizados al 100%/)).toBeVisible();

  // Values shown after the save are what the server stored: scaled down so the
  // group adds up to 100% again. (Asserted relatively, not as a fixed number —
  // the mock store keeps earlier edits within a server session.)
  await expect(seo).not.toHaveValue("40");
  await expect(page.getByText(/^Total: 100%$/).first()).toBeVisible();
});

test("settings page recalculates every stored score", async ({ page }) => {
  await page.goto("/dashboard/settings");
  await page.getByRole("button", { name: "Recalcular todas las puntuaciones" }).click();
  await expect(page.getByText(/Recalculadas \d+ puntuaci/)).toBeVisible();
});

test("market research page offers the full configuration form", async ({ page }) => {
  await page.goto("/dashboard/research");

  await expect(page.getByRole("heading", { name: "Investigación de mercado" })).toBeVisible();
  // Located by field name: the labels wrap their control, so the accessible
  // name concatenates the label and the option text.
  await expect(page.locator('select[name="municipality"]')).toBeVisible();
  await expect(page.locator('select[name="sector"]')).toBeVisible();
  await expect(page.locator('select[name="subsector"]')).toBeVisible();
  await expect(page.locator('input[name="maxBusinesses"]')).toBeVisible();

  // The three depth presets from the brief.
  await expect(page.getByText("Investigación rápida")).toBeVisible();
  await expect(page.getByText("Investigación profunda")).toBeVisible();
  await expect(page.getByText("Investigación completa")).toBeVisible();
  await expect(page.getByRole("button", { name: /Iniciar investigación/ })).toBeVisible();
});

test("subsector choices depend on the chosen sector", async ({ page }) => {
  await page.goto("/dashboard/research");

  const subsector = page.locator('select[name="subsector"]');
  await expect(subsector).toBeDisabled();

  await page.locator('select[name="sector"]').selectOption("Hostelería");
  await expect(subsector).toBeEnabled();
  await expect(subsector.locator("option", { hasText: "Restaurantes" })).toHaveCount(1);
});

test("discovery needs no credentials and the corroboration rule is stated", async ({ page }) => {
  await page.goto("/dashboard/research");

  await expect(page.getByText("Fuentes de descubrimiento")).toBeVisible();
  await expect(page.getByText("OpenStreetMap").first()).toBeVisible();
  await expect(page.getByText("Registre de Turisme de Catalunya").first()).toBeVisible();
  await expect(page.getByText(/dos fuentes independientes/).first()).toBeVisible();
  // No key gate any more: the run can be launched as-is.
  await expect(page.getByRole("button", { name: /Iniciar investigación/ })).toBeEnabled();
});

test("settings shows API status without ever revealing a key", async ({ page }) => {
  await page.goto("/dashboard/settings");

  await expect(page.getByRole("heading", { name: "APIs e integraciones" })).toBeVisible();
  await expect(page.getByText("GOOGLE_PAGESPEED_API_KEY")).toBeVisible();
  await expect(page.getByText("No configurada").first()).toBeVisible();
  await expect(page.getByText("La clave nunca se envía al navegador")).toBeVisible();
});

test("prospect detail shows the commercial score with evidence and competitors", async ({ page }) => {
  await page.goto("/dashboard/prospects");
  // Excluding /new: that link also matches the prefix and would land on the
  // import form instead of a prospect.
  await page
    .locator("main a[href^='/dashboard/prospects/']:not([href$='/new'])")
    .first()
    .click();

  await expect(page.getByText("Oportunidad comercial")).toBeVisible();
  await expect(page.getByText("Necesidad", { exact: true })).toBeVisible();
  await expect(page.getByText("Capacidad de pago")).toBeVisible();
  await expect(page.getByText("Ajuste con nuestros servicios")).toBeVisible();
  await expect(page.getByText(/del modelo/)).toBeVisible();
  await expect(page.getByText("Competencia", { exact: true }).first()).toBeVisible();
});

test("memory page shows what the system learned and what it may not change", async ({ page }) => {
  await page.goto("/dashboard/memory");

  await expect(page.getByRole("heading", { name: "Memoria y aprendizaje" })).toBeVisible();
  await expect(page.getByText("Estado de la memoria")).toBeVisible();
  await expect(page.getByText("Rendimiento de las fuentes")).toBeVisible();
  await expect(page.getByText("Reglas que el aprendizaje no puede tocar")).toBeVisible();
  // The hard constraints must be visible, not buried in code.
  await expect(page.getByText(/NO_VERIFICADO, nunca se rellena/)).toBeVisible();
});

test("new-prospect page renders the CSV import form", async ({ page }) => {
  await page.goto("/dashboard/prospects/new");
  await expect(page.locator("form")).toBeVisible();
});
