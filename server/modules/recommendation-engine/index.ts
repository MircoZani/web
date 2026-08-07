import { applyHardExclusions, type ExclusionBeach, type ExclusionUserProfile } from "../exclusion-layer";

export type CrowdingLevel = "molto basso" | "basso" | "basso-medio" | "medio" | "medio-alto" | "alto" | "molto alto";

export interface RecommendationUserProfile extends ExclusionUserProfile {
  lingua: "it" | "en" | "de" | "fr" | "nl";
  folla?: "evita" | "indifferente" | "cerca_movida";
  attivita_preferite?: string[];
  gruppo?: "solo" | "coppia" | "famiglia" | "amici";
  con_bambini?: boolean;
}

/** Punteggio 0-3 curato a mano per categoria: 0=non si applica, 1=sotto la norma, 2=nella norma, 3=tra le migliori dell'isola. */
export interface CategoryScores {
  adatto_famiglie?: number;
  adatto_coppie?: number;
  giovani_ragazzi?: number;
  snorkeling_immersione?: number;
  sport_acquatici?: number;
  natura_selvaggia?: number;
  rilassante_tranquilla?: number;
  culturale_caratteristica?: number;
  comfort_servizi?: number;
  belle_spettacolari?: number;
}

export interface RecommendationBeach extends ExclusionBeach {
  zona?: string;
  /** Localita' specifica (es. "Sant'Andrea"): due spiagge nella stessa zona possono comunque essere vicinissime tra loro se condividono questo campo. */
  localita?: string | null;
  comune?: string;
  esposizione_cardinale?: string | null;
  esposizione_venti?: string | null;
  /** Direzioni cardinali (n/ne/e/se/s/so/o/no) a cui la spiaggia e' effettivamente esposta al vento/mare — derivate dall'orientamento geometrico e rifinite dal testo esposizione_venti (vedi scripts/normalize-dataset.mjs). Se la richiesta di oggi nomina un vento da una di queste direzioni, la spiaggia va esclusa: non e' una spiaggia da consigliare in quelle condizioni. */
  esposizione_venti_esposta_a?: string[];
  activity_tags?: string[];
  punteggi_categorie?: CategoryScores;
  affollamento?: { livello_generale?: CrowdingLevel; note?: string | null };
  tipo_fondale?: string;
  lunghezza_m?: number;
  /** Indicazioni stradali/di parcheggio reali per raggiungere la spiaggia — da usare per i consigli pratici invece di inventarli. */
  indicazioni?: string;
  /** Descrizione narrativa scritta a mano, utile per evidenziare l'unicita' della spiaggia senza inventare dettagli. */
  note_qualitative?: string;
  info_pratiche: ExclusionBeach["info_pratiche"] & {
    difficolta_accesso?: number;
    raggiungibile_via_terra?: boolean;
    accessibilita_disabili?: string | null;
    cani_ammessi?: string | boolean | null;
  };
}

export interface RecommendationInput {
  beaches: RecommendationBeach[];
  profile: RecommendationUserProfile;
  limit?: number;
}

export interface RecommendationItem {
  spiaggia_id: string;
  spiaggia_nome: string;
  attivita: string;
  score: number;
  motivazioni: string[];
}

export const CROWDING_SCORE: Record<CrowdingLevel, number> = {
  "molto basso": 1,
  basso: 0.85,
  "basso-medio": 0.7,
  medio: 0.55,
  "medio-alto": 0.35,
  alto: 0.15,
  "molto alto": 0
};

function fallbackActivity(tags: string[] = []): string {
  if (tags.includes("snorkeling")) return "snorkeling";
  if (tags.includes("diving")) return "diving";
  if (tags.includes("family")) return "family_time";
  if (tags.includes("windsurf")) return "sport_acquatici";
  if (tags.includes("relax")) return "relax";
  return "passeggiata_costiera";
}

function selectActivity(profilePreferences: string[] = [], beachTags: string[] = []): string {
  const normalizedPrefs = profilePreferences.map((x) => x.toLowerCase());
  for (const pref of normalizedPrefs) {
    if (beachTags.includes(pref)) return pref;
    if (pref === "sport_acquatici" && (beachTags.includes("windsurf") || beachTags.includes("diving"))) {
      return "sport_acquatici";
    }
  }
  return fallbackActivity(beachTags);
}

function crowdingScore(profileCrowding: RecommendationUserProfile["folla"], beachCrowding: CrowdingLevel): number {
  if (profileCrowding === "indifferente" || !profileCrowding) return 0.6;
  if (profileCrowding === "evita") return CROWDING_SCORE[beachCrowding] ?? 0.5;
  if (profileCrowding === "cerca_movida") return 1 - (CROWDING_SCORE[beachCrowding] ?? 0.5);
  return 0.5;
}

function activityAffinity(preferred: string[] = [], tags: string[] = []): number {
  if (preferred.length === 0) return 0.5;
  const normalizedPreferred = preferred.map((x) => x.toLowerCase());
  const matches = normalizedPreferred.filter((pref) => tags.includes(pref)).length;
  return Math.min(1, matches / normalizedPreferred.length);
}

export function generateRecommendations(input: RecommendationInput): RecommendationItem[] {
  const { beaches, profile } = input;
  const limit = input.limit ?? 5;

  const filtered = applyHardExclusions(beaches, profile).included;
  const items: RecommendationItem[] = filtered.map((beach) => {
    const tags = beach.activity_tags ?? [];
    const crowding = beach.affollamento?.livello_generale ?? "medio";
    const activity = selectActivity(profile.attivita_preferite, tags);

    const cScore = crowdingScore(profile.folla, crowding);
    const aScore = activityAffinity(profile.attivita_preferite, tags);
    const finalScore = Number((0.55 * cScore + 0.45 * aScore).toFixed(4));

    const reasons = [
      `Compatibile con preferenze attivita (${activity}).`,
      `Livello affollamento '${crowding}' coerente con profilo '${profile.folla ?? "indifferente"}'.`
    ];

    return {
      spiaggia_id: beach.id,
      spiaggia_nome: beach.nome,
      attivita: activity,
      score: finalScore,
      motivazioni: reasons
    };
  });

  return items.sort((a, b) => b.score - a.score).slice(0, limit);
}
