import type { OnboardingProfile, RichiestaGiorno, RecommendationsResponse } from "./types";

const KEY_PROFILE = "yourelba_profile";
const KEY_RICHIESTA = "yourelba_richiesta";
const KEY_RESULTS = "yourelba_results";
const KEY_VISITED_BEACHES = "yourelba_visited_beaches";

export function saveProfile(p: OnboardingProfile): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY_PROFILE, JSON.stringify(p));
}

export function loadProfile(): OnboardingProfile | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(KEY_PROFILE);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as OnboardingProfile;
  } catch {
    return null;
  }
}

export function saveRichiesta(r: RichiestaGiorno): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY_RICHIESTA, JSON.stringify(r));
}

export function loadRichiesta(): RichiestaGiorno | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(KEY_RICHIESTA);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as RichiestaGiorno;
  } catch {
    return null;
  }
}

export function saveResults(r: RecommendationsResponse): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY_RESULTS, JSON.stringify(r));
}

export function loadResults(): RecommendationsResponse | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(KEY_RESULTS);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as RecommendationsResponse;
  } catch {
    return null;
  }
}

// Spiagge che l'utente ha detto di aver gia' scelto/visitato (route /chat). Elenco che cresce
// nel tempo, usato come contesto "morbido" nelle richieste successive (l'AI ne tiene conto ma
// puo' comunque riproporle se sono davvero la scelta giusta per una richiesta diversa) invece di
// un'esclusione rigida nel codice: una spiaggia vista in una sessione precedente potrebbe tornare
// utile con una richiesta diversa.
export function saveVisitedBeaches(names: string[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY_VISITED_BEACHES, JSON.stringify(names));
}

export function loadVisitedBeaches(): string[] {
  if (typeof window === "undefined") return [];
  const raw = localStorage.getItem(KEY_VISITED_BEACHES);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function buildRichiestaGiornoText(
  profile: OnboardingProfile,
  richiesta: RichiestaGiorno
): string {
  const parts = [
    `[Richiesta del giorno] Durata: ${richiesta.durata}. Tipo: ${richiesta.tipo_richiesta}.`,
    `[Contesto] Fascia oraria: ${richiesta.fascia_oraria}. Gruppo: ${profile.gruppo}. Mezzo: ${profile.mezzo}.`,
    `Livello camminata oggi: ${richiesta.camminata_oggi}. Mobilità profilo: ${profile.mobilita_livello}. Zona di soggiorno: ${profile.zona_soggiorno}.`,
    `Bambini: ${profile.con_bambini}. Cane: ${profile.con_cane}.`,
    richiesta.testo_libero.trim() ? `Note: ${richiesta.testo_libero.trim()}` : ""
  ].filter(Boolean);
  return parts.join(" ");
}
