import http from "node:http";
import type { AddressInfo } from "node:net";

/**
 * Minimal fixture server for the scanner tests. The scanner is only worth
 * trusting if it has been run against real HTTP responses — real redirects,
 * real 404s, real headers — so the tests serve pages here instead of stubbing
 * fetch. The SSRF guard blocks loopback by design, so the tests that use this
 * pass `allowLoopbackForTesting` explicitly.
 */

export interface FixtureRoute {
  status?: number;
  headers?: Record<string, string>;
  body?: string;
}

export interface TestServer {
  origin: string;
  url(path: string): string;
  requestLog: string[];
  close(): Promise<void>;
}

export async function startTestServer(routes: Record<string, FixtureRoute>): Promise<TestServer> {
  const requestLog: string[] = [];

  const server = http.createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    requestLog.push(path);

    const route = routes[path];
    if (!route) {
      res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<html><body>No encontrado</body></html>");
      return;
    }

    res.writeHead(route.status ?? 200, {
      "Content-Type": "text/html; charset=utf-8",
      ...route.headers,
    });
    res.end(route.body ?? "");
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${port}`;

  return {
    origin,
    url: (path: string) => `${origin}${path}`,
    requestLog,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      ),
  };
}

/** A complete, well-built page — the "nothing to sell here" baseline. */
export const GOOD_PAGE = `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>Restaurant Can Prova — Cocina catalana en Lloret de Mar</title>
  <meta name="description" content="Restaurante de cocina catalana en Lloret de Mar desde 1985. Reserva mesa online.">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="canonical" href="https://canprova.test/">
  <link rel="alternate" hreflang="es" href="https://canprova.test/">
  <link rel="alternate" hreflang="en" href="https://canprova.test/en/">
  <meta property="og:title" content="Restaurant Can Prova">
  <meta property="og:description" content="Cocina catalana en Lloret de Mar">
  <meta property="og:image" content="https://canprova.test/portada.jpg">
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"Restaurant","name":"Can Prova"}</script>
</head>
<body>
  <h1>Restaurant Can Prova</h1>
  <h2>Nuestra carta</h2>
  <p>Cocina catalana de mercado en el centro de Lloret de Mar, Carrer de la Vila 39.</p>
  <img src="/foto.jpg" alt="Comedor del restaurante">
  <a href="tel:+34972373401">972 37 34 01</a>
  <a href="mailto:hola@canprova.test">Escríbenos</a>
  <a href="https://wa.me/34972373401">WhatsApp</a>
  <a href="https://www.instagram.com/canprova/">Instagram</a>
  <a href="https://www.facebook.com/canprova/">Facebook</a>
  <a href="https://www.thefork.es/restaurante/can-prova">Reservar mesa</a>
  <a href="/carta">Ver la carta</a>
  <a href="/contacto">Contacto</a>
  <form action="/contacto" method="post"><input name="email"><button>Enviar</button></form>
</body>
</html>`;

/** A page with the problems the audit is supposed to detect. */
export const BAD_PAGE = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title></title>
</head>
<body>
  <div>Bienvenidos a nuestro taller. Llámenos para más información sobre nuestros servicios de mecánica general y chapa y pintura.</div>
  <img src="/coche.jpg">
  <img src="/taller.jpg">
  <a href="/rota">Enlace roto</a>
  <a href="/otra-rota">Otro enlace roto</a>
</body>
</html>`;

/** Renders wider than a phone viewport — for the mobile audit. */
export const OVERFLOWING_PAGE = `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Página que se sale</title>
</head>
<body style="margin:0">
  <div id="ancho" style="width:1400px;height:200px;background:#ccc">
    Este bloque mide 1400 píxeles y no cabe en un móvil.
  </div>
  <p style="font-size:8px">Texto diminuto que nadie puede leer en un teléfono, pero que ocupa suficiente longitud para contar.</p>
  <a href="/x" style="display:inline-block;width:10px;height:10px">.</a>
</body>
</html>`;

/** Renders correctly on a phone. */
export const MOBILE_OK_PAGE = `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Página correcta en móvil</title>
</head>
<body style="margin:0;font-size:16px">
  <h1>Taller Prova</h1>
  <p>Somos un taller mecánico en Lloret de Mar con más de treinta años de experiencia en el sector del automóvil.</p>
  <a href="tel:+34972000000" style="display:inline-block;padding:16px 24px;font-size:16px">Llámanos</a>
</body>
</html>`;
