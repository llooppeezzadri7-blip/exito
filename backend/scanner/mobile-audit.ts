import { assertSafeUrl, UnsafeUrlError, type SafetyOptions } from "@/lib/security/ssrf-guard";

/**
 * Real mobile audit (brief §7). The point of this module is the rule the
 * brief states outright: a `<meta name="viewport">` tag does not mean the
 * site works on a phone. So this renders the page in a real headless
 * Chromium at a phone viewport and measures what actually happens —
 * horizontal overflow, tap-target sizes, font sizes, whether the content
 * painted at all.
 *
 * Playwright is a devDependency (it ships with the e2e suite), so this is
 * imported lazily and reports NO_VERIFICADO when the browser is unavailable
 * rather than failing the whole scan.
 */

export interface MobileAuditFinding {
  key: string;
  /** What was measured, in defensible terms. */
  detail: string;
}

export interface MobileAuditResult {
  status: "completed" | "unavailable" | "failed";
  viewport: { width: number; height: number };
  /** Document wider than the viewport: the classic "se sale a la derecha". */
  hasHorizontalOverflow: boolean;
  documentWidth: number;
  /** Elements that stick out past the right edge, with a CSS-ish locator. */
  overflowingElements: string[];
  /** Links/buttons below the 24px minimum touch size Google measures. */
  smallTapTargets: number;
  tapTargetsChecked: number;
  /** Body copy rendered under 12px, which is unreadable on a phone. */
  tinyTextNodes: number;
  rendersContent: boolean;
  loadTimeMs: number | null;
  findings: MobileAuditFinding[];
  unavailableReason?: string;
}

const PHONE_VIEWPORT = { width: 390, height: 844 }; // iPhone 14-class viewport
const MIN_TAP_TARGET_PX = 24;
const MIN_READABLE_FONT_PX = 12;

function unavailable(reason: string): MobileAuditResult {
  return {
    status: "unavailable",
    viewport: PHONE_VIEWPORT,
    hasHorizontalOverflow: false,
    documentWidth: 0,
    overflowingElements: [],
    smallTapTargets: 0,
    tapTargetsChecked: 0,
    tinyTextNodes: 0,
    rendersContent: false,
    loadTimeMs: null,
    findings: [],
    unavailableReason: reason,
  };
}

export async function auditMobile(
  websiteUrl: string,
  options?: SafetyOptions & { timeoutMs?: number; executablePath?: string }
): Promise<MobileAuditResult> {
  try {
    await assertSafeUrl(websiteUrl, options);
  } catch (err) {
    return unavailable(err instanceof UnsafeUrlError ? err.message : "URL no válida");
  }

  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    return unavailable(
      "Playwright no está disponible en este entorno: la auditoría móvil real no se ha ejecutado."
    );
  }

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      ...(options?.executablePath ? { executablePath: options.executablePath } : {}),
    });
  } catch (err) {
    return unavailable(
      `No se pudo iniciar Chromium: ${err instanceof Error ? err.message : "error desconocido"}`
    );
  }

  try {
    const context = await browser.newContext({
      viewport: PHONE_VIEWPORT,
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    });
    const page = await context.newPage();

    const startedAt = Date.now();
    await page.goto(websiteUrl, {
      waitUntil: "domcontentloaded",
      timeout: options?.timeoutMs ?? 20_000,
    });
    const loadTimeMs = Date.now() - startedAt;

    const measurements = await page.evaluate(
      ({ minTap, minFont, phoneWidth }) => {
        // The reference width is the phone viewport we emulated, never
        // window.innerWidth: Chromium widens the layout viewport to fit
        // overflowing content, which would hide the very defect being
        // measured (observed: a 1400px block reported innerWidth 1400).
        const viewportWidth = phoneWidth;
        const reportedInnerWidth = window.innerWidth;
        const documentWidth = Math.max(
          document.documentElement.scrollWidth,
          document.body?.scrollWidth ?? 0
        );

        const describe = (el: Element) => {
          const id = el.id ? `#${el.id}` : "";
          const cls =
            typeof el.className === "string" && el.className.trim()
              ? `.${el.className.trim().split(/\s+/).slice(0, 2).join(".")}`
              : "";
          return `${el.tagName.toLowerCase()}${id}${cls}`;
        };

        const overflowing: string[] = [];
        for (const el of Array.from(document.body?.querySelectorAll("*") ?? [])) {
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) continue;
          // 2px tolerance for sub-pixel rounding and decorative borders.
          if (rect.right > viewportWidth + 2) {
            const label = describe(el);
            if (!overflowing.includes(label)) overflowing.push(label);
          }
          if (overflowing.length >= 10) break;
        }

        const tappable = Array.from(
          document.querySelectorAll("a[href], button, input[type=submit], [role=button]")
        );
        let smallTapTargets = 0;
        let tapTargetsChecked = 0;
        for (const el of tappable) {
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) continue; // hidden
          tapTargetsChecked++;
          if (rect.width < minTap || rect.height < minTap) smallTapTargets++;
        }

        let tinyTextNodes = 0;
        for (const el of Array.from(document.querySelectorAll("p, li, span, td, div"))) {
          const text = el.textContent?.trim() ?? "";
          if (text.length < 20) continue;
          const size = parseFloat(window.getComputedStyle(el).fontSize);
          if (Number.isFinite(size) && size < minFont) tinyTextNodes++;
        }

        const visibleText = (document.body?.innerText ?? "").trim();

        return {
          viewportWidth,
          reportedInnerWidth,
          documentWidth,
          overflowing,
          smallTapTargets,
          tapTargetsChecked,
          tinyTextNodes,
          rendersContent: visibleText.length > 50,
        };
      },
      {
        minTap: MIN_TAP_TARGET_PX,
        minFont: MIN_READABLE_FONT_PX,
        phoneWidth: PHONE_VIEWPORT.width,
      }
    );

    await context.close();

    const hasHorizontalOverflow = measurements.documentWidth > measurements.viewportWidth + 2;
    const findings: MobileAuditFinding[] = [];

    if (hasHorizontalOverflow) {
      findings.push({
        key: "horizontal_overflow",
        detail: `El contenido mide ${measurements.documentWidth}px en una pantalla de ${measurements.viewportWidth}px: el usuario tiene que desplazarse en horizontal.`,
      });
    }
    if (measurements.overflowing.length > 0) {
      findings.push({
        key: "elements_cut_off",
        detail: `Elementos que se salen de la pantalla: ${measurements.overflowing.join(", ")}.`,
      });
    }
    if (measurements.smallTapTargets > 0) {
      findings.push({
        key: "small_tap_targets",
        detail: `${measurements.smallTapTargets} de ${measurements.tapTargetsChecked} botones o enlaces miden menos de ${MIN_TAP_TARGET_PX}px: difíciles de pulsar con el dedo.`,
      });
    }
    if (measurements.tinyTextNodes > 0) {
      findings.push({
        key: "tiny_text",
        detail: `${measurements.tinyTextNodes} bloques de texto se renderizan por debajo de ${MIN_READABLE_FONT_PX}px.`,
      });
    }
    if (!measurements.rendersContent) {
      findings.push({
        key: "no_content_rendered",
        detail: "La página no muestra texto visible en móvil tras cargar.",
      });
    }

    return {
      status: "completed",
      viewport: PHONE_VIEWPORT,
      hasHorizontalOverflow,
      documentWidth: measurements.documentWidth,
      overflowingElements: measurements.overflowing,
      smallTapTargets: measurements.smallTapTargets,
      tapTargetsChecked: measurements.tapTargetsChecked,
      tinyTextNodes: measurements.tinyTextNodes,
      rendersContent: measurements.rendersContent,
      loadTimeMs,
      findings,
    };
  } catch (err) {
    return {
      ...unavailable(err instanceof Error ? err.message : "Error al renderizar en móvil"),
      status: "failed",
    };
  } finally {
    await browser.close().catch(() => {});
  }
}
