// Rilevamento della direzione del vento menzionata nella richiesta testuale di oggi, per il
// filtro deterministico di esclusione in pre-scoring.ts (vedi anche
// scripts/normalize-dataset.mjs per la derivazione di esposizione_venti_esposta_a sui dati).
//
// Due famiglie di termini, con guardia diversa contro i falsi positivi:
// - Nomi classici dei venti (tramontana, grecale, levante, scirocco, ostro, libeccio, ponente,
//   maestrale): sono parole quasi esclusivamente meteorologiche in italiano, quindi scattano da
//   sole, senza bisogno che il testo nomini anche "vento" (una richiesta come "oggi c'e'
//   scirocco, meglio evitare le spiagge esposte" e' gia' di per se' inequivocabile).
// - Punti cardinali semplici/composti (nord, sud-ovest, ecc.): sono parole ambigue che possono
//   comparire in contesti non meteorologici (es. "veniamo da Nord" riferito alla provenienza
//   degli ospiti), quindi scattano solo se il testo nomina esplicitamente "vento"/"venti".

export const CARDINAL_ORDER = ["n", "ne", "e", "se", "s", "so", "o", "no"] as const;
export type CardinalDirection = (typeof CARDINAL_ORDER)[number];

// Nomi classici dei venti: non ambigui, non richiedono la parola "vento" nel testo.
const NAMED_WIND_KEYWORDS: Record<string, CardinalDirection> = {
  tramontana: "n",
  grecale: "ne",
  levante: "e",
  scirocco: "se",
  ostro: "s",
  libeccio: "so",
  ponente: "o",
  maestrale: "no"
};

// Punti cardinali: ambigui, richiedono la parola "vento"/"venti" nel testo per scattare.
const CARDINAL_WIND_KEYWORDS: Record<string, CardinalDirection> = {
  "nord-ovest": "no",
  "nord ovest": "no",
  "nord-est": "ne",
  "nord est": "ne",
  "sud-ovest": "so",
  "sud ovest": "so",
  "sud-est": "se",
  "sud est": "se",
  settentrionale: "n",
  settentrionali: "n",
  meridionale: "s",
  meridionali: "s",
  occidentale: "o",
  occidentali: "o",
  orientale: "e",
  orientali: "e",
  nord: "n",
  sud: "s",
  est: "e",
  ovest: "o"
};

/**
 * Restituisce la prima direzione nominata nel testo secondo il dizionario dato (o null),
 * cercando prima i termini composti/piu' lunghi per evitare falsi positivi da sottostringa
 * (es. "sud-ovest" non deve far scattare anche "sud").
 */
function extractFirstDirection(text: string, keywords: Record<string, CardinalDirection>): CardinalDirection | null {
  const lower = text.toLowerCase();
  const sorted = Object.entries(keywords).sort((a, b) => b[0].length - a[0].length);
  let bestIndex = Infinity;
  let bestDirection: CardinalDirection | null = null;
  for (const [term, direction] of sorted) {
    const idx = lower.indexOf(term);
    if (idx !== -1 && idx < bestIndex) {
      bestIndex = idx;
      bestDirection = direction;
    }
  }
  return bestDirection;
}

/**
 * Rileva la direzione del vento menzionata nella richiesta di oggi. Prova prima i nomi
 * classici dei venti (sempre validi, nessuna parola d'ancoraggio richiesta); se non trova
 * nulla, prova i punti cardinali ma solo se il testo nomina esplicitamente "vento"/"venti".
 * Restituisce null se non trova nessuna direzione riconoscibile (in quel caso non filtriamo
 * nulla, meglio non applicare un'esclusione deterministica basata su un'ipotesi).
 */
export function detectWindDirection(text: string): CardinalDirection | null {
  const named = extractFirstDirection(text, NAMED_WIND_KEYWORDS);
  if (named) return named;
  if (!/\bvent[oi]\b/i.test(text)) return null;
  return extractFirstDirection(text, CARDINAL_WIND_KEYWORDS);
}
