import type { OnboardingProfile, RichiestaGiorno, RecommendationsResponse } from "./types";

const KEY_PROFILE = "yourelba_profile";
const KEY_RICHIESTA = "yourelba_richiesta";
const KEY_RESULTS = "yourelba_results";

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
