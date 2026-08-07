import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const INPUT_PATH = path.join(ROOT, "elba_spiagge_v3.json");
const OUTPUT_PATH = path.join(ROOT, "data", "processed", "spiagge.normalized.json");
const PUNTEGGI_PATH = path.join(ROOT, "data", "raw", "punteggi_categorie.json");

const YES_VALUES = new Set(["si", "sì", "true"]);
const NO_VALUES = new Set(["no", "false"]);

function toBooleanOrNull(value) {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (YES_VALUES.has(normalized)) return true;
  if (NO_VALUES.has(normalized)) return false;
  return null;
}

// Fonte di verita': campo esplicito "raggiungibile_via_terra" (booleano).
// true -> esiste un accesso da terra (con difficolta' variabile); false -> solo via mare.
// Se il campo manca (dato non ancora verificato), il default e' "unknown": non si assume
// ne' l'uno ne' l'altro finche' non viene confermato.
function normalizeReachability(spiaggia) {
  const value = toBooleanOrNull(spiaggia?.info_pratiche?.raggiungibile_via_terra);
  if (value === true) return "land";
  if (value === false) return "sea_only";
  return "unknown";
}

// Fonte di verita': campo esplicito "difficolta_accesso" (1-4), compilato solo per le
// spiagge raggiungibili da terra. 1=facile, 2=moderato, 3=impegnativo, 4=molto impegnativo.
const DIFFICULTY_LEVELS = {
  1: "easy_or_none",
  2: "moderate",
  3: "steep",
  4: "very_steep_or_impervious"
};

function normalizeTrailDifficulty(spiaggia) {
  const raw = spiaggia?.info_pratiche?.difficolta_accesso;
  const level = typeof raw === "number" ? raw : parseInt(raw, 10);
  return DIFFICULTY_LEVELS[level] ?? "easy_or_none";
}

function deriveActivityTags(spiaggia) {
  const tags = new Set();
  const travelerTags = Array.isArray(spiaggia?.caratteristiche?.tipo_viaggiatore)
    ? spiaggia.caratteristiche.tipo_viaggiatore
    : [];

  travelerTags.forEach((tag) => tags.add(String(tag).toLowerCase()));

  const pratiche = spiaggia?.info_pratiche || {};
  if (toBooleanOrNull(pratiche.snorkeling) === true) tags.add("snorkeling");
  if (toBooleanOrNull(pratiche.attivita_subacquee) === true) tags.add("diving");
  if (toBooleanOrNull(pratiche.windsurf) === true) tags.add("windsurf");
  if (toBooleanOrNull(pratiche.adatto_bambini) === true) tags.add("family");

  const atmosfere = Array.isArray(spiaggia?.caratteristiche?.atmosfera)
    ? spiaggia.caratteristiche.atmosfera
    : [];
  if (atmosfere.includes("tranquilla") || atmosfere.includes("intima")) tags.add("relax");
  if (atmosfere.includes("marina") || atmosfere.includes("autentica")) tags.add("passeggiata");

  return Array.from(tags);
}

// Le 10 categorie (le 9 originali + "belle_spettacolari") sono ora valutate da Mirco con un
// punteggio 0-3 curato a mano (vedi data/raw/punteggi_categorie.json, compilato a partire da
// YourElba_Spiagge_Punteggi_Categorie.xlsx). Questo e' il dato di verita' usato dal
// pre-scoring. CATEGORY_KEYWORDS/deriveCategoryFlags restano solo come fallback deterministico
// per una spiaggia eventualmente assente dal file curato (es. appena aggiunta al catalogo),
// convertendo il vecchio flag booleano in un punteggio approssimativo (true -> 2, false -> 0).
const CATEGORY_KEYWORDS = {
  adatto_famiglie: {
    tipoViaggiatore: ["famiglie", "famiglie con bambini piccoli"]
  },
  adatto_coppie: {
    tipoViaggiatore: ["coppie"]
  },
  giovani_ragazzi: {
    tipoViaggiatore: ["giovani", "ragazzi"],
    atmosfera: ["vivace", "movida_elbana", "sportiva"]
  },
  snorkeling_immersione: {
    tipoViaggiatore: ["snorkeling", "immersioni", "subacquea", "apnea", "pesca_subaquea", "snorkeli"],
    atmosfera: ["snorkeling_eccellente", "diving", "diving_center", "tuffi", "apnea"]
  },
  sport_acquatici: {
    tipoViaggiatore: ["windsurf", "kayak", "sup", "canoa", "sport", "sport velici", "avventura", "avventuroso"],
    atmosfera: ["sport_acquatici", "windsurf", "vela"]
  },
  natura_selvaggia: {
    tipoViaggiatore: ["natura", "geologia"],
    atmosfera: [
      "selvaggia", "incontaminata", "natura", "natura selvaggia", "parco_nazionale",
      "riserva_naturale", "riserva_biologica", "macchia_mediterranea", "falesie_bianche",
      "falesie_imponenti", "falesie_alte", "falesie", "isolata", "solitaria", "vergine",
      "primordiale", "integra", "selvaggio", "grotte"
    ]
  },
  rilassante_tranquilla: {
    tipoViaggiatore: ["relax", "relax veloce", "tranquillita", "pace", "solitudine", "isolamento"],
    atmosfera: [
      "tranquilla", "intima", "calma", "silenziosa", "riservata", "appartata", "nascosta",
      "tranquillità", "silenzio_assoluto", "ritmi_lenti", "rigenerante", "raccolta"
    ]
  },
  culturale_caratteristica: {
    tipoViaggiatore: ["storia"],
    atmosfera: [
      "storica", "mineraria", "autentica", "borgo_marinaro", "borgo_antico", "borgo",
      "borgo_intatto", "napoleonica", "mura_medicee", "torre_appiani", "forte_focardo",
      "leggenda", "ex_mineraria", "tonnara_antica", "isolotto_napoleonico", "vista_paolina",
      "caratteristica", "iconica", "pittoresca"
    ]
  },
  comfort_servizi: {
    atmosfera: ["servizi_top", "attrezzata", "comoda", "balneare", "servita", "elegante", "lungomare", "urbana"]
  }
};

function normalizeList(list) {
  return (Array.isArray(list) ? list : []).map((x) => String(x).trim().toLowerCase());
}

function deriveCategoryFlags(spiaggia) {
  const tipoViaggiatore = normalizeList(spiaggia?.caratteristiche?.tipo_viaggiatore);
  const atmosfera = normalizeList(spiaggia?.caratteristiche?.atmosfera);
  const pratiche = spiaggia?.info_pratiche || {};

  const hasAny = (values = [], list = []) => values.some((v) => list.includes(v));

  const categorie = {};
  for (const [category, rule] of Object.entries(CATEGORY_KEYWORDS)) {
    categorie[category] =
      hasAny(rule.tipoViaggiatore, tipoViaggiatore) || hasAny(rule.atmosfera, atmosfera);
  }

  // Rinforzi da campi info_pratiche gia' booleani/espliciti, oltre al testo libero.
  if (toBooleanOrNull(pratiche.adatto_bambini) === true) categorie.adatto_famiglie = true;
  if (toBooleanOrNull(pratiche.snorkeling) === true) categorie.snorkeling_immersione = true;
  if (toBooleanOrNull(pratiche.attivita_subacquee) === true) categorie.snorkeling_immersione = true;
  if (toBooleanOrNull(pratiche.windsurf) === true) categorie.sport_acquatici = true;

  const servizi = String(pratiche.servizi_ristoro ?? "").trim().toLowerCase();
  if (servizi && !["nessuno", "no", "no info", ""].includes(servizi)) {
    categorie.comfort_servizi = true;
  }
  if (String(pratiche.parcheggio ?? "").toLowerCase().includes("ampio")) {
    categorie.comfort_servizi = true;
  }

  return categorie;
}

const PUNTEGGIO_KEYS = [
  "adatto_famiglie",
  "adatto_coppie",
  "giovani_ragazzi",
  "snorkeling_immersione",
  "sport_acquatici",
  "natura_selvaggia",
  "rilassante_tranquilla",
  "culturale_caratteristica",
  "comfort_servizi",
  "belle_spettacolari"
];

// Fonte di verita' per il punteggio 0-3 di ogni categoria: il file curato a mano da Mirco
// (data/raw/punteggi_categorie.json). Se una spiaggia non e' presente li' (es. appena
// aggiunta), ripieghiamo sul vecchio flag booleano derivato dal testo, convertito in
// approssimazione 2/0 — e segnaliamo il fallback in console cosi' non passa inosservato.
function derivePunteggioCategorie(spiaggia, punteggiCurati) {
  const curato = punteggiCurati[spiaggia.id];
  if (curato) {
    const risultato = {};
    for (const key of PUNTEGGIO_KEYS) {
      const value = Number(curato[key]);
      risultato[key] = Number.isInteger(value) && value >= 0 && value <= 3 ? value : 0;
    }
    return risultato;
  }

  console.warn(
    `[normalize] Nessun punteggio curato per "${spiaggia.nome}" (${spiaggia.id}): uso fallback approssimato dal testo.`
  );
  const flags = deriveCategoryFlags(spiaggia);
  const risultato = {};
  for (const key of PUNTEGGIO_KEYS) {
    risultato[key] = flags[key] === true ? 2 : 0;
  }
  return risultato;
}

// --- Esposizione al vento: normalizzazione da testo libero a direzioni cardinali ---
//
// Regola generale: "esposizione_cardinale" e' l'orientamento fisico della spiaggia (la
// direzione verso cui si affaccia) ed e' la base di verita' geometrica. Per costruzione, una
// spiaggia e' naturalmente esposta al vento/mare che arriva dalla sua direzione di facciata e
// dalle due direzioni cardinali adiacenti (es. facciata "s" -> esposta a "so","s","se"); le
// altre 5 direzioni sono naturalmente riparate dalla conformazione della costa alle sue spalle.
// Il testo libero "esposizione_venti" e' solo una RIFINITURA: se nomina esplicitamente una
// direzione come riparo (es. "riparata dai venti settentrionali"), quella direzione viene
// tolta dall'esposizione anche se rientrava nell'arco geometrico di base (segno che li' c'e'
// un promontorio/conformazione che offre riparo aggiuntivo). Formule vaghe senza una direzione
// esplicita ("molto riparata", "riparata dalla maggior parte dei venti") NON aggiungono alcuna
// informazione: l'esposizione resta quella geometrica di base, per non inventare un riparo che
// il dato non dimostra (confermato da Mirco: una spiaggia rivolta a S dentro una baia chiusa
// resta comunque esposta all'arco attorno a S, la nota testuale non lo esclude).
const CARDINAL_ORDER = ["n", "ne", "e", "se", "s", "so", "o", "no"];

const WIND_DIRECTION_KEYWORDS = {
  settentrionali: "n",
  orientali: "e",
  meridionali: "s",
  occidentali: "o",
  "nord-ovest": "no",
  "nord ovest": "no",
  "nord-est": "ne",
  "nord est": "ne",
  "sud-ovest": "so",
  "sud ovest": "so",
  "sud-est": "se",
  "sud est": "se",
  scirocco: "se",
  ponente: "o",
  nord: "n",
  sud: "s",
  est: "e",
  ovest: "o"
};

function cardinalArc(direzione) {
  const i = CARDINAL_ORDER.indexOf(direzione);
  if (i === -1) return [];
  return [CARDINAL_ORDER[(i + 7) % 8], CARDINAL_ORDER[i], CARDINAL_ORDER[(i + 1) % 8]];
}

// Estrae le direzioni nominate esplicitamente nel testo. Le chiavi composte (es.
// "sud-ovest") vengono cercate e "mascherate" prima delle chiavi semplici (es. "sud") per
// evitare falsi positivi da sottostringa (altrimenti "sud-ovest" farebbe scattare anche "sud").
function extractNamedDirections(text) {
  const found = new Set();
  let working = String(text ?? "").toLowerCase();
  const sorted = Object.entries(WIND_DIRECTION_KEYWORDS).sort((a, b) => b[0].length - a[0].length);
  for (const [term, code] of sorted) {
    if (working.includes(term)) {
      found.add(code);
      working = working.split(term).join(" ".repeat(term.length));
    }
  }
  return Array.from(found);
}

// Pochi casi in cui il testo libero non e' riconducibile alla regola generale, confermati a
// mano con Mirco (non generalizzabili, per questo gestiti come eccezioni esplicite):
// - Enfola: e' un istmo con due lati opposti, ma solo uno e' davvero balneabile (l'altro sono
//   scogli e un piccolo porticciolo dei residenti, non una spiaggia). Si tiene solo il lato
//   spiaggia, che il testo descrive come "riparato da Nord" cioe' esposto a Sud.
// - Monte Enfola: il testo restringe esplicitamente l'esposizione geometrica di base (e/se/s)
//   a una sola direzione debole ("esposta leggermente a sud est"), quindi e' piu' protetta di
//   quanto direbbe la sola geometria.
// San Giovanni e Felciaio (protezione da diga foranea / scogliera artificiale) NON sono
// eccezioni: restano nella regola generale (nessuna direzione nominata esplicitamente ->
// esposizione geometrica di base), su indicazione esplicita di Mirco.
const WIND_EXPOSURE_OVERRIDES = {
  enfola: ["s"],
  monte_enfola: ["se"]
};

function deriveWindExposure(spiaggia) {
  const override = WIND_EXPOSURE_OVERRIDES[spiaggia.id];
  if (override) return override;

  const testo = String(spiaggia.esposizione_venti ?? "");
  if (/molto esposta/i.test(testo)) return [...CARDINAL_ORDER];

  const baseline = spiaggia.esposizione_cardinale ? cardinalArc(spiaggia.esposizione_cardinale) : [];
  const named = extractNamedDirections(testo);

  if (/eccetto/i.test(testo) && named.length > 0) {
    // "riparata... eccetto venti da X": riparo ampio con un'unica eccezione esplicita.
    return named;
  }

  const exposed = new Set(baseline);
  for (const dir of named) exposed.delete(dir);
  return Array.from(exposed);
}

function normalizeBeach(spiaggia, punteggiCurati) {
  return {
    id: spiaggia.id,
    nome: spiaggia.nome,
    zona: spiaggia.zona,
    comune: spiaggia.comune ?? null,
    localita: spiaggia.localita ?? null,
    tipo_fondale: spiaggia.tipo_fondale ?? null,
    lunghezza_m: spiaggia.lunghezza_m ?? null,
    esposizione_venti: spiaggia.esposizione_venti ?? null,
    esposizione_cardinale: spiaggia.esposizione_cardinale ?? null,
    esposizione_venti_esposta_a: deriveWindExposure(spiaggia),
    affollamento: {
      livello_generale: spiaggia?.affollamento?.livello_generale ?? "medio",
      note: spiaggia?.affollamento?.note ?? null
    },
    info_pratiche: {
      accessibilita_disabili: toBooleanOrNull(spiaggia?.info_pratiche?.accessibilita_disabili),
      adatto_bambini: toBooleanOrNull(spiaggia?.info_pratiche?.adatto_bambini),
      cani_ammessi: toBooleanOrNull(spiaggia?.info_pratiche?.cani_ammessi),
      raggiungibile_via_terra: toBooleanOrNull(spiaggia?.info_pratiche?.raggiungibile_via_terra),
      difficolta_accesso: spiaggia?.info_pratiche?.difficolta_accesso ?? null,
      reachability: normalizeReachability(spiaggia),
      trail_difficulty: normalizeTrailDifficulty(spiaggia),
      naturismo_tollerato: Boolean(spiaggia?.info_pratiche?.naturismo_tollerato)
    },
    activity_tags: deriveActivityTags(spiaggia),
    punteggi_categorie: derivePunteggioCategorie(spiaggia, punteggiCurati),
    indicazioni: spiaggia.indicazioni ?? null,
    note_qualitative: spiaggia.note_qualitative ?? null
  };
}

async function run() {
  const raw = await fs.readFile(INPUT_PATH, "utf8");
  const parsed = JSON.parse(raw);
  const beaches = Array.isArray(parsed?.spiagge) ? parsed.spiagge : [];

  let punteggiCurati = {};
  try {
    punteggiCurati = JSON.parse(await fs.readFile(PUNTEGGI_PATH, "utf8"));
  } catch (_error) {
    console.warn(
      `[normalize] Nessun file di punteggi curati trovato in ${PUNTEGGI_PATH}: tutte le spiagge useranno il fallback approssimato.`
    );
  }

  const normalized = {
    meta: {
      destinazione: parsed?.destinazione ?? "Isola d'Elba",
      versione: parsed?.versione ?? "unknown",
      fonte: parsed?.fonte ?? null,
      ultima_verifica: parsed?.ultima_verifica ?? null,
      generated_at: new Date().toISOString()
    },
    stats: {
      beaches_total: beaches.length
    },
    spiagge: beaches.map((b) => normalizeBeach(b, punteggiCurati))
  };

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(normalized, null, 2), "utf8");
  console.log(`Normalized dataset written to ${OUTPUT_PATH}`);
}

run().catch((error) => {
  console.error("Normalization failed:", error);
  process.exit(1);
});
