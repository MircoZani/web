"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { RecommendationsResponse } from "@/lib/types";
import { loadResults } from "@/lib/session";
import { renderMarkdown } from "@/lib/markdown";

export function RisultatiClient() {
  const router = useRouter();
  const [data, setData] = useState<RecommendationsResponse | null>(null);

  useEffect(() => {
    const r = loadResults();
    if (!r) router.replace("/richiesta");
    else setData(r);
  }, [router]);

  if (!data) {
    return (
      <div className="card">
        <p className="lead">Caricamento…</p>
      </div>
    );
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: "1rem" }}>
        <h2>La tua giornata</h2>
        <p className="lead">Ecco cosa ti consiglia YourElba, in base al profilo e alla richiesta di oggi.</p>
        <div className="conversation">{renderMarkdown(data.final_response)}</div>
      </div>

      {data.recommendations.length > 0 && (
        <div className="card">
          <h2>Raccomandazioni</h2>
          <p className="lead">
            {data.meta.total_recommended} proposte su {data.meta.total_catalog} spiagge nel catalogo (
            {data.meta.total_excluded} escluse dai filtri di sicurezza).
          </p>

          {data.recommendations.map((rec, i) => (
            <div key={`${rec.spiaggia_id}-${i}`} className="result-block">
              <h3>
                {i + 1}. {rec.nome}
              </h3>
              <p style={{ margin: "0 0 0.5rem", fontSize: "0.9rem", color: "var(--muted)" }}>
                Attività suggerita: <strong>{rec.attivita}</strong> · Score {rec.rank_score.toFixed(2)}
              </p>
              <ul className="motivi">
                {rec.motivazioni.map((m, j) => (
                  <li key={j}>{m}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      <div className="nav-actions" style={{ marginTop: "1.5rem" }}>
        <Link href="/richiesta" className="btn btn-ghost" style={{ display: "inline-flex" }}>
          Nuova richiesta
        </Link>
        <Link href="/onboarding" className="btn btn-primary" style={{ display: "inline-flex" }}>
          Ricomincia onboarding
        </Link>
      </div>
    </div>
  );
}
