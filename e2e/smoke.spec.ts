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

test("new-prospect page renders the CSV import form", async ({ page }) => {
  await page.goto("/dashboard/prospects/new");
  await expect(page.locator("form")).toBeVisible();
});
