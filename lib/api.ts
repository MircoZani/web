import type { ApiProfile, MassimoAffollamentoTollerato, RecommendationsResponse } from "./types";

// Backend e frontend sono ora la stessa app Next.js: la route e' relativa, stessa origine,
// niente piu' URL/porta separata da configurare (ne' CORS).
export async function fetchRecommendations(body: {
  profile: ApiProfile;
  richiesta_giorno: string;
  affollamento_massimo?: MassimoAffollamentoTollerato;
  limit?: number;
}): Promise<RecommendationsResponse> {
  const res = await fetch("/api/recommendations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      profile: body.profile,
      richiesta_giorno: body.richiesta_giorno,
      affollamento_massimo: body.affollamento_massimo,
      limit: body.limit ?? 5
    })
  });
  const data = (await res.json()) as RecommendationsResponse & { error?: string; details?: string[] };
  if (!res.ok) {
    const msg = data.error ?? res.statusText;
    const details = Array.isArray(data.details) ? data.details.join("; ") : "";
    throw new Error(details ? `${msg}: ${details}` : msg);
  }
  return data as RecommendationsResponse;
}
