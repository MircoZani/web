import fs from "node:fs";
import path from "node:path";
import { applyHardExclusions } from "../modules/exclusion-layer";
import {
  generateConflictOnlyResponse,
  generateFinalResponse,
  type NamedBeachExclusionEntry,
  type ShortlistBeachDetail
} from "../modules/conversation-layer";
import { interpretUserRequest } from "../modules/interpretation-layer";
import type { CategoryScores, RecommendationBeach, RecommendationUserProfile } from "../modules/recommendation-engine";
import { rankCandidateBeachesWithAi, type AiRankingShortlistItem } from "../modules/recommendation-engine/ai-ranking";
import { preScoreAndFilter, type MassimoAffollamentoTollerato } from "../modules/recommendation-engine/pre-scoring";
import { detectWindDirection } from "../modules/recommendation-engine/wind";

// Riconosce quando il testo libero di oggi nomina esplicitamente una spiaggia del catalogo per
// nome (es. "voglio andare alla Biodola"), cosi' da poterle dare una risposta diretta se risulta
// esclusa da una preferenza gia' impostata, invece di lasciare che l'AI la reinterpreti a modo
// suo (osservato in un test live: "Biodola" esclusa per affollamento veniva trattata come "base"
// per un giro con altre spiagge, ignorando la domanda diretta). Match deterministico su nome
// intero (non porzioni), case/accenti/apostrofi normalizzati, per gestire nomi come "Sant'Andrea"
// o "Marina di Campo". Nomi troppo corti (<4 caratteri normalizzati) sono ignorati per evitare
// falsi positivi su parole comuni.
function normalizeForNameMatch(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(new RegExp("[\\u0300-\\u036f]", "g"), "")
    .replace(/['’]/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function detectNamedBeachMentions(text: string, beaches: RecommendationBeach[]): RecommendationBeach[] {
  const normalizedText = normalizeForNameMatch(text);
  if (!normalizedText) return [];
  const matches: RecommendationBeach[] = [];
  for (const beach of beaches) {
    const normalizedName = normalizeForNameMatch(beach.nome);
    if (normalizedName.length < 4) continue;
    const pattern = new RegExp(`\\b${escapeRegExp(normalizedName)}\\b`);
    if (pattern.test(normalizedText)) matches.push(beach);
  }
  return matches;
}

function toBeachDetail(beach: RecommendationBeach, posizione?: number): ShortlistBeachDetail {
  return {
    ...(posizione !== undefined ? { posizione } : {}),
    id: beach.id,
    nome: beach.nome,
    zona: beach.zona,
    localita: beach.localita ?? null,
    esposizione_cardinale: beach.esposizione_cardinale ?? null,
    esposizione_venti: beach.esposizione_venti ?? null,
    activity_tags: beach.activity_tags ?? [],
    puntiDiForza: Object.entries(beach.punteggi_categorie ?? {})
      .filter(([, score]) => score === 3)
      .map(([categoria]) => categoria),
    tipoFondale: beach.tipo_fondale,
    lunghezzaM: beach.lunghezza_m,
    indicazioni: beach.indicazioni,
    noteQualitative: beach.note_qualitative,
    difficoltaAccesso: beach.info_pratiche?.difficolta_accesso,
    raggiungibileViaTerra: beach.info_pratiche?.raggiungibile_via_terra,
    accessibilitaDisabili: beach.info_pratiche?.accessibilita_disabili ?? null,
    caniAmmessi: beach.info_pratiche?.cani_ammessi ?? null,
    affollamento: {
      livelloGenerale: beach.affollamento?.livello_generale,
      note: beach.affollamento?.note ?? null
    }
  };
}

// Deterministically estimate how many distinct beach picks a multi-day/multi-slot
// request needs, instead of asking the AI to compute and honor that count itself
// (unreliable). Returns null when no multi-day pattern is detected.
const ITALIAN_NUMBER_WORDS: Record<string, number> = {
  uno: 1,
  due: 2,
  tre: 3,
  quattro: 4,
  cinque: 5,
  sei: 6,
  sette: 7
};

interface ItineraryPlan {
  giorni: number;
  slotsPerDay: number;
  totalSlots: number;
}

function estimateItineraryPlan(text: string): ItineraryPlan | null {
  const lower = text.toLowerCase();
  const digitMatch = lower.match(/(\d+)\s*giorn/);
  let giorni: number | null = null;
  if (digitMatch) {
    giorni = parseInt(digitMatch[1], 10);
  } else {
    const wordMatch = lower.match(/\b(uno|due|tre|quattro|cinque|sei|sette)\s+giorn/);
    if (wordMatch) giorni = ITALIAN_NUMBER_WORDS[wordMatch[1]];
  }
  if (!giorni || !Number.isFinite(giorni) || giorni <= 0) return null;
  const hasMattina = /mattin/.test(lower);
  const hasPomeriggio = /pomerigg/.test(lower);
  const slotsPerDay = hasMattina && hasPomeriggio ? 2 : 1;
  return { giorni, slotsPerDay, totalSlots: giorni * slotsPerDay };
}

// Quando una giornata ha piu' di una spiaggia (mattina+pomeriggio), raggruppa le spiagge gia'
// scelte dall'AI in modo che quelle nella STESSA giornata condividano la stessa 'zona' quando
// possibile, minimizzando gli spostamenti nella giornata. Non cambia QUALI spiagge sono state
// scelte (resta una decisione dell'AI), solo come vengono suddivise nei blocchi da
// 'slotsPerDay'. Algoritmo greedy: raggruppa per zona, poi riempie ogni blocco pescando prima
// dal gruppo piu' numeroso rimasto; se un gruppo non basta a completare un blocco, lo
// completa con spiagge di altre zone (necessario comunque per garantire varieta' tra i
// giorni, dato che i gruppi di zona sono per forza limitati).
function groupShortlistByZonaForDayPlan(
  shortlist: AiRankingShortlistItem[],
  beachById: Map<string, RecommendationBeach>,
  slotsPerDay: number
): AiRankingShortlistItem[] {
  const zonaOf = (item: AiRankingShortlistItem) => beachById.get(item.spiaggia_id)?.zona ?? "zona_sconosciuta";

  const groups = new Map<string, AiRankingShortlistItem[]>();
  for (const item of shortlist) {
    const zona = zonaOf(item);
    if (!groups.has(zona)) groups.set(zona, []);
    groups.get(zona)!.push(item);
  }

  function takeFromLargestGroup(): AiRankingShortlistItem | null {
    let bestZona: string | null = null;
    let bestCount = 0;
    for (const [zona, items] of groups) {
      if (items.length > bestCount) {
        bestCount = items.length;
        bestZona = zona;
      }
    }
    if (bestZona === null) return null;
    const bucket = groups.get(bestZona)!;
    const item = bucket.shift()!;
    if (bucket.length === 0) groups.delete(bestZona);
    return item;
  }

  const result: AiRankingShortlistItem[] = [];
  const totalChunks = Math.ceil(shortlist.length / slotsPerDay);
  for (let chunk = 0; chunk < totalChunks; chunk++) {
    for (let slot = 0; slot < slotsPerDay; slot++) {
      const item = takeFromLargestGroup();
      if (!item) break; // shortlist esaurito, niente altro da assegnare
      result.push(item);
    }
  }
  return result;
}

// Quando la richiesta di oggi nomina esplicitamente una di queste categorie (es. "le piu'
// belle" o "la migliore per lo snorkeling"), quella categoria diventa il criterio "ancorato"
// per questa richiesta: usata sia per garantire che le spiagge davvero top su quel tratto
// arrivino sempre all'AI di ranking (vedi pre-scoring.ts), sia per dire all'AI di trattarla
// come criterio primario invece di farsi guidare dagli interessi generali del profilo.
const CATEGORY_REQUEST_PATTERNS: Array<{ pattern: RegExp; category: keyof CategoryScores }> = [
  { pattern: /pi[uù]\s+bell|spettacolar|iconic|pi[uù]\s+famos|pi[uù]\s+caratteristic|da non perdere|must[\s-]?see/i, category: "belle_spettacolari" },
  // "immersion(e/i)" da sola e' ambigua in italiano (es. "un'immersione nella natura/cultura/
  // relax" e' un uso metaforico comune, non c'entra con lo snorkeling): la neghiamo quando e'
  // seguita da "nella/nel/in" + un sostantivo che indica chiaramente un uso figurato.
  { pattern: /snorkel|subacque|immersion\w*\b(?!\s+(nella|nel|in)\s+(natura|cultura|relax|atmosfera|silenzio|pace|storia))/i, category: "snorkeling_immersione" },
  { pattern: /windsurf|kite\s?surf|\bsup\b|canoa|sport\s+acquatic/i, category: "sport_acquatici" },
  { pattern: /natura\s+selvaggia|incontaminat|selvaggi|wild/i, category: "natura_selvaggia" },
  { pattern: /relax|tranquill|rilassant/i, category: "rilassante_tranquilla" },
  { pattern: /borgo|cultural|storic/i, category: "culturale_caratteristica" },
  { pattern: /comfort|servizi|lettini|chiosco|stabiliment/i, category: "comfort_servizi" }
];

function detectAnchoredCategories(text: string): Array<keyof CategoryScores> {
  const found = CATEGORY_REQUEST_PATTERNS.filter(({ pattern }) => pattern.test(text)).map(({ category }) => category);
  return Array.from(new Set(found));
}

export interface RecommendationsRequestBody {
  profile: RecommendationUserProfile;
  richiesta_giorno: string;
  /** Massimo affollamento tollerato per la richiesta di oggi (soglia secca, non piu' una preferenza continua). */
  affollamento_massimo?: MassimoAffollamentoTollerato;
  limit?: number;
}

export interface RecommendationsResponseBody {
  recommendations: Array<{
    spiaggia_id: string;
    nome: string;
    attivita: string;
    rank_score: number;
    motivazioni: string[];
  }>;
  final_response: string;
  interpretation: {
    zona_ammessa: string[];
    intensita_reale: "low" | "medium" | "high";
    tolleranza_cammino_minuti: number;
    vincoli_forti: string[];
    vincoli_morbidi: string[];
    tipo_esperienza_target: string;
  };
  excluded: Array<{
    beachId: string;
    beachName: string;
    reasons: string[];
  }>;
  meta: {
    total_catalog: number;
    total_excluded: number;
    total_recommended: number;
  };
}

const DATASET_PATH = path.resolve(process.cwd(), "data/processed/spiagge.normalized.json");
const ALLOWED_MOBILITY_LEVELS = new Set(["alta", "media", "bassa"]);
const ALLOWED_FOLLA_VALUES = new Set(["evita", "indifferente", "cerca_movida"]);
const ALLOWED_LANGUAGES = new Set(["it", "en", "de", "fr", "nl"]);
const ALLOWED_MEZZO_TRASPORTO = new Set(["auto", "scooter", "bus", "barca", "a_piedi"]);
const ALLOWED_GRUPPO = new Set(["solo", "coppia", "famiglia", "amici"]);
const ALLOWED_AFFOLLAMENTO_MASSIMO = new Set(["basso", "medio", "alto"]);

function readNormalizedBeaches(): RecommendationBeach[] {
  const raw = fs.readFileSync(DATASET_PATH, "utf8");
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed?.spiagge) ? parsed.spiagge : [];
}

function toNumberOrFallback(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function validateRequestBody(body: unknown): {
  valid: boolean;
  errors: string[];
  normalized?: RecommendationsRequestBody;
} {
  const errors: string[] = [];
  if (!body || typeof body !== "object") {
    return { valid: false, errors: ["Body must be a JSON object."] };
  }

  const bodyObj = body as Record<string, unknown>;
  const profile = bodyObj.profile as Record<string, unknown> | undefined;
  if (!profile || typeof profile !== "object") {
    return { valid: false, errors: ["Field 'profile' is required."] };
  }
  const richiestaGiorno = bodyObj.richiesta_giorno;
  if (typeof richiestaGiorno !== "string" || richiestaGiorno.trim().length < 3) {
    errors.push("Field 'richiesta_giorno' is required and must be at least 3 characters.");
  }

  if (!ALLOWED_LANGUAGES.has(String(profile.lingua ?? ""))) {
    errors.push("Field 'profile.lingua' must be one of: it, en, de, fr, nl.");
  }

  const mobilitaLivello = profile.mobilita_livello;
  if (!ALLOWED_MOBILITY_LEVELS.has(String(mobilitaLivello ?? ""))) {
    errors.push("Field 'profile.mobilita_livello' must be one of: alta, media, bassa.");
  }

  if (profile.folla !== undefined && !ALLOWED_FOLLA_VALUES.has(String(profile.folla))) {
    errors.push("Field 'profile.folla' must be one of: evita, indifferente, cerca_movida.");
  }

  if (profile.attivita_preferite !== undefined && !Array.isArray(profile.attivita_preferite)) {
    errors.push("Field 'profile.attivita_preferite' must be an array of strings.");
  }

  if (profile.mezzo_trasporto !== undefined && !ALLOWED_MEZZO_TRASPORTO.has(String(profile.mezzo_trasporto))) {
    errors.push("Field 'profile.mezzo_trasporto' must be one of: auto, scooter, bus, barca, a_piedi.");
  }

  if (profile.gruppo !== undefined && !ALLOWED_GRUPPO.has(String(profile.gruppo))) {
    errors.push("Field 'profile.gruppo' must be one of: solo, coppia, famiglia, amici.");
  }

  if (bodyObj.affollamento_massimo !== undefined && !ALLOWED_AFFOLLAMENTO_MASSIMO.has(String(bodyObj.affollamento_massimo))) {
    errors.push("Field 'affollamento_massimo' must be one of: basso, medio, alto.");
  }

  const limit = toNumberOrFallback(bodyObj.limit, 5);
  if (!Number.isFinite(limit) || limit <= 0 || limit > 20) {
    errors.push("Field 'limit' must be a number between 1 and 20.");
  }

  if (errors.length > 0) return { valid: false, errors };

  const normalized: RecommendationsRequestBody = {
    profile: {
      lingua: String(profile.lingua) as "it" | "en" | "de" | "fr" | "nl",
      mobilita_livello: String(mobilitaLivello) as "alta" | "media" | "bassa",
      mobilita_ridotta: Boolean(profile.mobilita_ridotta),
      richiesta_esplicita_naturismo: profile.richiesta_esplicita_naturismo === true,
      folla: profile.folla as "evita" | "indifferente" | "cerca_movida" | undefined,
      mezzo_trasporto: profile.mezzo_trasporto as
        | "auto"
        | "scooter"
        | "bus"
        | "barca"
        | "a_piedi"
        | undefined,
      attivita_preferite: Array.isArray(profile.attivita_preferite)
        ? profile.attivita_preferite.map((x) => String(x))
        : [],
      gruppo: profile.gruppo as "solo" | "coppia" | "famiglia" | "amici" | undefined,
      con_bambini: profile.con_bambini === true
    },
    richiesta_giorno: String(richiestaGiorno ?? ""),
    affollamento_massimo: bodyObj.affollamento_massimo as MassimoAffollamentoTollerato | undefined,
    limit
  };

  return { valid: true, errors: [], normalized };
}

export async function buildRecommendationsResponse(body: unknown): Promise<{
  statusCode: number;
  payload: RecommendationsResponseBody | { error: string; details?: string[] };
}> {
  const validation = validateRequestBody(body);
  if (!validation.valid || !validation.normalized) {
    return {
      statusCode: 400,
      payload: { error: "Invalid request payload", details: validation.errors }
    };
  }

  let beaches: RecommendationBeach[];
  try {
    beaches = readNormalizedBeaches();
  } catch (_error) {
    return {
      statusCode: 500,
      payload: { error: "Normalized dataset not found. Run normalization script first." }
    };
  }

  try {
    const interpretation = await interpretUserRequest({
      profile: validation.normalized.profile,
      richiestaDelGiorno: validation.normalized.richiesta_giorno
    });

    const exclusion = applyHardExclusions(beaches, validation.normalized.profile);
    const requestedLimit = validation.normalized.limit ?? 5;
    const itineraryPlan = estimateItineraryPlan(validation.normalized.richiesta_giorno);
    const estimatedSlots = itineraryPlan?.totalSlots ?? null;
    const effectiveLimit =
      estimatedSlots !== null
        ? Math.min(Math.max(estimatedSlots, requestedLimit), 20, exclusion.included.length)
        : requestedLimit;

    // Scrematura deterministica: calcoliamo un punteggio reale (affollamento + i punteggi
    // 0-3 per categoria curati a mano da Mirco) su tutte le spiagge incluse, e diamo all'AI
    // di ranking solo le migliori, invece di farle giudicare 100+ spiagge in un colpo solo.
    const preFilterCount = Math.min(exclusion.included.length, Math.max(20, effectiveLimit + 10));
    const anchoredCategories = detectAnchoredCategories(validation.normalized.richiesta_giorno);
    const windDirection = detectWindDirection(validation.normalized.richiesta_giorno);
    // Il filtro naturismo legge SOLO il profilo (impostato una volta in onboarding), mai il
    // testo libero di oggi — altrimenti basterebbe scriverlo per aggirare una preferenza gia'
    // impostata. Se pero' la richiesta di oggi lo nomina comunque mentre il profilo lo esclude,
    // e' un conflitto da segnalare con trasparenza invece di lasciare che l'AI se la cavi da
    // sola (vedi buildNaturismConflictNote in conversation-layer).
    const naturismConflict =
      /naturis/i.test(validation.normalized.richiesta_giorno) &&
      validation.normalized.profile.richiesta_esplicita_naturismo !== true;
    const preScoreResult = preScoreAndFilter(exclusion.included, validation.normalized.profile, preFilterCount, {
      extraWantedCategories: anchoredCategories,
      affollamentoMassimo: validation.normalized.affollamento_massimo,
      windDirection
    });
    const preFiltered = preScoreResult.beaches;

    const beachById = new Map(beaches.map((beach) => [beach.id, beach]));

    // Spiagge nominate esplicitamente nel testo libero di oggi (es. "voglio andare alla
    // Biodola") che risultano escluse — hard exclusion (naturismo/barca/sentiero) o soglia soft
    // di affollamento/vento. Se una di queste conflitto viene rilevata, il layer di conversazione
    // risponde comunque alla domanda diretta con una descrizione reale, invece di ignorarla o
    // improvvisare un aggiramento (vedi commento in conversation-layer/index.ts).
    const namedMentions = detectNamedBeachMentions(validation.normalized.richiesta_giorno, beaches);
    const hardExcludedReasonsById = new Map(exclusion.excluded.map((entry) => [entry.beach.id, entry.reasons]));
    const crowdingExcludedIds = new Set(preScoreResult.crowdingExcludedAll.map((beach) => beach.id));
    const windExcludedIds = new Set(preScoreResult.windExcludedAll.map((beach) => beach.id));
    const namedBeachExclusionEntries: NamedBeachExclusionEntry[] = [];
    const seenNamedBeachIds = new Set<string>();
    for (const beach of namedMentions) {
      if (seenNamedBeachIds.has(beach.id)) continue;
      const reasonCodes: string[] = [
        ...(hardExcludedReasonsById.get(beach.id) ?? []),
        ...(crowdingExcludedIds.has(beach.id) ? ["CROWDING_LIMIT"] : []),
        ...(windExcludedIds.has(beach.id) ? ["WIND_LIMIT"] : [])
      ];
      if (reasonCodes.length === 0) continue; // non esclusa: nessuna trasparenza da aggiungere
      seenNamedBeachIds.add(beach.id);
      namedBeachExclusionEntries.push({ detail: toBeachDetail(beach), reasonCodes });
    }

    // Se la richiesta di oggi entra in conflitto con una preferenza gia' impostata (spiaggia
    // nominata esclusa, o naturismo chiesto ma escluso), rispondiamo SOLO a quel conflitto
    // (promemoria del motivo + descrizione, poi l'offerta di cercare alternative) e saltiamo
    // del tutto la chiamata AI di ranking/raccomandazione: piu' economico ed evita che l'AI
    // riproponga di sua iniziativa un'intera giornata di spiagge non richieste (osservato in un
    // test live: chiedere "cosa sai della Biodola" restituiva comunque 3 alternative complete
    // prima ancora di rispondere alla domanda diretta).
    const hasPreferenceConflict = namedBeachExclusionEntries.length > 0 || naturismConflict;

    let orderedShortlist: AiRankingShortlistItem[] = [];
    let finalResponse: string;

    if (hasPreferenceConflict) {
      finalResponse = await generateConflictOnlyResponse({
        lingua: validation.normalized.profile.lingua,
        namedBeachExclusions: namedBeachExclusionEntries,
        naturismPreferenceConflict: naturismConflict
      });
    } else {
      const ranked = await rankCandidateBeachesWithAi({
        profile: validation.normalized.profile,
        interpretation,
        richiestaDelGiorno: validation.normalized.richiesta_giorno,
        candidates: preFiltered,
        limit: effectiveLimit,
        requiredCount: estimatedSlots !== null ? Math.min(estimatedSlots, preFiltered.length) : null,
        anchoredCategories,
        preScoreById: preScoreResult.preScoreById
      });

      // Quando un giorno ha piu' di una spiaggia (mattina+pomeriggio), raggruppare le spiagge
      // scelte per giornata in base alla zona minimizza gli spostamenti nella stessa giornata —
      // Mirco aveva gia' affrontato in passato il problema opposto (spiagge troppo vicine/
      // confinanti nello stesso giorno), da cui la numerazione progressiva per localita' nel
      // dataset. L'AI resta libera di scegliere QUALI spiagge includere (lo fa gia' bene, es.
      // preferendo spiagge davvero forti sulla categoria richiesta a spiagge solo genericamente
      // valide), ma non l'assegnazione mattina/pomeriggio: un test live ha mostrato coppie come
      // ovest+nord e ovest+est nello stesso giorno, quando raggruppare per zona (ovest+ovest un
      // giorno, nord+est l'altro) avrebbe richiesto molti meno spostamenti. Applicato solo se
      // c'e' piu' di una spiaggia per giorno (altrimenti non c'e' uno "spostamento nella
      // giornata" da minimizzare).
      orderedShortlist =
        itineraryPlan && itineraryPlan.slotsPerDay > 1
          ? groupShortlistByZonaForDayPlan(ranked.shortlist, beachById, itineraryPlan.slotsPerDay)
          : ranked.shortlist;

      const shortlistBeachDetails = orderedShortlist
        .map((item) => beachById.get(item.spiaggia_id))
        .filter((beach): beach is RecommendationBeach => Boolean(beach))
        .map((beach, index) => toBeachDetail(beach, index + 1));

      finalResponse = await generateFinalResponse({
        lingua: validation.normalized.profile.lingua,
        profile: validation.normalized.profile,
        richiestaDelGiorno: validation.normalized.richiesta_giorno,
        interpretation,
        itineraryPlan,
        shortlist: orderedShortlist,
        shortlistBeachDetails,
        beachesExcludedByCrowdingLimit: preScoreResult.excludedByCrowdingTopMatches.map((beach) => beach.nome),
        beachesExcludedByWind: preScoreResult.excludedByWindTopMatches.map((beach) => beach.nome)
      });
    }

    const nomeById = new Map(beaches.map((beach) => [beach.id, beach.nome]));
    const recommendationsWithNome = orderedShortlist.map((item) => ({
      ...item,
      nome: nomeById.get(item.spiaggia_id) ?? item.spiaggia_id
    }));

    return {
      statusCode: 200,
      payload: {
        recommendations: recommendationsWithNome,
        final_response: finalResponse,
        interpretation,
        excluded: exclusion.excluded.map((entry) => ({
          beachId: entry.beach.id,
          beachName: entry.beach.nome,
          reasons: entry.reasons
        })),
        meta: {
          total_catalog: beaches.length,
          total_excluded: exclusion.excluded.length,
          total_recommended: orderedShortlist.length
        }
      }
    };
  } catch (error) {
    return {
      statusCode: 502,
      payload: {
        error: "AI layer failed",
        details: [error instanceof Error ? error.message : "Unknown AI error"]
      }
    };
  }
}
