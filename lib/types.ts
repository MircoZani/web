export type Lingua = "it" | "en" | "de" | "fr" | "nl";
export type MobilitaLivello = "alta" | "media" | "bassa";
export type Folla = "evita" | "indifferente" | "cerca_movida";
export type MassimoAffollamentoTollerato = "basso" | "medio" | "alto";

export interface OnboardingProfile {
  lingua: Lingua;
  mobilita_livello: MobilitaLivello;
  folla: Folla;
  gruppo: "solo" | "coppia" | "famiglia" | "amici";
  mezzo: "auto" | "scooter" | "bus" | "barca" | "a_piedi";
  con_bambini: boolean;
  con_cane: boolean;
  attivita_preferite: string[];
  zona_soggiorno: string;
  richiesta_esplicita_naturismo: boolean;
}

export interface RichiestaGiorno {
  fascia_oraria: "mattina" | "pomeriggio" | "tutta_giornata";
  camminata_oggi: MobilitaLivello;
  durata: "mezza_giornata" | "giornata_intera" | "pochi_ore";
  tipo_richiesta: "spiaggia" | "attivita" | "relax" | "mix";
  affollamento_massimo: MassimoAffollamentoTollerato;
  testo_libero: string;
}

export interface ApiProfile {
  lingua: Lingua;
  mobilita_livello: MobilitaLivello;
  mobilita_ridotta: boolean;
  richiesta_esplicita_naturismo: boolean;
  folla?: Folla;
  attivita_preferite: string[];
  mezzo_trasporto?: "auto" | "scooter" | "bus" | "barca" | "a_piedi";
  gruppo?: "solo" | "coppia" | "famiglia" | "amici";
  con_bambini?: boolean;
}

export interface RecommendationsResponse {
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
  excluded: Array<{ beachId: string; beachName: string; reasons: string[] }>;
  meta: {
    total_catalog: number;
    total_excluded: number;
    total_recommended: number;
  };
}
