"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Lingua, MobilitaLivello, Folla, OnboardingProfile } from "@/lib/types";
import { loadProfile, saveProfile } from "@/lib/session";

const LINGUE: { value: Lingua; label: string }[] = [
  { value: "it", label: "Italiano" },
  { value: "en", label: "English" },
  { value: "de", label: "Deutsch" },
  { value: "fr", label: "Français" },
  { value: "nl", label: "Nederlands" }
];

const FOLLA: { value: Folla; label: string }[] = [
  { value: "evita", label: "Preferisco luoghi tranquilli" },
  { value: "indifferente", label: "Mi adatto" },
  { value: "cerca_movida", label: "Mi piace la vivacità" }
];

const GRUPPI = [
  { value: "solo" as const, label: "Solo" },
  { value: "coppia" as const, label: "Coppia" },
  { value: "famiglia" as const, label: "Famiglia" },
  { value: "amici" as const, label: "Amici" }
];

const MEZZI = [
  { value: "auto" as const, label: "Auto" },
  { value: "scooter" as const, label: "Scooter" },
  { value: "bus" as const, label: "Bus" },
  { value: "barca" as const, label: "Barca" },
  { value: "a_piedi" as const, label: "A piedi" }
];

// Le opzioni corrispondono esattamente (1:1) alle categorie curate a mano nel dataset
// (CategoryScores in recommendation-engine/index.ts). Cosi' l'AI non deve piu' interpretare
// o indovinare cosa intende l'utente con un'etichetta generica come "relax" (che poteva
// implicare anche "evitare la folla", cosa non richiesta) — l'utente dichiara esattamente
// cosa gli interessa, categoria per categoria, e quel segnale pesa in modo corretto e diretto
// nella formula di pre-scoring senza bisogno di una tabella di traduzione.
const ATTIVITA_OPTIONS = [
  { id: "snorkeling_immersione", label: "Snorkeling/immersioni" },
  { id: "sport_acquatici", label: "Sport acquatici" },
  { id: "natura_selvaggia", label: "Natura selvaggia" },
  { id: "rilassante_tranquilla", label: "Rilassante/tranquilla" },
  { id: "culturale_caratteristica", label: "Caratteristiche storiche" },
  { id: "comfort_servizi", label: "Confort e servizi" }
];

const CAMMINATA_OPTIONS: Array<{ value: MobilitaLivello; label: string }> = [
  { value: "bassa", label: "Più è comoda meglio è" },
  { value: "media", label: "Qualche minuto a piedi va bene" },
  { value: "alta", label: "Non mi spaventa un sentiero" }
];

const GREETING_BY_LANGUAGE: Record<Lingua, string> = {
  it: "Ciao! Per darti i suggerimenti più adatti, ti faccio qualche domanda veloce.",
  en: "Hi! To suggest the best options for you, I have a few quick questions.",
  de: "Hallo! Damit ich dir passende Vorschläge geben kann, stelle ich dir ein paar kurze Fragen.",
  fr: "Bonjour ! Pour te proposer les meilleures options, je te pose quelques questions rapides.",
  nl: "Hoi! Om je de beste suggesties te geven, stel ik je een paar snelle vragen."
};

const TOTAL_STEPS = 9;

function emptyProfile(): OnboardingProfile {
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
    richiesta_esplicita_naturismo: false
  };
}

export function OnboardingClient() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [profile, setProfile] = useState<OnboardingProfile>(emptyProfile);

  useEffect(() => {
    const saved = loadProfile();
    if (saved) setProfile(saved);
  }, []);

  const progress = useMemo(() => ((step + 1) / TOTAL_STEPS) * 100, [step]);

  const update = useCallback(<K extends keyof OnboardingProfile>(key: K, value: OnboardingProfile[K]) => {
    setProfile((p) => ({ ...p, [key]: value }));
  }, []);

  const toggleAttivita = useCallback((id: string) => {
    setProfile((p) => {
      const set = new Set(p.attivita_preferite);
      if (set.has(id)) set.delete(id);
      else set.add(id);
      return { ...p, attivita_preferite: Array.from(set) };
    });
  }, []);

  const next = useCallback(() => {
    if (step < TOTAL_STEPS - 1) setStep((s) => s + 1);
    else {
      saveProfile(profile);
      router.push("/richiesta");
    }
  }, [step, profile, router]);

  const back = useCallback(() => {
    if (step > 0) setStep((s) => s - 1);
  }, [step]);

  const canContinue = useMemo(() => {
    if (step === 7 && !profile.zona_soggiorno.trim()) return false;
    return true;
  }, [step, profile.zona_soggiorno]);

  return (
    <div className="card">
      {step > 0 && (
        <>
          <div className="progress">
            <div className="progress-bar" style={{ width: `${progress}%` }} />
          </div>
          <p className="step-meta">
            Passo {step + 1} di {TOTAL_STEPS}
          </p>
        </>
      )}

      {step === 0 && (
        <div className="row" style={{ justifyContent: "center" }}>
          {LINGUE.map((l) => (
            <button
              key={l.value}
              type="button"
              className={`chip ${profile.lingua === l.value ? "selected" : ""}`}
              onClick={() => {
                update("lingua", l.value);
                setStep(1);
              }}
            >
              {l.label}
            </button>
          ))}
        </div>
      )}

      {step === 1 && (
        <>
          <p className="lead">{GREETING_BY_LANGUAGE[profile.lingua]}</p>
          <h2>Come ti muovi sull&apos;isola?</h2>
          <div className="row">
            {MEZZI.map((m) => (
              <button
                key={m.value}
                type="button"
                className={`chip ${profile.mezzo === m.value ? "selected" : ""}`}
                onClick={() => update("mezzo", m.value)}
              >
                {m.label}
              </button>
            ))}
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <h2>Con chi viaggi?</h2>
          <div className="row">
            {GRUPPI.map((g) => (
              <button
                key={g.value}
                type="button"
                className={`chip ${profile.gruppo === g.value ? "selected" : ""}`}
                onClick={() => update("gruppo", g.value)}
              >
                {g.label}
              </button>
            ))}
          </div>
        </>
      )}

      {step === 3 && (
        <>
          <h2>Dettagli sul gruppo</h2>
          <div className="field">
            <p className="lead">Viaggi con bambini piccoli?</p>
            <label>
              <input
                type="radio"
                name="con_bambini"
                checked={profile.con_bambini}
                onChange={() => update("con_bambini", true)}
              />{" "}
              Sì
            </label>
            <label>
              <input
                type="radio"
                name="con_bambini"
                checked={!profile.con_bambini}
                onChange={() => update("con_bambini", false)}
              />{" "}
              No
            </label>
          </div>
          <div className="field" style={{ marginTop: "0.75rem" }}>
            <p className="lead">Hai un cane con te?</p>
            <label>
              <input
                type="radio"
                name="con_cane"
                checked={profile.con_cane}
                onChange={() => update("con_cane", true)}
              />{" "}
              Sì
            </label>
            <label>
              <input
                type="radio"
                name="con_cane"
                checked={!profile.con_cane}
                onChange={() => update("con_cane", false)}
              />{" "}
              No
            </label>
          </div>
        </>
      )}

      {step === 4 && (
        <>
          <h2>Quanto ti piace camminare per raggiungere la spiaggia?</h2>
          {CAMMINATA_OPTIONS.map((c) => (
            <button
              key={c.value}
              type="button"
              className={`chip ${profile.mobilita_livello === c.value ? "selected" : ""}`}
              style={{ display: "block", width: "100%", marginBottom: "0.5rem", textAlign: "left" }}
              onClick={() => update("mobilita_livello", c.value)}
            >
              {c.label}
            </button>
          ))}
        </>
      )}

      {step === 5 && (
        <>
          <h2>Quanto ti piace la folla in spiaggia?</h2>
          {FOLLA.map((f) => (
            <button
              key={f.value}
              type="button"
              className={`chip ${profile.folla === f.value ? "selected" : ""}`}
              style={{ display: "block", width: "100%", marginBottom: "0.5rem", textAlign: "left" }}
              onClick={() => update("folla", f.value)}
            >
              {f.label}
            </button>
          ))}
        </>
      )}

      {step === 6 && (
        <>
          <h2>Attività che ti interessano</h2>
          <p className="lead">Selezione multipla.</p>
          <div className="row">
            {ATTIVITA_OPTIONS.map((a) => (
              <button
                key={a.id}
                type="button"
                className={`chip ${profile.attivita_preferite.includes(a.id) ? "selected" : ""}`}
                onClick={() => toggleAttivita(a.id)}
              >
                {a.label}
              </button>
            ))}
          </div>
        </>
      )}

      {step === 7 && (
        <>
          <h2>Dove alloggi?</h2>
          <div className="field">
            <input
              type="text"
              value={profile.zona_soggiorno}
              onChange={(e) => update("zona_soggiorno", e.target.value)}
              placeholder="es. Capoliveri, Marina di Campo..."
              autoComplete="off"
            />
          </div>
        </>
      )}

      {step === 8 && (
        <>
          <h2>Ultima cosa</h2>
          <p className="lead">Vuoi includere spiagge con area naturista? Le includiamo solo se lo chiedi esplicitamente.</p>
          <div className="field">
            <label>
              <input
                type="radio"
                name="naturismo"
                checked={!profile.richiesta_esplicita_naturismo}
                onChange={() => update("richiesta_esplicita_naturismo", false)}
              />{" "}
              Non consigliarmi spiagge naturiste
            </label>
            <label>
              <input
                type="radio"
                name="naturismo"
                checked={profile.richiesta_esplicita_naturismo}
                onChange={() => update("richiesta_esplicita_naturismo", true)}
              />{" "}
              Sì, includi spiagge naturiste
            </label>
          </div>
        </>
      )}

      {step > 0 && (
        <div className="nav-actions">
          <button type="button" className="btn btn-ghost" onClick={back}>
            Indietro
          </button>
          <button type="button" className="btn btn-primary" onClick={next} disabled={!canContinue}>
            {step === TOTAL_STEPS - 1 ? "Vai alla richiesta del giorno" : "Avanti"}
          </button>
        </div>
      )}
    </div>
  );
}
