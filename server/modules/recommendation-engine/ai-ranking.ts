import { sendAnthropicForJson } from "../../core/ai/anthropic-client";
import type { InterpretationOutput } from "../interpretation-layer";
import type { RecommendationBeach, RecommendationUserProfile } from "./index";

export interface AiRankingShortlistItem {
  spiaggia_id: string;
  attivita: string;
  rank_score: number;
  motivazioni: string[];
}

export interface AiRankingOutput {
  shortlist: AiRankingShortlistItem[];
}

interface AiRankingInput {
  profile: RecommendationUserProfile;
  interpretation: InterpretationOutput;
  richiestaDelGiorno: string;
  candidates: RecommendationBeach[];
  limit: number;
  /** Deterministically computed number of distinct beaches needed (e.g. multi-day plans). Null when not applicable. */
  requiredCount: number | null;
  /** Categorie a cui la richiesta di oggi e' esplicitamente ancorata (es. belle_spettacolari per "le piu' belle"). Quando presente, deve prevalere sugli interessi generali salvati nel profilo. */
  anchoredCategories?: string[];
  /** Punteggio deterministico (0-1 circa) gia' calcolato per ciascuna spiaggia dalle preferenze di onboarding (categorie di interesse, gruppo, soglia di affollamento). Indicizzato per id spiaggia. Serve da base di partenza per il ranking AI: vedi istruzione 'preScoreInstruction'. */
  preScoreById?: Record<string, number>;
}

function compactCandidates(candidates: RecommendationBeach[], preScoreById: Record<string, number>): Array<Record<string, unknown>> {
  return candidates.map((beach, index) => ({
    id: beach.id,
    nome: beach.nome,
    zona: beach.zona,
    localita: beach.localita ?? null,
    esposizione_cardinale: beach.esposizione_cardinale ?? null,
    esposizione_venti: beach.esposizione_venti ?? null,
    esposizione_venti_esposta_a: beach.esposizione_venti_esposta_a ?? [],
    affollamento: beach.affollamento?.livello_generale ?? "medio",
    activity_tags: beach.activity_tags ?? [],
    punteggi_categorie: beach.punteggi_categorie ?? {},
    reachability: beach.info_pratiche.reachability,
    trail_difficulty: beach.info_pratiche.trail_difficulty,
    naturismo_tollerato: beach.info_pratiche.naturismo_tollerato ?? false,
    preScore_calcolato: preScoreById[beach.id] ?? null,
    posizione_calcolo_deterministico: index + 1
  }));
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.max(0, Math.min(1, value));
}

export async function rankCandidateBeachesWithAi(input: AiRankingInput): Promise<AiRankingOutput> {
  const countInstruction =
    input.requiredCount !== null
      ? `The shortlist MUST contain exactly ${input.requiredCount} distinct beach ids (never repeat an id) — this number was already computed from the user's multi-day plan, it is not optional and you must not return fewer (e.g. 5) unless the candidate list truly has fewer than ${input.requiredCount} suitable distinct options. Some picks may be only good, not perfect, matches: full coverage beats a shorter list of favorites.`
      : "'limit' is a maximum, not a target — use your judgment on how many items best serve the request.";

  // NB: questa istruzione era prima molto piu' aggressiva ("ignora le altre categorie, pesa
  // solo su quella ancorata"), in conflitto diretto con preScoreInstruction sotto (che chiede
  // di rispettare l'ordine gia' calcolato). Un test live ha mostrato che quella versione
  // ribaltava l'ordine del preScore non appena il testo della richiesta nominava una parola
  // qualunque della categoria (es. "rilassante"), anche quando l'utente non intendeva dare
  // priorita' assoluta a quella sola caratteristica. Ammorbidita: l'ancoraggio ora serve solo a
  // spiegare bene il perche' di una scelta, non a ribaltare l'ordine — il preScore gia'
  // incorpora un peso maggiore per la categoria ancorata (vedi pre-scoring.ts), non serve
  // applicarlo una seconda volta con piu' forza.
  const anchoredCategories = input.anchoredCategories ?? [];
  const anchoredInstruction =
    anchoredCategories.length > 0
      ? `This specific request explicitly mentions these 'punteggi_categorie' categories: ${anchoredCategories.join(", ")}. This is already reflected in 'preScore_calcolato' (these categories are weighted more heavily than others for this ranking) — you don't need to re-apply that weighting yourself. Use this mainly to explain your picks clearly (make it obvious in motivazioni why a candidate fits what was explicitly asked), not to override the given preScore order or to discount a candidate's other genuine strengths.`
      : "No single category is explicitly mentioned in this request — balance the profile's activity preferences and the request text as usual.";

  const preScoreInstruction =
    "Each candidate includes 'preScore_calcolato' and 'posizione_calcolo_deterministico': a deterministic score and rank already computed from the user's declared onboarding preferences (interest categories, group type, crowding tolerance, and any category explicitly mentioned in today's request text) — candidates are given to you IN THIS ORDER (best first). This order already correctly reflects those preferences; it is your starting point, not raw material to re-derive from scratch. Do not silently re-rank based on your own reading of what a preference 'usually implies' (e.g. do not infer that 'rilassante_tranquilla' means 'avoid famous/crowded beaches' — if the user tolerates crowding, a famous beach with a top rilassante_tranquilla score is a perfectly valid, even preferable, pick; that trade-off is already resolved by the crowding filter, don't apply it a second time), and do not re-rank purely by one category's raw 0-3 score in isolation even if that category is explicitly mentioned in the request — the blended preScore already strikes the right balance. You MAY deviate from this order only when today's specific request text contains a concrete signal that is NOT already captured by the onboarding data (e.g. a real-time condition like today's wind direction, an explicit ask for geographic variety, a logistical constraint stated in the text). When you do deviate, say so plainly in motivazioni instead of presenting it as if it were the obvious top match.";

  const system = [
    "You are the YourElba AI Ranking Layer.",
    "CRITICAL OUTPUT RULE: your entire response must be ONLY a single JSON object, nothing else. Do not think out loud, do not explain your reasoning, do not write phrases like 'I need to' or 'Let me' before the JSON. Do not add any text before the opening '{' or after the closing '}'. Do the reasoning silently and output just the final JSON.",
    "Work internally in English only.",
    "Return only JSON with key 'shortlist'.",
    "Each item must contain spiaggia_id, attivita, rank_score, motivazioni.",
    "rank_score must be between 0 and 1.",
    countInstruction,
    "Never invent beach ids. Use only candidate ids.",
    "Geography rule: 'esposizione_cardinale' is the compass direction the beach FACES (o=west, e=east, n=north, s=south, and combinations like so=southwest, ne=northeast).",
    "Wind safety is already handled deterministically before candidates reach you: 'esposizione_venti_esposta_a' lists the directions each beach is genuinely exposed to (derived from its facing direction and its own exposure notes), and any beach directly exposed to today's wind direction has already been excluded from this candidate list. You do NOT need to re-derive or double-check wind shelter yourself, and you must never present a remaining candidate as at-risk from today's wind. You may still mention esposizione_venti in motivazioni for color/context, but ground it only in the literal text given — never invent an additional shelter or exposure claim beyond what 'esposizione_venti' or 'esposizione_venti_esposta_a' state.",
    "Sunset ('tramonto') is only visible over the open sea from beaches facing west or with a westward component (o, so, no). Beaches facing e, ne, se do not offer a sea sunset view, regardless of activity tags.",
    "Do not claim sunset qualities in motivazioni unless esposizione_cardinale actually supports them.",
    "When naming a beach's direction/zone in motivazioni, translate ONLY the exact esposizione_cardinale or zona value given for that specific beach (o=west, e=east, n=north, s=south, ne/se/no/so=the matching combination). Never substitute a different or more familiar-sounding direction from general knowledge or memory of the beach's name.",
    "Each candidate has 'punteggi_categorie': a 0-3 score per category, curated by hand by the destination expert (not derived or guessed) — 0=does not apply, 1=below average, 2=average/expected level, 3=among the best on the island for that specific trait. This is descriptive color, not a ranking directive: 'preScore_calcolato' already blends these scores with the right weights for this request (see preScoreInstruction below), so do NOT re-rank or reorder candidates by picking out one category's raw score in isolation, even a 3. Use a 3 to write a stronger, more specific motivazione (a genuine, verified standout you may highlight) for whichever candidates the given order already puts forward — not as a reason to move a candidate up or down that order.",
    anchoredInstruction,
    preScoreInstruction,
    "Keep motivazioni to exactly 2 short reasons per item, each under 15 words.",
    "Output strict valid JSON only: no markdown code fences, no leading or trailing commentary, no comments, no trailing commas.",
    "'Zona di soggiorno' (accommodation zone) mentioned in the request is logistics context, not a request to stay nearby. Do not cluster all picks near it unless the user explicitly asked to minimize travel.",
    "When the user asks generically for the island's best, most beautiful, or most iconic beaches, prefer spreading the shortlist across different 'zona' and 'localita' values (avoid multiple picks sharing the same localita — that means they are a few minutes apart, not actually spread out) rather than clustering near-neighbors. Judge geographic spread ONLY from 'zona' and 'localita' — never from 'esposizione_cardinale': two beaches in the exact same localita can face completely different directions while still being neighbors, so differing esposizione_cardinale is NOT evidence of geographic spread.",
    "Geographic spread is a tie-breaker only, never a reason to override score: do not pick a candidate with a meaningfully lower 'preScore_calcolato' over one with a higher preScore_calcolato just to add zone/localita variety. Only use spread as the deciding factor among candidates whose preScore_calcolato is equal or already very close."
  ].join(" ");

  const prompt = JSON.stringify(
    {
      task: "Rank candidate beaches and propose beach + activity shortlist.",
      output_contract: {
        shortlist: [
          {
            spiaggia_id: "string id from candidates",
            attivita: "short activity label in English",
            rank_score: "0..1",
            motivazioni: ["2-3 concise reasons in English"]
          }
        ]
      },
      limit: input.limit,
      required_shortlist_count: input.requiredCount,
      anchored_categories: anchoredCategories,
      profile: input.profile,
      interpretation: input.interpretation,
      richiesta_del_giorno_originale: input.richiestaDelGiorno,
      candidates: compactCandidates(input.candidates, input.preScoreById ?? {})
    },
    null,
    2
  );

  const raw = await sendAnthropicForJson<AiRankingOutput>({
    system,
    prompt,
    maxTokens: 4000,
    temperature: 0.2
  });

  const allowed = new Set(input.candidates.map((c) => c.id));
  const shortlist = Array.isArray(raw.shortlist) ? raw.shortlist : [];
  const sanitized = shortlist
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      spiaggia_id: String(item.spiaggia_id),
      attivita: String(item.attivita ?? "beach_time"),
      rank_score: clampScore(Number(item.rank_score)),
      motivazioni: Array.isArray(item.motivazioni) ? item.motivazioni.map(String) : []
    }))
    .filter((item) => allowed.has(item.spiaggia_id))
    .slice(0, input.limit);

  // L'ordine finale (chi e' "consiglio principale" vs "alternativa") non e' piu' deciso
  // dall'AI: un test live ha mostrato che, nonostante piu' round di istruzioni esplicite di
  // rispettare l'ordine dato, l'AI continuava a riordinare secondo una propria idea di cosa
  // "conta di piu'" (es. spiagge nascoste sempre in cima per richieste di relax), producendo
  // sempre lo stesso risultato indipendentemente dal prompt. Anziche' continuare a inseguirlo
  // nel prompt, l'ordine viene ora fissato qui in modo deterministico dal preScore gia'
  // calcolato — l'AI resta libera di scegliere QUALI spiagge includere e come descriverle, ma
  // non di decidere la loro posizione relativa.
  // Eccezione: per un piano multi-giorno/multi-slot (requiredCount non nullo) l'ordine
  // dell'array codifica l'assegnazione ai giorni (i primi N sono il Giorno 1, ecc.), non una
  // classifica di preferenza — in quel caso l'ordine dato dall'AI resta intatto.
  if (input.requiredCount === null) {
    const preScoreById = input.preScoreById ?? {};
    sanitized.sort((a, b) => (preScoreById[b.spiaggia_id] ?? 0) - (preScoreById[a.spiaggia_id] ?? 0));

    // Il numero "Score" mostrato in interfaccia era ancora il rank_score soggettivo dell'AI,
    // scollegato dall'ordine sopra (ora deciso dal preScore): la posizione #2 poteva mostrare
    // un punteggio piu' basso della #4, sembrando un errore anche se l'ordine era gia'
    // corretto. Rinormalizziamo qui il preScore su una scala 0.5-0.95 (solo per la
    // visualizzazione, stesso intervallo "familiare" a cui e' abituato chi legge la risposta),
    // cosi' il numero scende in modo monotono insieme alla posizione.
    const preScores = sanitized.map((item) => preScoreById[item.spiaggia_id] ?? 0);
    const maxScore = Math.max(...preScores);
    const minScore = Math.min(...preScores);
    const range = maxScore - minScore || 1;
    sanitized.forEach((item, index) => {
      const normalized = (preScores[index] - minScore) / range;
      item.rank_score = clampScore(0.5 + normalized * 0.45);
    });
  }

  return { shortlist: sanitized };
}
