"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { ApiProfile, OnboardingProfile, RichiestaGiorno } from "@/lib/types";
import { buildRichiestaGiornoText, loadProfile, loadRichiesta, saveRichiesta, saveResults } from "@/lib/session";
import { fetchRecommendations } from "@/lib/api";

const emptyRichiesta = (): RichiestaGiorno => ({
  fascia_oraria: "mattina",
  camminata_oggi: "media",
  durata: "mezza_giornata",
  tipo_richiesta: "mix",
  affollamento_massimo: "medio",
  testo_libero: ""
});

function toApiProfile(onboarding: OnboardingProfile): ApiProfile {
  return {
    lingua: onboarding.lingua,
    mobilita_livello: onboarding.mobilita_livello,
    mobilita_ridotta: onboarding.mobilita_livello === "bassa",
    richiesta_esplicita_naturismo: onboarding.richiesta_esplicita_naturismo,
    folla: onboarding.folla,
    attivita_preferite: onboarding.attivita_preferite,
    mezzo_trasporto: onboarding.mezzo,
    gruppo: onboarding.gruppo,
    con_bambini: onboarding.con_bambini
  };
}

export function RichiestaClient() {
  const router = useRouter();
  const [richiesta, setRichiesta] = useState<RichiestaGiorno>(emptyRichiesta);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const saved = loadRichiesta();
    if (saved) setRichiesta(saved);
  }, []);

  const update = useCallback(<K extends keyof RichiestaGiorno>(key: K, value: RichiestaGiorno[K]) => {
    setRichiesta((r) => ({ ...r, [key]: value }));
  }, []);

  const submit = useCallback(async () => {
    const profile = loadProfile();
    if (!profile) {
      setError("Completa prima l'onboarding.");
      router.push("/onboarding");
      return;
    }
    setLoading(true);
    setError(null);
    saveRichiesta(richiesta);
    const richiesta_giorno = buildRichiestaGiornoText(profile, richiesta);
    try {
      const data = await fetchRecommendations({
        profile: toApiProfile(profile),
        richiesta_giorno,
        affollamento_massimo: richiesta.affollamento_massimo,
        limit: 10
      });
      saveResults(data);
      router.push("/risultati");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Errore di rete");
    } finally {
      setLoading(false);
    }
  }, [richiesta, router]);

  return (
    <div className="card">
      <h2>Richiesta del giorno</h2>
      <p className="lead">Raccontaci cosa cerchi oggi: il resto lo gestisce YourElba.</p>

      <div className="field">
        <label>Fascia oraria</label>
        <select
          value={richiesta.fascia_oraria}
          onChange={(e) => update("fascia_oraria", e.target.value as RichiestaGiorno["fascia_oraria"])}
        >
          <option value="mattina">Mattina (fino alle 13)</option>
          <option value="pomeriggio">Pomeriggio (dopo le 13)</option>
          <option value="tutta_giornata">Tutta la giornata</option>
        </select>
      </div>

      <div className="field">
        <label>Quanto sei disposto a camminare oggi?</label>
        <div className="row">
          {(
            [
              { value: "bassa", label: "Più è comoda meglio è" },
              { value: "media", label: "Qualche minuto a piedi va bene" },
              { value: "alta", label: "Non mi spaventa un sentiero" }
            ] as const
          ).map((item) => (
            <button
              key={item.value}
              type="button"
              className={`chip ${richiesta.camminata_oggi === item.value ? "selected" : ""}`}
              onClick={() => update("camminata_oggi", item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label>Durata</label>
        <select value={richiesta.durata} onChange={(e) => update("durata", e.target.value as RichiestaGiorno["durata"])}>
          <option value="pochi_ore">Poche ore</option>
          <option value="mezza_giornata">Mezza giornata</option>
          <option value="giornata_intera">Giornata intera</option>
        </select>
      </div>

      <div className="field">
        <label>Tipo di richiesta</label>
        <select
          value={richiesta.tipo_richiesta}
          onChange={(e) => update("tipo_richiesta", e.target.value as RichiestaGiorno["tipo_richiesta"])}
        >
          <option value="spiaggia">Spiaggia</option>
          <option value="attivita">Attività</option>
          <option value="relax">Relax</option>
          <option value="mix">Mix spiaggia + attività</option>
        </select>
      </div>

      <div className="field">
        <label>Massimo affollamento tollerato</label>
        <div className="row">
          {(
            [
              { value: "basso", label: "Basso (evita le spiagge più affollate)" },
              { value: "medio", label: "Medio (esclude solo le più affollate)" },
              { value: "alto", label: "Alto (nessun limite)" }
            ] as const
          ).map((item) => (
            <button
              key={item.value}
              type="button"
              className={`chip ${richiesta.affollamento_massimo === item.value ? "selected" : ""}`}
              onClick={() => update("affollamento_massimo", item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label htmlFor="testo">Note libere (opzionale)</label>
        <textarea
          id="testo"
          value={richiesta.testo_libero}
          onChange={(e) => update("testo_libero", e.target.value)}
          placeholder="Es. Vorrei acqua calma, ideale per snorkeling…"
        />
      </div>

      {error && <div className="error">{error}</div>}

      <div className="nav-actions">
        <button type="button" className="btn btn-ghost" onClick={() => router.push("/onboarding")}>
          Modifica profilo
        </button>
        <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={loading}>
          {loading ? "Attendi…" : "Ottieni raccomandazioni"}
        </button>
      </div>
    </div>
  );
}
