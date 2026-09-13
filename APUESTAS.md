# Sistema de apuestas — LaLiga y Premier (Sportium)

Herramienta para apostar con criterio en Sportium: calculadora de valor, evaluador de
supercuotas y combinadas, y un backtester que mide si una estrategia tiene ventaja real
o solo ha tenido suerte.

**No es un generador de pronósticos.** No predice partidos. Lo que hace es impedir que
apuestes a precios que pierden dinero aunque aciertes mucho.

## 1. La regla que gobierna todo

Con un 80% de acierto, la cuota de equilibrio es exactamente **1,25** (`1 / 0,80`).

| Acierto | Cuota media | ROI |
| ------- | ----------- | --- |
| 80% | 1,20 | −4,0% |
| 80% | 1,25 | 0% |
| 80% | 1,30 | +4,0% |
| 80% | 1,35 | +8,0% |

Un porcentaje de acierto alto no significa nada por sí solo: es trivial acertar el 90%
apostando a cuota 1,10 y perder dinero constantemente. Por eso el sistema opera en una
banda cerrada, `SYSTEM_BAND` = **1,28 – 1,45**:

- **Por debajo de 1,28** no queda margen para el error de estimación.
- **Por encima de 1,45**, si el mercado paga tanto es que tu "80%" probablemente no es real.

## 2. Estado actual de los datos: NO hay cuotas reales conectadas

El sistema distingue tres orígenes y lo marca en **cada fila**, nunca de forma decorativa:

| Etiqueta | Qué es | ¿Se puede apostar? |
| -------- | ------ | ------------------ |
| `REAL` | Cuota obtenida en vivo de una fuente real. | Sí |
| `BACKTEST` | Medido sobre resultados históricos. Dato real, pero del pasado. | No por sí solo |
| `DEMO` | Inventado para probar el sistema. | **Nunca** |

**Ahora mismo el sistema arranca en DEMO**, porque no hay ninguna API de cuotas conectada.
Para tener datos reales hace falta:

1. Crear una clave gratuita en [the-odds-api.com](https://the-odds-api.com).
2. Añadirla a `.env.local`: `ODDS_API_KEY=tu_clave` (y opcionalmente `ODDS_API_REGION=eu`).
3. Reiniciar el servidor.

Sin esa clave, el dashboard funciona igual pero todo sale marcado `DEMO` y la columna
"Apostables de verdad" se queda en 0. **No hay ningún camino por el que un dato inventado
llegue a la pantalla sin su etiqueta**, y está cubierto por tests:

- Una cuota DEMO nunca es apostable, por mucho valor que muestre.
- Una cuota real con probabilidad DEMO tampoco lo es: manda el eslabón más débil.
- Una apuesta DEMO marcada como ganada **no suma nada** al beneficio del historial.

### De dónde salen las probabilidades

El sistema **no predice partidos**. No hay modelo entrenado. Solo tiene dos formas honestas
de producir una probabilidad:

- **`market-devig`**: coger un mercado completo de la casa con menos margen, quitarle la
  comisión y quedarse con su opinión real. Sirve para buscar valor contra *otra* casa.
- **`backtest`**: la base rate medida sobre histórico.

Si no hay ninguna de las dos para un mercado, **el sistema no se inventa un número**: la
cuota aparece en "vistas pero no analizadas" con el motivo.

## 3. Qué hay

| Módulo | Para qué |
| ------ | -------- |
| `lib/betting/odds.ts` | Probabilidad implícita, margen, quitar el margen (proporcional, potencia y Shin), valor esperado, Kelly, combinadas. |
| `lib/betting/sportium.ts` | Filtro de banda, supercuotas, valor real de las apuestas gratis, cash out, boost de combinadas. |
| `lib/betting/markets.ts` | Mercados (goles, córners, tarjetas) y filtros de partido. |
| `lib/betting/football-data.ts` | Lector de los CSV de football-data.co.uk. |
| `lib/betting/backtest.ts` | Motor de backtest con intervalo de confianza de Wilson. |
| `lib/betting/playbook.ts` | Las estrategias concretas del sistema, como hipótesis a medir. |
| `lib/betting/staking.ts` | Tamaño de apuesta, CLV y estimación de rachas perdedoras. |
| `lib/betting/providers/` | Fuentes de cuotas. `the-odds-api.ts` (real) y `demo.ts` (inventado). |
| `lib/betting/estimates.ts` | De dónde sale cada probabilidad (devig de mercado o backtest). |
| `lib/betting/recommendations.ts` | Convierte cuotas + probabilidades en recomendaciones con origen. |
| `lib/betting/generate.ts` | El pipeline completo, compartido por el dashboard y la CLI. |
| `lib/betting/history.ts` | Historial persistente y P&L (excluye DEMO). |
| `app/apuestas` | Dashboard, historial y calculadora. |
| `scripts/backtest-apuestas.ts` | Backtest por línea de comandos. |
| `scripts/generar-apuestas.ts` | Genera las apuestas recomendadas y las guarda. |

## 4. Cómo usarlo

### Generar apuestas y verlas

```bash
npm run apuestas:generar          # genera y guarda las recomendaciones
npm run dev                       # y abre http://localhost:3000/apuestas
```

| Pantalla | URL | Qué muestra |
| -------- | --- | ----------- |
| Dashboard | `/apuestas` (y también `/`) | Apuestas recomendadas, ordenadas por valor esperado, con el origen de cada dato. |
| Historial | `/apuestas/historial` | Qué se recomendó, a qué cuota, con qué resultado y cuánto se ganó o perdió. |
| Calculadora | `/apuestas/calculadora` | Valor, supercuota, combinada y backtest manual. |

La raíz `/` redirige al dashboard: es el panel principal. El producto de agencia con el
que nació este repo sigue en `/dashboard`.

**Ficheros generados** (ambos en `data/`, que está en `.gitignore`):

- `data/apuestas-recomendadas.json` — la última tanda de apuestas.
- `data/apuestas-historial.json` — el historial acumulado con su P&L.

Opciones de la CLI:

```bash
npm run apuestas:generar -- --banca 100 --casa sportium
npm run apuestas:generar -- --todas-las-cuotas   # sin filtrar por la banda
```

### Backtest por terminal

```bash
# Descargar temporadas y medir el playbook completo
npm run apuestas:backtest -- --download --div SP1,E0 --seasons 2425,2324,2223

# Con ficheros que ya tengas
npm run apuestas:backtest -- data/SP1-2425.csv data/E0-2425.csv

# Una sola estrategia, con la cuota que veas de verdad en Sportium
npm run apuestas:backtest -- data/*.csv --strategy laliga_cards_over_2.5 --odds 1.32
```

Los datos salen de [football-data.co.uk](https://www.football-data.co.uk/spainm.php)
(`SP1` = LaLiga, `E0` = Premier), la única fuente gratuita que trae resultados, córners,
tarjetas y cuotas históricas juntos.

## 5. Cuándo una estrategia "sobrevive"

Dos condiciones, las dos obligatorias:

1. **Al menos 300 apuestas.** Por debajo, un buen porcentaje es ruido.
2. **El extremo bajo del intervalo de confianza del 95% sigue por encima del punto de
   equilibrio.** Si el intervalo incluye el break-even, no puedes distinguir la estrategia
   de la suerte, por bonito que sea el ROI.

Se usa el intervalo de Wilson y no la aproximación normal porque con acierto cercano al
80% y unos cientos de muestras, la aproximación normal se comporta mal justo ahí.

## 6. Las hipótesis del playbook

Cada estrategia de `playbook.ts` es una **hipótesis con su razonamiento**, no un resultado.
Las principales:

- **Tarjetas en LaLiga.** LaLiga se arbitra con mucha más tarjeta que la Premier. La
  estrategia de la Premier está incluida *a propósito como control*: si LaLiga no sale
  claramente por encima, la premisa es falsa y hay que tirar el bloque entero.
- **Córners con favorito claro.** El favorito encierra al rival y el volumen de córner se
  dispara. Mercado secundario, peor modelado por la casa.
- **Barça en casa.** Línea alta y dominio territorial permanente bajo Flick: volumen de
  córner estructural, no por racha.
- **Partidos sin favorito claro para tarjetas.** Una goleada decidida al descanso mata el
  mercado de tarjetas: el rival deja de competir y las faltas se acaban.

### Limitaciones que debes conocer

- **Córners y tarjetas no tienen cuota histórica.** football-data no las publica, así que
  esas estrategias usan `assumedOdds`. **Su ROI es hipotético hasta que pongas precios que
  hayas visto de verdad en Sportium.** El backtest lo marca como "cuota asumida".
- **Las tarjetas pueden estar sobrecontadas.** El dataset no distingue si una roja vino de
  doble amarilla, y los proveedores no coinciden en si registran además la primera amarilla.
  En partidos con expulsión por doble amarilla el total puede irse en uno. Trata el acierto
  medido en mercados de tarjetas como un **techo**, no como una medida exacta.
- **Las combinadas se calculan como independientes.** Las selecciones del mismo partido no
  lo son: usa el precio del creador de apuestas de Sportium, que ya incluye la correlación
  a favor de la casa.

## 7. Sportium en concreto

Los valores de `SPORTIUM_DEFAULTS` son términos **típicos**, no garantizados: el tope y la
forma de pago cambian en cada promoción. Léelos y ajústalos.

- **Supercuotas.** Lo habitual es que solo los primeros ~10 € vayan a cuota mejorada y que
  el extra se pague como **apuesta gratis, no en dinero real**. Una apuesta gratis no vale
  su valor nominal porque no devuelve la parte apostada: a cuota 4 conservas alrededor del
  71%. La pestaña de Supercuota calcula la **cuota efectiva real**, que es la que debes
  comparar con la banda.
- **Cash out.** Lleva un segundo margen encima del original. `evaluateCashOut` te dice qué
  porcentaje del valor real se queda la casa. Casi siempre la respuesta es no cerrar.
- **Boost de combinadas.** El margen no se suma, se multiplica. Con un 5% por selección,
  una combinada de 4 necesita un boost del **21,6%** solo para empatar. Los boosts del 5%
  o el 10% que se anuncian siguen dejando la apuesta en negativo.

## 8. Lo que esto no arregla

Aunque el sistema salga positivo, el margen es fino y hay tres cosas que lo atacan:

1. **Límites de cuenta.** Si corres con ventaja real en mercados nicho, Sportium te va a
   limitar el stake. No es paranoia, es el modelo de negocio.
2. **Fiscalidad.** Las ganancias de juego tributan en el IRPF. Con una ventaja de un pocos
   puntos de ROI, el impacto fiscal puede comerse buena parte del margen. Consúltalo con un
   gestor antes de escalar volumen.
3. **Varianza.** Con un 80% de acierto sobre 500 apuestas, una racha de 4 fallos seguidos
   es prácticamente una moneda al aire (~55%) y una de 5 pasa alrededor de una vez de cada
   siete. `drawdownEstimate` te lo cuantifica. Si una racha así te haría abandonar el
   sistema o doblar apuestas, el sistema no es para ti por muy bueno que sea su ROI.

**El resultado más probable para un apostante particular es perder dinero.** Apuesta solo
lo que puedas permitirte perder. Juego responsable: [ordenacionjuego.es](https://www.ordenacionjuego.es/es/jugar-bien).

## 9. Tests

```bash
npm test -- lib/betting
```

La matemática está cubierta con casos comprobables: la regla del 1,25, el margen de la
casa, los tres métodos para quitarlo, el ejemplo real de supercuota de Sportium, el
intervalo de Wilson contra su valor publicado, y la demostración de que tres selecciones
al 80% pagadas a 1,20 aciertan el 51% y aun así pierden un 11,5%.

Las garantías de honestidad también son tests, no promesas:

- `recommendations.test.ts` — una cuota sin probabilidad no se puntúa, se reporta; DEMO
  nunca es apostable; el orden es por valor esperado, no por porcentaje de acierto.
- `history.test.ts` — una apuesta DEMO ganada no suma al beneficio real.
- `estimates.test.ts` — comparar una casa contra sí misma nunca encuentra valor.
- `providers/providers.test.ts` — sin `ODDS_API_KEY` jamás se devuelve algo etiquetado
  como real, y el proveedor DEMO usa equipos ficticios para que no pueda confundirse con
  un partido de verdad.
