import { type CategoryScores, type CrowdingLevel, type RecommendationBeach, type RecommendationUserProfile } from "./index";
import type { CardinalDirection } from "./wind";

/**
 * Scrematura deterministica (nessuna AI coinvolta): calcola un punteggio reale
 * per ogni spiaggia candidata usando i punteggi 0-3 per categoria curati a mano
 * da Mirco, applica un filtro secco sulla soglia di affollamento tollerata, e
 * restituisce solo le migliori "topN" da passare all'AI di ranking. Questo evita
 * di far giudicare all'AI 100+ spiagge in un colpo solo, e ancora il punteggio a
 * un calcolo verificabile invece che a un numero inventato dal modello.
 */

const MAX_CATEGORY_SCORE = 3;

// Le 7 categorie "esperienziali" pesate nella formula finale. Bellezza/spettacolarita' ha un
// tetto piu' alto delle altre 6 SOLO quando e' lei la categoria richiesta oggi (es. "le piu'
// belle") — non e' piu' un peso fisso sempre applicato. Prima lo era (40% costante, "nessuno
// vuole una spiaggia brutta"), ma questo penalizzava richieste che di bellezza non parlavano
// affatto (es. "atmosfera da borgo": Forno, con la nota piu' calzante per quella richiesta,
// perdeva comunque contro spiagge con bellezza piu' alta ma nota meno pertinente).
//
// La bellezza pero' resta un caso a parte rispetto alle altre 6: anche quando NON e' la
// categoria richiesta, Mirco vuole che continui a pesare piu' delle categorie davvero non
// richieste (che scendono a un quarto, 2.5%) — perche' e' comunque un criterio a cui tiene
// quasi sempre (verificato: senza questo, in una richiesta sullo snorkeling con piu' spiagge
// pari a 3/3, vinceva la piu' "generalista" invece della piu' bella, es. Cala Seregola invece
// di Sansone). Per questo la bellezza ha un tetto dedicato "non ancorata" (20%), diverso da
// quello delle altre 6 categorie non richieste (2.5%).
const ACTIVITY_CATEGORIES: Array<keyof CategoryScores> = [
  "snorkeling_immersione",
  "sport_acquatici",
  "natura_selvaggia",
  "rilassante_tranquilla",
  "culturale_caratteristica",
  "comfort_servizi",
  "belle_spettacolari"
];
const BEAUTY_CATEGORY: keyof CategoryScores = "belle_spettacolari";
// Tetto di peso per le altre 6 categorie: pieno solo se l'utente ha indicato interesse per
// quella categoria (profilo o richiesta di oggi); un quarto altrimenti. Cosi' una spiaggia
// forte in una categoria che all'utente non interessa non gonfia piu' il punteggio generico
// quanto una che gli interessa davvero (bug segnalato da Mirco: Cala Seregola con profilo
// "solo relax" risultava comunque avvantaggiata da punteggi alti in snorkeling/natura).
const BEAUTY_WEIGHT_WHEN_ANCHORED = 0.4;
const BEAUTY_WEIGHT_BASELINE = 0.2;
const INTERESTED_CATEGORY_WEIGHT = 0.1;
const UNINTERESTED_CATEGORY_WEIGHT = INTERESTED_CATEGORY_WEIGHT / 4;

// Le opzioni di "attivita' preferite" nell'onboarding (OnboardingClient.tsx) usano ORA
// direttamente le stesse chiavi di CategoryScores (snorkeling_immersione, sport_acquatici,
// natura_selvaggia, rilassante_tranquilla, culturale_caratteristica, comfort_servizi) — non
// serve piu' una tabella di traduzione tra un vocabolario "utente" e le categorie: l'utente
// dichiara esattamente quale categoria gli interessa, senza che l'AI debba interpretare
// un'etichetta generica (es. "relax" che veniva confuso con "evitare la folla", cosa mai
// dichiarata dall'utente). Qui validiamo solo che il valore ricevuto sia una delle 6 categorie
// "attivita'" riconosciute, ignorando eventuali valori residui/non validi (es. da profili
// salvati prima di questa modifica).
const VALID_ACTIVITY_CATEGORIES = new Set<keyof CategoryScores>([
  "snorkeling_immersione",
  "sport_acquatici",
  "natura_selvaggia",
  "rilassante_tranquilla",
  "culturale_caratteristica",
  "comfort_servizi"
]);

// Livelli di affollamento in ordine crescente, usati per il filtro a soglia.
const CROWDING_ORDER: CrowdingLevel[] = ["molto basso", "basso", "basso-medio", "medio", "medio-alto", "alto", "molto alto"];

export type MassimoAffollamentoTollerato = "basso" | "medio" | "alto";

// Soglia massima di affollamento tollerata dall'utente per la richiesta di oggi: "basso"
// esclude tutto sopra "basso-medio", "medio" esclude "alto"/"molto alto", "alto" non esclude
// nulla (tollera anche "molto alto"). E' un filtro secco, non una preferenza che si media con
// il resto del punteggio: se l'utente ha scelto "medio", una spiaggia "alto" non compare mai,
// per quanto sia perfetta su tutto il resto.
const TOLERANCE_CEILING: Record<MassimoAffollamentoTollerato, CrowdingLevel | null> = {
  basso: "basso-medio",
  medio: "medio-alto",
  alto: null
};

function passesCrowdingTolerance(beachCrowding: CrowdingLevel, tolerance?: MassimoAffollamentoTollerato): boolean {
  if (!tolerance) return true; // nessuna soglia indicata: non filtriamo
  const ceiling = TOLERANCE_CEILING[tolerance];
  if (ceiling === null) return true;
  return CROWDING_ORDER.indexOf(beachCrowding) <= CROWDING_ORDER.indexOf(ceiling);
}

// Filtro secco sul vento: se la richiesta di oggi nomina una direzione di vento specifica
// (vedi wind.ts), escludiamo le spiagge la cui esposizione_venti_esposta_a include quella
// direzione — non e' una spiaggia da consigliare in quelle condizioni (dato geometrico +
// rifinito dal testo, non un'interpretazione dell'AI). Nessun filtro se la richiesta non
// nomina un vento riconoscibile.
function passesWindExposure(beach: RecommendationBeach, windDirection: CardinalDirection | null): boolean {
  if (!windDirection) return true;
  const exposedTo = beach.esposizione_venti_esposta_a ?? [];
  return !exposedTo.includes(windDirection);
}

// Categorie derivate dalle attivita' scelte esplicitamente (+ segnali come "belle_spettacolari"
// o "snorkeling_immersione" da una richiesta specifica di oggi) vs categoria di contesto del
// gruppo (coppia/famiglia/amici), usata solo come filtro preliminare qui sotto. Mirco ci ha
// spiegato che "adatto_coppie" e' intenzionalmente quasi universale (133/142 spiagge a 3/3): le
// coppie non hanno vincoli forti, sono le altre scelte a differenziare. Per questo la categoria
// di contesto non entra mai nella formula pesata (diluirebbe le altre categorie), ma serve solo
// a escludere le spiagge davvero non adatte (punteggio 0) come "primo filtro sulla categoria di
// utente" richiesto da Mirco.
function activityWantedCategories(profile: RecommendationUserProfile, extraWanted: Array<keyof CategoryScores>): Array<keyof CategoryScores> {
  if (extraWanted.length > 0) return Array.from(new Set(extraWanted));

  const wanted = new Set<keyof CategoryScores>();
  for (const activity of profile.attivita_preferite ?? []) {
    if (VALID_ACTIVITY_CATEGORIES.has(activity as keyof CategoryScores)) {
      wanted.add(activity as keyof CategoryScores);
    }
  }
  return Array.from(wanted);
}

function contextCategory(profile: RecommendationUserProfile): keyof CategoryScores | null {
  if (profile.con_bambini || profile.gruppo === "famiglia") return "adatto_famiglie";
  if (profile.gruppo === "coppia") return "adatto_coppie";
  if (profile.gruppo === "amici") return "giovani_ragazzi";
  return null;
}

// Formula: un peso su ciascuna delle 7 categorie esperienziali, proporzionale al relativo
// punteggio 0-3. Il tetto di quel peso dipende dall'interesse dichiarato dall'utente per quella
// specifica categoria (profilo o richiesta di oggi, stesso insieme usato per la garanzia
// isTopMatch): per bellezza, 40% se ancorata dalla richiesta di oggi altrimenti 20% (resta un
// criterio a cui si tiene comunque un po', anche senza chiederlo esplicitamente); per le altre
// 6, 10% se interessa altrimenti 2,5%. Cosi' una spiaggia forte in una categoria irrilevante
// per l'utente non gonfia il punteggio generico quanto una forte in una categoria che gli
// interessa davvero, ma la bellezza mantiene comunque un peso minimo maggiore delle altre.
function weightedCategoryAffinity(punteggi: CategoryScores | undefined, activityWanted: Array<keyof CategoryScores>): number {
  const wantedSet = new Set(activityWanted);
  return ACTIVITY_CATEGORIES.reduce((acc, cat) => {
    const isWanted = wantedSet.has(cat);
    const ceiling = cat === BEAUTY_CATEGORY ? (isWanted ? BEAUTY_WEIGHT_WHEN_ANCHORED : BEAUTY_WEIGHT_BASELINE) : isWanted ? INTERESTED_CATEGORY_WEIGHT : UNINTERESTED_CATEGORY_WEIGHT;
    const normalizedScore = (punteggi?.[cat] ?? 0) / MAX_CATEGORY_SCORE;
    return acc + ceiling * normalizedScore;
  }, 0);
}

export interface PreScoredBeach {
  beach: RecommendationBeach;
  preScore: number;
  isTopMatch: boolean;
}

export interface PreScoreOptions {
  /** Categorie a cui la richiesta di oggi e' esplicitamente ancorata (es. belle_spettacolari per "le piu' belle", snorkeling_immersione per "la migliore per snorkeling"). Usate sia per la garanzia di inclusione sia per decidere quali delle 6 categorie esperienziali pesano 10% (interesse indicato) invece di 2.5% (non indicato) nella formula. */
  extraWantedCategories?: Array<keyof CategoryScores>;
  /** Soglia massima di affollamento tollerata per la richiesta di oggi. */
  affollamentoMassimo?: MassimoAffollamentoTollerato;
  /** Direzione del vento nominata nella richiesta di oggi (vedi wind.ts), se presente. */
  windDirection?: CardinalDirection | null;
}

export interface PreScoreResult {
  beaches: RecommendationBeach[];
  /** Spiagge escluse perche' oltre la soglia di affollamento tollerata, pur avendo punteggio massimo (3/3) sulla/e categoria/e richiesta/e oggi — usato per avvisare l'utente in modo trasparente che la sua soglia ha scartato delle spiagge top. */
  excludedByCrowdingTopMatches: RecommendationBeach[];
  /** Spiagge escluse perche' esposte al vento nominato nella richiesta di oggi, pur avendo punteggio massimo (3/3) sulla/e categoria/e richiesta/e oggi — stesso scopo di trasparenza del caso affollamento. */
  excludedByWindTopMatches: RecommendationBeach[];
  /** TUTTE le spiagge escluse per soglia di affollamento (non solo le "top match" su una categoria) — usato per rispondere con trasparenza quando l'utente nomina esplicitamente una spiaggia esclusa da questo filtro, indipendentemente dal suo punteggio di categoria. */
  crowdingExcludedAll: RecommendationBeach[];
  /** TUTTE le spiagge escluse per esposizione al vento nominato oggi (non solo le "top match") — stesso scopo di crowdingExcludedAll. */
  windExcludedAll: RecommendationBeach[];
  /** Punteggio deterministico calcolato per ciascuna spiaggia (0-1 circa), indicizzato per id. Passato all'AI-ranking layer come base di partenza gia' corretta, cosi' non deve reinterpretare da zero le preferenze gia' catturate in onboarding (vedi ai-ranking.ts). */
  preScoreById: Record<string, number>;
}

export function preScoreAndFilter(
  candidates: RecommendationBeach[],
  profile: RecommendationUserProfile,
  topN: number,
  options: PreScoreOptions = {}
): PreScoreResult {
  const activityWanted = activityWantedCategories(profile, options.extraWantedCategories ?? []);
  const ctxCategory = contextCategory(profile);

  // Primo filtro: se la richiesta ha un contesto di gruppo riconosciuto e la spiaggia ha
  // punteggio 0 (non si applica affatto) su quella categoria, la escludiamo del tutto. Rete di
  // sicurezza: se questo filtro svuotasse la lista (non dovrebbe mai capitare con i dati attuali)
  // lo ignoriamo piuttosto che restituire zero risultati.
  const contextFiltered = ctxCategory ? candidates.filter((beach) => (beach.punteggi_categorie?.[ctxCategory] ?? 1) > 0) : candidates;
  const afterContext = contextFiltered.length > 0 ? contextFiltered : candidates;

  // Secondo filtro: soglia massima di affollamento tollerata (hard filter, non piu' un peso
  // continuo). Teniamo traccia di cosa viene escluso e se tra questi c'erano spiagge "top match"
  // sulla categoria richiesta oggi, per poter avvisare l'utente.
  const tolerance = options.affollamentoMassimo;
  const crowdingPassed: RecommendationBeach[] = [];
  const crowdingExcluded: RecommendationBeach[] = [];
  for (const beach of afterContext) {
    const crowding = beach.affollamento?.livello_generale ?? "medio";
    if (passesCrowdingTolerance(crowding, tolerance)) {
      crowdingPassed.push(beach);
    } else {
      crowdingExcluded.push(beach);
    }
  }
  // Rete di sicurezza: se la soglia scelta escludesse TUTTE le candidate, la ignoriamo piuttosto
  // che restituire zero risultati (meglio mostrare qualcosa che un errore).
  const afterCrowding = crowdingPassed.length > 0 ? crowdingPassed : afterContext;
  const excludedByCrowdingTopMatches =
    crowdingPassed.length > 0
      ? crowdingExcluded.filter((beach) => activityWanted.some((cat) => (beach.punteggi_categorie?.[cat] ?? 0) >= MAX_CATEGORY_SCORE))
      : [];

  // Terzo filtro: esposizione al vento nominato nella richiesta di oggi (hard filter
  // deterministico, stesso schema dell'affollamento). Una spiaggia esposta al vento del giorno
  // non e' una spiaggia da consigliare, indipendentemente da quanto sia forte sulle altre
  // categorie. Rete di sicurezza identica: se escludesse tutto, la ignoriamo.
  const windDirection = options.windDirection ?? null;
  const windPassed: RecommendationBeach[] = [];
  const windExcluded: RecommendationBeach[] = [];
  for (const beach of afterCrowding) {
    if (passesWindExposure(beach, windDirection)) {
      windPassed.push(beach);
    } else {
      windExcluded.push(beach);
    }
  }
  const afterWind = windPassed.length > 0 ? windPassed : afterCrowding;
  const excludedByWindTopMatches =
    windPassed.length > 0
      ? windExcluded.filter((beach) => activityWanted.some((cat) => (beach.punteggi_categorie?.[cat] ?? 0) >= MAX_CATEGORY_SCORE))
      : [];

  const scored: PreScoredBeach[] = afterWind.map((beach) => {
    const preScore = weightedCategoryAffinity(beach.punteggi_categorie, activityWanted);
    // Garanzia basata solo sulle categorie "attivita'" (selettive, richieste oggi o dal
    // profilo), non su quella di contesto (coppia/famiglia/amici). Nessun tetto arbitrario:
    // tutte le spiagge davvero top per l'attivita' richiesta arrivano all'AI, entro topN.
    const isTopMatch = activityWanted.some((cat) => (beach.punteggi_categorie?.[cat] ?? 0) >= MAX_CATEGORY_SCORE);
    return { beach, preScore, isTopMatch };
  });

  scored.sort((a, b) => b.preScore - a.preScore);

  const guaranteed = scored.filter((s) => s.isTopMatch).slice(0, topN);
  const guaranteedIds = new Set(guaranteed.map((s) => s.beach.id));
  const rest = scored.filter((s) => !guaranteedIds.has(s.beach.id));

  const combined = [...guaranteed, ...rest].slice(0, topN);
  combined.sort((a, b) => b.preScore - a.preScore);

  const preScoreById: Record<string, number> = {};
  for (const s of combined) preScoreById[s.beach.id] = s.preScore;

  return {
    beaches: combined.map((s) => s.beach),
    excludedByCrowdingTopMatches,
    excludedByWindTopMatches,
    crowdingExcludedAll: crowdingExcluded,
    windExcludedAll: windExcluded,
    preScoreById
  };
}
