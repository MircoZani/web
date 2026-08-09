import type {
  ApiProfile,
  OnboardingProfile,
  RichiestaGiorno
} from "@/lib/types";

// Stato unico che copre sia le domande di profilo (onboarding) sia la richiesta
// del giorno. Le due interfacce non hanno chiavi in comune, quindi l'unione e'
// sicura e permette di riusare invariate le funzioni gia' esistenti in
// lib/session.ts (buildRichiestaGiornoText, saveProfile, saveRichiesta...).
export interface ChatState extends OnboardingProfile, RichiestaGiorno {}

export function emptyChatState(): ChatState {
  return {
    lingua: "it",
    mobilita_livello: "media",
    folla: "indifferente",
    gruppo: "coppia",
    mezzo: "auto",
    con_bambini: false,
    con_cane: false,
    attivita_preferite: [],
    zona_soggiorno: "",
    richiesta_esplicita_naturismo: false,
    fascia_oraria: "mattina",
    camminata_oggi: "media",
    durata: "mezza_giornata",
    tipo_richiesta: "mix",
    affollamento_massimo: "medio",
    testo_libero: ""
  };
}

export interface StepOption {
  value: string;
  label: string;
}

export type StepKind = "chip-single" | "chip-multi" | "boolean" | "text";

export interface StepDef {
  id: keyof ChatState;
  kind: StepKind;
  section: "profilo" | "richiesta";
  question: string;
  shortLabel: string;
  options?: StepOption[];
  placeholder?: string;
  required?: boolean;
}

const CAMMINATA_OPTIONS: StepOption[] = [
  { value: "bassa", label: "Più è comoda meglio è" },
  { value: "media", label: "Qualche minuto a piedi va bene" },
  { value: "alta", label: "Non mi spaventa un sentiero" }
];

export const STEPS: StepDef[] = [
  {
    id: "lingua",
    kind: "chip-single",
    section: "profilo",
    question: "Ciao! In che lingua preferisci parlare?",
    shortLabel: "Lingua",
    options: [
      { value: "it", label: "Italiano" },
      { value: "en", label: "English" },
      { value: "de", label: "Deutsch" },
      { value: "fr", label: "Français" },
      { value: "nl", label: "Nederlands" }
    ]
  },
  {
    id: "mezzo",
    kind: "chip-single",
    section: "profilo",
    question: "Per darti i suggerimenti più adatti ti faccio qualche domanda veloce. Come ti muovi sull'isola?",
    shortLabel: "Mobilità",
    options: [
      { value: "auto", label: "Auto" },
      { value: "scooter", label: "Scooter" },
      { value: "bus", label: "Bus" },
      { value: "barca", label: "Barca" },
      { value: "a_piedi", label: "A piedi" }
    ]
  },
  {
    id: "gruppo",
    kind: "chip-single",
    section: "profilo",
    question: "Con chi viaggi?",
    shortLabel: "Gruppo",
    options: [
      { value: "solo", label: "Solo" },
      { value: "coppia", label: "Coppia" },
      { value: "famiglia", label: "Famiglia" },
      { value: "amici", label: "Amici" }
    ]
  },
  {
    id: "con_bambini",
    kind: "boolean",
    section: "profilo",
    question: "Viaggi con bambini piccoli?",
    shortLabel: "Bambini",
    options: [
      { value: "true", label: "Sì" },
      { value: "false", label: "No" }
    ]
  },
  {
    id: "con_cane",
    kind: "boolean",
    section: "profilo",
    question: "Hai un cane con te?",
    shortLabel: "Cane",
    options: [
      { value: "true", label: "Sì" },
      { value: "false", label: "No" }
    ]
  },
  {
    id: "mobilita_livello",
    kind: "chip-single",
    section: "profilo",
    question: "Quanto ti piace camminare per raggiungere la spiaggia?",
    shortLabel: "Camminata",
    options: CAMMINATA_OPTIONS
  },
  {
    // Sostituisce la vecchia domanda "folla" (evita/indifferente/cerca_movida): quel campo non
    // ha mai avuto un ruolo reale nel motore di raccomandazione (solo affollamento_massimo viene
    // usato per escludere le spiagge troppo affollate, vedi pre-scoring.ts). Chiesta una sola
    // volta qui in onboarding invece che ad ogni richiesta del giorno: su richiesta di Mirco,
    // ripeterla ogni volta era ridondante e un po' noioso.
    id: "affollamento_massimo",
    kind: "chip-single",
    section: "profilo",
    question: "Qual è il massimo affollamento che tolleri in spiaggia?",
    shortLabel: "Affollamento",
    options: [
      { value: "basso", label: "Basso (evita le spiagge più affollate)" },
      { value: "medio", label: "Medio (esclude solo le più affollate)" },
      { value: "alto", label: "Alto (nessun limite)" }
    ]
  },
  {
    id: "attivita_preferite",
    kind: "chip-multi",
    section: "profilo",
    question: "Quali attività ti interessano? Puoi sceglierne più di una.",
    shortLabel: "Attività",
    options: [
      { value: "snorkeling_immersione", label: "Snorkeling/immersioni" },
      { value: "sport_acquatici", label: "Sport acquatici" },
      { value: "natura_selvaggia", label: "Natura selvaggia" },
      { value: "rilassante_tranquilla", label: "Rilassante/tranquilla" },
      { value: "culturale_caratteristica", label: "Caratteristiche storiche" },
      { value: "comfort_servizi", label: "Confort e servizi" }
    ]
  },
  {
    id: "zona_soggiorno",
    kind: "text",
    section: "profilo",
    question: "Dove alloggi?",
    shortLabel: "Zona di soggiorno",
    placeholder: "es. Capoliveri, Marina di Campo...",
    required: true
  },
  {
    id: "richiesta_esplicita_naturismo",
    kind: "boolean",
    section: "profilo",
    question:
      "Ultima cosa: vuoi includere spiagge con area naturista? Le includiamo solo se lo chiedi esplicitamente.",
    shortLabel: "Spiagge naturiste",
    options: [
      { value: "false", label: "Non consigliarmi spiagge naturiste" },
      { value: "true", label: "Sì, includi spiagge naturiste" }
    ]
  },
  {
    id: "fascia_oraria",
    kind: "chip-single",
    section: "richiesta",
    question: "Perfetto, ho tutto quello che mi serve. In che fascia oraria vuoi andare oggi?",
    shortLabel: "Fascia oraria",
    options: [
      { value: "mattina", label: "Mattina (fino alle 13)" },
      { value: "pomeriggio", label: "Pomeriggio (dopo le 13)" },
      { value: "tutta_giornata", label: "Tutta la giornata" }
    ]
  },
  {
    id: "camminata_oggi",
    kind: "chip-single",
    section: "richiesta",
    question: "Quanto sei disposto a camminare oggi?",
    shortLabel: "Camminata oggi",
    options: CAMMINATA_OPTIONS
  },
  {
    id: "durata",
    kind: "chip-single",
    section: "richiesta",
    question: "Quanto tempo hai a disposizione?",
    shortLabel: "Durata",
    options: [
      { value: "pochi_ore", label: "Poche ore" },
      { value: "mezza_giornata", label: "Mezza giornata" },
      { value: "giornata_intera", label: "Giornata intera" }
    ]
  },
  {
    id: "tipo_richiesta",
    kind: "chip-single",
    section: "richiesta",
    question: "Cosa cerchi oggi?",
    shortLabel: "Tipo di richiesta",
    options: [
      { value: "spiaggia", label: "Spiaggia" },
      { value: "attivita", label: "Attività" },
      { value: "relax", label: "Relax" },
      { value: "mix", label: "Mix spiaggia + attività" }
    ]
  },
  {
    id: "testo_libero",
    kind: "text",
    section: "richiesta",
    question: "Vuoi aggiungere qualche nota? È facoltativo.",
    shortLabel: "Note",
    placeholder: "Es. Vorrei acqua calma, ideale per snorkeling…",
    required: false
  }
];

export const PROFILE_STEPS = STEPS.filter((s) => s.section === "profilo");
export const RICHIESTA_STEPS = STEPS.filter((s) => s.section === "richiesta");

export function getStepIndex(id: keyof ChatState): number {
  return STEPS.findIndex((s) => s.id === id);
}

export function getStepValue(state: ChatState, step: StepDef): string | string[] | boolean {
  return state[step.id] as unknown as string | string[] | boolean;
}

export function setStepValue(
  state: ChatState,
  step: StepDef,
  value: string | string[] | boolean
): ChatState {
  return { ...state, [step.id]: value } as ChatState;
}

export function optionLabel(step: StepDef, rawValue: unknown): string {
  if (step.kind === "boolean") {
    const v = rawValue ? "true" : "false";
    return step.options?.find((o) => o.value === v)?.label ?? "";
  }
  if (step.kind === "chip-multi") {
    const arr = Array.isArray(rawValue) ? rawValue : [];
    if (arr.length === 0) return "Nessuna selezionata";
    return arr.map((v) => step.options?.find((o) => o.value === v)?.label ?? v).join(", ");
  }
  if (step.kind === "text") {
    const s = typeof rawValue === "string" ? rawValue.trim() : "";
    return s || "(non specificato)";
  }
  return step.options?.find((o) => o.value === String(rawValue))?.label ?? String(rawValue);
}

// Stesso mapping usato in RichiestaClient: e' il contratto che l'API si aspetta.
export function toApiProfile(state: ChatState): ApiProfile {
  return {
    lingua: state.lingua,
    mobilita_livello: state.mobilita_livello,
    mobilita_ridotta: state.mobilita_livello === "bassa",
    richiesta_esplicita_naturismo: state.richiesta_esplicita_naturismo,
    folla: state.folla,
    attivita_preferite: state.attivita_preferite,
    mezzo_trasporto: state.mezzo,
    gruppo: state.gruppo,
    con_bambini: state.con_bambini
  };
}
