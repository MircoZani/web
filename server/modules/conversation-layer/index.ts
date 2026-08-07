import { sendAnthropicMessage } from "../../core/ai/anthropic-client";
import type { InterpretationOutput } from "../interpretation-layer";
import type { RecommendationUserProfile } from "../recommendation-engine";
import type { AiRankingShortlistItem } from "../recommendation-engine/ai-ranking";

export interface ShortlistBeachDetail {
  /** Posizione 1-based nell'ordine gia' deciso a monte (preScore per le richieste non multi-giorno). Vedi orderInstruction: la posizione 1 e' sempre il consiglio principale. */
  posizione?: number;
  id: string;
  nome: string;
  zona?: string;
  localita?: string | null;
  esposizione_cardinale?: string | null;
  esposizione_venti?: string | null;
  activity_tags?: string[];
  /** Categorie dove questa spiaggia ha punteggio 3/3 (curato a mano) — un punto di riferimento verificato, non solo idonea. */
  puntiDiForza?: string[];
  tipoFondale?: string;
  lunghezzaM?: number;
  /** Indicazioni stradali/di parcheggio reali — unica fonte ammessa per consigli pratici su come arrivare/parcheggiare. */
  indicazioni?: string;
  /** Descrizione narrativa scritta a mano dall'esperto — fonte per evidenziare l'unicita' della spiaggia. */
  noteQualitative?: string;
  difficoltaAccesso?: number;
  raggiungibileViaTerra?: boolean;
  accessibilitaDisabili?: string | null;
  caniAmmessi?: string | boolean | null;
  /** Unica fonte ammessa per consigli qualitativi sui tempi/affollamento (es. "arrivare presto"): mai inventare un orario specifico, non essendoci alcun dato sugli orari reali. */
  affollamento?: { livelloGenerale?: string; note?: string | null };
}

export interface ItineraryPlan {
  giorni: number;
  slotsPerDay: number;
  totalSlots: number;
}

/** Una spiaggia nominata esplicitamente nel testo libero di oggi ma esclusa (hard exclusion o soglia affollamento/vento) — l'utente ha chiesto info specifiche su di lei, quindi le si risponde comunque con una descrizione, preceduta da un promemoria trasparente sul perche' non e' tra i consigli. */
export interface NamedBeachExclusionEntry {
  detail: ShortlistBeachDetail;
  /** Codici motivo (stessi di HARD_EXCLUSION_RULES in exclusion-layer, piu' "CROWDING_LIMIT"/"WIND_LIMIT" per i filtri soft di pre-scoring). Puo' averne piu' di uno. */
  reasonCodes: string[];
}

interface ConversationInput {
  lingua: "it" | "en" | "de" | "fr" | "nl";
  profile: RecommendationUserProfile;
  richiestaDelGiorno: string;
  interpretation: InterpretationOutput;
  itineraryPlan?: ItineraryPlan | null;
  shortlist: AiRankingShortlistItem[];
  shortlistBeachDetails: ShortlistBeachDetail[];
  /** Nomi di spiagge scartate solo perche' oltre la soglia di affollamento tollerata dall'utente, pur avendo punteggio massimo sulla categoria richiesta oggi — da menzionare con trasparenza invece di ometterle in silenzio. */
  beachesExcludedByCrowdingLimit?: string[];
  /** Nomi di spiagge scartate perche' esposte al vento nominato nella richiesta di oggi, pur avendo punteggio massimo sulla categoria richiesta oggi — stesso principio di trasparenza del caso affollamento. */
  beachesExcludedByWind?: string[];
  /** Spiagge nominate esplicitamente nel testo libero di oggi ma escluse per una preferenza gia' impostata — rispondiamo comunque con una descrizione, con promemoria trasparente in testa. */
  namedBeachExclusions?: NamedBeachExclusionEntry[];
  /** true se il testo libero di oggi menziona il naturismo ma il profilo ha impostato di escluderlo — usato per una nota di trasparenza dedicata, distinta dal caso "spiaggia nominata". */
  naturismPreferenceConflict?: boolean;
}

type Lingua = ConversationInput["lingua"];

const LANGUAGE_MAP: Record<ConversationInput["lingua"], string> = {
  it: "Italian",
  en: "English",
  de: "German",
  fr: "French",
  nl: "Dutch"
};

// Le note di trasparenza (spiagge scartate per soglia di affollamento o per vento) NON sono
// piu' scritte in prosa libera dall'AI: un test live ha mostrato che anche fornendo i nomi
// esatti, il modello a volte li sostituiva con nomi di spiagge plausibili ma non realmente
// esposte al vento del giorno (es. Cala Seregola, Stagnone — inventati). Per garantire
// l'esattezza vengono generate qui come testo fisso e aggiunte in coda alla risposta dell'AI,
// invece di essere delegate al modello.
function formatBeachList(names: string[], lingua: ConversationInput["lingua"]): string {
  if (names.length === 1) return names[0];
  const last = names[names.length - 1];
  const rest = names.slice(0, -1).join(", ");
  const conjunction: Record<ConversationInput["lingua"], string> = { it: "e", en: "and", de: "und", fr: "et", nl: "en" };
  return `${rest} ${conjunction[lingua]} ${last}`;
}

function buildCrowdingTransparencyNote(names: string[], lingua: ConversationInput["lingua"]): string {
  const list = formatBeachList(names, lingua);
  const templates: Record<ConversationInput["lingua"], string> = {
    it: `Nota: ${list} sarebbe stata tra le scelte migliori per questa richiesta, ma supera la soglia di affollamento che tolleri oggi, quindi non è tra i consigli qui sopra.`,
    en: `Note: ${list} would have been among the best matches for this request, but it exceeds the crowding level you're willing to tolerate today, so it's not included above.`,
    de: `Hinweis: ${list} wäre eine der besten Optionen für diese Anfrage gewesen, überschreitet aber die heute tolerierte Besucherdichte und wird daher oben nicht empfohlen.`,
    fr: `Remarque : ${list} aurait été l'un des meilleurs choix pour cette demande, mais dépasse le niveau de fréquentation que vous tolérez aujourd'hui, elle n'est donc pas incluse ci-dessus.`,
    nl: `Let op: ${list} zou een van de beste opties zijn geweest voor dit verzoek, maar overschrijdt het drukte-niveau dat je vandaag tolereert, en staat daarom niet hierboven.`
  };
  return templates[lingua];
}

// Rete di sicurezza a livello di codice: anche con l'istruzione esplicita di non inventare mai
// un orario specifico, un test live ha mostrato l'AI scrivere comunque "Partite entro le
// 8:30-9:00" (un numero non fondato su alcun dato, e potenzialmente sbagliato). Invece di
// fidarci solo del prompt, ripuliamo qui ogni frase che contiene un riferimento a un orario
// specifico prima di restituire la risposta. Operiamo per frase (non per intera riga) cosi'
// il resto del paragrafo/elenco puntato resta intatto anche quando una sola frase viene tolta.
const CLOCK_TIME_PATTERN =
  /\b([01]?\d|2[0-3])[:.,]\d{2}\b|\b(entro|prima delle|dopo le|alle ore|by|before|after)\s+([01]?\d|2[0-3])\b/i;

function stripInventedClockTimes(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      // Non tocchiamo intestazioni/righe senza punteggiatura a fine frase (titoli, bullet
      // singoli) per non rischiare di rompere la formattazione markdown.
      if (!/[.!?]/.test(line)) return line;
      const sentences = line.split(/(?<=[.!?])\s+/);
      const filtered = sentences.filter((sentence) => !CLOCK_TIME_PATTERN.test(sentence));
      return filtered.join(" ");
    })
    .join("\n");
}

function buildWindTransparencyNote(names: string[], lingua: ConversationInput["lingua"]): string {
  const list = formatBeachList(names, lingua);
  const templates: Record<ConversationInput["lingua"], string> = {
    it: `Nota: ${list} sarebbe stata tra le scelte migliori per questa richiesta, ma oggi è direttamente esposta al vento, quindi non è tra i consigli qui sopra.`,
    en: `Note: ${list} would have been among the best matches for this request, but it is directly exposed to today's wind, so it's not included above.`,
    de: `Hinweis: ${list} wäre eine der besten Optionen für diese Anfrage gewesen, ist heute aber direkt dem Wind ausgesetzt und wird daher oben nicht empfohlen.`,
    fr: `Remarque : ${list} aurait été l'un des meilleurs choix pour cette demande, mais elle est directement exposée au vent aujourd'hui, elle n'est donc pas incluse ci-dessus.`,
    nl: `Let op: ${list} zou een van de beste opties zijn geweest voor dit verzoek, maar staat vandaag direct bloot aan de wind, en staat daarom niet hierboven.`
  };
  return templates[lingua];
}

// Nota di trasparenza per il caso "naturismo richiesto nel testo libero ma escluso dal
// profilo": generata come testo fisso (stesso principio anti-invenzione delle note sopra),
// non delegata all'AI. In generateFinalResponse aggiungiamo anche un'istruzione che dice
// esplicitamente all'AI di non affrontare il tema da sola nel corpo della risposta — senza
// quella istruzione l'AI tende a improvvisare affermazioni generiche sul naturismo all'Elba
// non fondate su alcun dato del catalogo (osservato in un test live).
function buildNaturismConflictNote(lingua: Lingua): string {
  const templates: Record<Lingua, string> = {
    it: "Hai menzionato le spiagge naturiste in questa richiesta, ma il tuo profilo è impostato per escluderle: per questo non ne trovi tra i consigli sopra. Puoi cambiare questa preferenza rifacendo l'onboarding.",
    en: "You mentioned naturist beaches in this request, but your profile is set to exclude them, which is why none appear among the recommendations above. You can change this preference by redoing onboarding.",
    de: "Du hast in dieser Anfrage FKK-Strände erwähnt, aber dein Profil ist so eingestellt, dass sie ausgeschlossen werden — deshalb erscheinen oben keine. Du kannst diese Einstellung ändern, indem du das Onboarding wiederholst.",
    fr: "Vous avez mentionné les plages naturistes dans cette demande, mais votre profil est configuré pour les exclure, c'est pourquoi aucune n'apparaît ci-dessus. Vous pouvez modifier cette préférence en refaisant l'onboarding.",
    nl: "Je noemde naturistenstranden in dit verzoek, maar je profiel is ingesteld om ze uit te sluiten, daarom staat er hierboven geen. Je kunt deze voorkeur wijzigen door de onboarding opnieuw te doorlopen."
  };
  return templates[lingua];
}

// Etichette per i motivi di esclusione di una spiaggia nominata esplicitamente nel testo
// libero (vedi buildNamedBeachReminderNote sotto). Coprono sia le hard exclusion (stessi
// codici di HARD_EXCLUSION_RULES in exclusion-layer) sia i due filtri soft di pre-scoring
// (affollamento/vento), qui rinominati CROWDING_LIMIT/WIND_LIMIT per chiarezza dato che non
// sono "esclusioni" in senso stretto ma soglie scelte per la richiesta di oggi.
const EXCLUSION_REASON_LABELS: Record<string, Record<Lingua, string>> = {
  EXCLUDE_NATURISM_UNLESS_EXPLICIT: {
    it: "hai impostato di non voler spiagge naturiste",
    en: "you've set your profile to exclude naturist beaches",
    de: "du hast in deinem Profil FKK-Strände ausgeschlossen",
    fr: "vous avez configuré votre profil pour exclure les plages naturistes",
    nl: "je hebt in je profiel naturistenstranden uitgesloten"
  },
  EXCLUDE_SEA_ONLY_WITHOUT_BOAT: {
    it: "è raggiungibile solo via mare e oggi non hai indicato la barca come mezzo",
    en: "it's reachable only by sea and you haven't indicated a boat as today's transport",
    de: "sie ist nur über das Meer erreichbar und du hast heute kein Boot als Verkehrsmittel angegeben",
    fr: "elle n'est accessible que par la mer et vous n'avez pas indiqué de bateau comme moyen de transport aujourd'hui",
    nl: "deze is alleen bereikbaar via zee en je hebt vandaag geen boot als vervoermiddel opgegeven"
  },
  EXCLUDE_STEEP_TRAIL_IF_MOBILITY_NOT_HIGH: {
    it: "richiede un sentiero impegnativo oltre il livello di mobilità che hai indicato",
    en: "it requires a demanding trail beyond the mobility level you've indicated",
    de: "sie erfordert einen anspruchsvollen Weg, der über das von dir angegebene Mobilitätsniveau hinausgeht",
    fr: "elle nécessite un sentier exigeant au-delà du niveau de mobilité que vous avez indiqué",
    nl: "hier is een veeleisend pad nodig dat verder gaat dan het door jou aangegeven mobiliteitsniveau"
  },
  CROWDING_LIMIT: {
    it: "supera la soglia di affollamento che tolleri oggi",
    en: "it exceeds the crowding level you're willing to tolerate today",
    de: "sie überschreitet die heute tolerierte Besucherdichte",
    fr: "elle dépasse le niveau de fréquentation que vous tolérez aujourd'hui",
    nl: "deze overschrijdt het drukte-niveau dat je vandaag tolereert"
  },
  WIND_LIMIT: {
    it: "è oggi direttamente esposta al vento che hai indicato",
    en: "it's directly exposed to the wind direction you named today",
    de: "sie ist heute direkt dem von dir genannten Wind ausgesetzt",
    fr: "elle est aujourd'hui directement exposée au vent que vous avez mentionné",
    nl: "deze staat vandaag direct bloot aan de door jou genoemde windrichting"
  },
  UNKNOWN: {
    it: "non rientra nei criteri impostati per questa richiesta",
    en: "it doesn't meet the criteria set for this request",
    de: "sie erfüllt nicht die für diese Anfrage festgelegten Kriterien",
    fr: "elle ne correspond pas aux critères définis pour cette demande",
    nl: "deze voldoet niet aan de criteria die voor dit verzoek zijn ingesteld"
  }
};

function formatReasonList(labels: string[], lingua: Lingua): string {
  if (labels.length === 1) return labels[0];
  const last = labels[labels.length - 1];
  const rest = labels.slice(0, -1).join(", ");
  const conjunction: Record<Lingua, string> = { it: "e", en: "and", de: "und", fr: "et", nl: "en" };
  return `${rest} ${conjunction[lingua]} ${last}`;
}

function buildNamedBeachReminderNote(nome: string, reasonCodes: string[], lingua: Lingua): string {
  const labels = (reasonCodes.length > 0 ? reasonCodes : ["UNKNOWN"]).map(
    (code) => (EXCLUSION_REASON_LABELS[code] ?? EXCLUSION_REASON_LABELS.UNKNOWN)[lingua]
  );
  const reasonsText = formatReasonList(labels, lingua);
  const templates: Record<Lingua, string> = {
    it: `Hai chiesto informazioni su ${nome}: ${reasonsText}, quindi non rientra tra i consigli in base alle tue preferenze attuali. Ecco comunque qualche informazione su questa spiaggia.`,
    en: `You asked about ${nome}: ${reasonsText}, so it doesn't appear among the recommendations based on your current preferences. Here's some information about it anyway.`,
    de: `Du hast nach ${nome} gefragt: ${reasonsText}, daher erscheint sie nicht unter den Empfehlungen basierend auf deinen aktuellen Einstellungen. Hier trotzdem ein paar Informationen dazu.`,
    fr: `Vous avez demandé des informations sur ${nome} : ${reasonsText}, elle n'apparaît donc pas parmi les recommandations selon vos préférences actuelles. Voici tout de même quelques informations à son sujet.`,
    nl: `Je vroeg naar ${nome}: ${reasonsText}, daarom staat deze niet tussen de aanbevelingen op basis van je huidige voorkeuren. Hier is toch wat informatie erover.`
  };
  return templates[lingua];
}

// Descrizione dedicata per una spiaggia nominata esplicitamente ma esclusa: chiamata AI
// separata e minima, non mescolata alla risposta principale. Riusa lo stesso principio di
// grounding del prompt principale (solo campi presenti nei dati, mai orari specifici) ma
// isolata cosi' il codice puo' concatenare in modo affidabile promemoria fisso + descrizione,
// invece di dover "estrarre" una sezione da un'unica risposta lunga.
async function generateNamedBeachDescription(detail: ShortlistBeachDetail, lingua: Lingua): Promise<string> {
  const targetLanguage = LANGUAGE_MAP[lingua];
  const system = [
    "You are the YourElba Conversation Layer.",
    `Reply only in ${targetLanguage}, as a single flowing paragraph (no headers, no bullet points, no JSON).`,
    "Write a self-contained description of this beach in roughly 3-5 sentences: what makes it distinctive, its most notable practical trait, and one concrete tip if the data supports it.",
    "Ground every factual claim ONLY in the JSON data provided below — never invent orientation, wind exposure, opening hours, or any detail not present in the fields.",
    "Never state a specific clock time (e.g. 'by 9:00', 'entro le 9:30') — no field records real-time crowd patterns at that precision; use only qualitative timing language grounded in 'affollamento' if present.",
    "If a field is missing or null, do not guess or imply a value for it — simply omit that aspect.",
    "Do not mention or apologize for the fact that this beach doesn't match the user's preferences — that part is handled separately; just describe the beach factually."
  ].join(" ");

  const prompt = JSON.stringify({ beach: detail }, null, 2);

  const raw = await sendAnthropicMessage({
    system,
    prompt,
    maxTokens: 500,
    temperature: 0.5
  });

  return stripInventedClockTimes(raw.trim());
}

async function buildNamedBeachBlocks(entries: NamedBeachExclusionEntry[], lingua: Lingua): Promise<string[]> {
  return Promise.all(
    entries.map(async (entry) => {
      const reminder = buildNamedBeachReminderNote(entry.detail.nome, entry.reasonCodes, lingua);
      const description = await generateNamedBeachDescription(entry.detail, lingua);
      return `${reminder} ${description}`;
    })
  );
}

const CLOSING_ALTERNATIVES_OFFER: Record<Lingua, string> = {
  it: "Se vuoi, posso cercarti alcune spiagge che rispecchiano le tue preferenze attuali: fammelo sapere.",
  en: "If you'd like, I can look for some beaches that match your current preferences — just let me know.",
  de: "Wenn du magst, suche ich dir gerne ein paar Strände, die zu deinen aktuellen Einstellungen passen — sag einfach Bescheid.",
  fr: "Si vous le souhaitez, je peux vous chercher des plages qui correspondent à vos préférences actuelles — dites-le-moi.",
  nl: "Als je wilt, zoek ik graag een paar stranden die passen bij je huidige voorkeuren — laat het me weten."
};

export interface ConflictOnlyInput {
  lingua: Lingua;
  namedBeachExclusions?: NamedBeachExclusionEntry[];
  naturismPreferenceConflict?: boolean;
}

// Quando la richiesta di oggi entra in conflitto con una preferenza gia' impostata (spiaggia
// nominata esclusa, o naturismo chiesto ma escluso dal profilo), NON generiamo piu' un'intera
// risposta con raccomandazioni alternative non richieste: un test live ha mostrato che l'utente
// si aspetta prima una risposta diretta alla sua domanda (promemoria del motivo + descrizione,
// nell'ordine — mai relegati in coda), e SOLO SE lo desidera puo' chiedere alternative in un
// secondo momento. Questa funzione salta del tutto la chiamata AI di ranking/raccomandazione
// principale: piu' economica ed evita che l'AI riproponga di sua iniziativa un'intera giornata
// di spiagge non richieste.
export async function generateConflictOnlyResponse(input: ConflictOnlyInput): Promise<string> {
  const namedBeachEntries = input.namedBeachExclusions ?? [];
  const namedBeachBlocks = namedBeachEntries.length > 0 ? await buildNamedBeachBlocks(namedBeachEntries, input.lingua) : [];
  const naturismNote = input.naturismPreferenceConflict === true ? buildNaturismConflictNote(input.lingua) : null;

  const blocks = [...namedBeachBlocks, naturismNote, CLOSING_ALTERNATIVES_OFFER[input.lingua]].filter(
    (block): block is string => Boolean(block)
  );
  return blocks.join("\n\n");
}

export async function generateFinalResponse(input: ConversationInput): Promise<string> {
  const targetLanguage = LANGUAGE_MAP[input.lingua];
  const plan = input.itineraryPlan ?? null;
  const hasMultiDayPlan = plan !== null && plan.giorni > 1;

  // Le liste di spiagge escluse per affollamento/vento NON vengono piu' passate all'AI da
  // menzionare in prosa (vedi buildCrowdingTransparencyNote/buildWindTransparencyNote sopra):
  // il testo di trasparenza viene generato deterministicamente e aggiunto in coda dopo la
  // risposta dell'AI.
  const crowdingLimitNames = input.beachesExcludedByCrowdingLimit ?? [];
  const windLimitNames = input.beachesExcludedByWind ?? [];
  const namedBeachEntries = input.namedBeachExclusions ?? [];
  const naturismConflict = input.naturismPreferenceConflict === true;

  // Le due istruzioni sotto impediscono all'AI di improvvisare quando la richiesta di oggi
  // tocca un tema gia' escluso da una preferenza impostata (naturismo) o nomina esplicitamente
  // una spiaggia che non e' tra i candidati (shortlist_beach_details): un test live ha mostrato
  // l'AI, senza questa istruzione, inventare affermazioni non fondate sui dati (naturismo) o
  // reinterpretare la spiaggia nominata come "base" per un giro con altre spiagge (Biodola),
  // invece di rispondere direttamente alla domanda. Le risposte corrette a entrambi i casi sono
  // generate deterministicamente altrove (vedi buildNaturismConflictNote/buildNamedBeachBlocks)
  // e aggiunte in coda: qui diciamo solo all'AI di non occuparsene nel corpo principale.
  const naturismSuppressionInstruction = naturismConflict
    ? "The user's request mentions naturism/naturist beaches, but their current profile preference excludes them, so none are among your candidates. Do not make any claims about whether naturist beaches exist on the island, are officially designated, or where informal naturism happens — you have no verified data on this topic and any such claim would be invented. Do not address the naturism topic at all in your response; an accurate note about it is appended automatically afterwards. Simply write your normal recommendations based on the rest of the request."
    : "";
  const namedBeachSuppressionInstruction =
    namedBeachEntries.length > 0
      ? `The request also explicitly names ${namedBeachEntries.map((e) => e.detail.nome).join(", ")}, which currently do not meet the user's set preferences and are therefore absent from 'shortlist_beach_details'. Do not describe, recommend, or build any part of your response around these beaches, and do not use them as a "base" for suggesting nearby alternatives. Simply proceed with your normal recommendations based on the rest of the request; accurate information about these beaches is appended automatically afterwards.`
      : "";

  const itineraryInstruction = hasMultiDayPlan
    ? `The user explicitly asked for a ${plan!.giorni}-day plan with ${plan!.slotsPerDay} beach pick(s) per day (${plan!.totalSlots} distinct beaches total). The shortlist below already contains exactly the beaches needed to cover this. You MUST present all ${plan!.giorni} days in this single response — one section per day, assigning the shortlist beaches in order (the first ${plan!.slotsPerDay} item(s) are Day 1, the next ${plan!.slotsPerDay} are Day 2, and so on). Do not stop after Day 1 and do not tell the user to "ask again tomorrow" or "ask again for the next day" — the full plan must be delivered now, in one go. Only fall back to covering fewer days if the shortlist genuinely contains fewer than ${plan!.totalSlots} distinct beaches, in which case say so plainly instead of stretching or repeating beaches.`
    : "The user's request does not specify a multi-day plan, so answer only for the relevant occasion (e.g. today/tomorrow) with your top pick(s) plus 1-2 alternatives — do not invent extra days.";

  // 'shortlist_beach_details' e 'shortlist_internal_en' arrivano gia' nell'ordine corretto e
  // definitivo (per le richieste non multi-giorno, e' l'ordine per preScore deciso a monte in
  // ai-ranking.ts, non piu' rinegoziabile qui). Un test live ha mostrato che, anche dopo aver
  // fissato quell'ordine nel codice, la sezione "Raccomandazioni" (generata dal codice)
  // mostrava correttamente Sant'Andrea al primo posto mentre il testo scritto da questo layer
  // presentava ancora Contessa come "scelta del giorno" — il layer di conversazione stava
  // scegliendo da solo il protagonista invece di seguire l'ordine dato. Da qui l'istruzione
  // esplicita sotto.
  const orderInstruction = hasMultiDayPlan
    ? ""
    : "Each beach in 'shortlist_beach_details' has a 'posizione' field (1, 2, 3...): this is the final, already-decided priority order, not a suggestion. The beach with posizione=1 is your main recommendation ('consiglio principale'/top pick) and must be presented first and most prominently; present the rest as alternatives afterward in ascending posizione order. This was already determined upstream — do not promote a beach with posizione=2 or higher to the top position based on your own judgment of which one seems best, and do not silently reorder them.";

  // Non impone piu' un tetto di parole TOTALE da spartire tra le spiagge (che assottiglia ogni
  // descrizione quando le spiagge aumentano). Da' invece una specifica di contenuto PER
  // SINGOLA spiaggia: la lunghezza risultante scala naturalmente con il numero di spiagge,
  // invece di essere compressa da un tetto complessivo fisso.
  const perBeachContentInstruction =
    "For each beach you present (regardless of how many beaches are in the plan), write a self-contained description of roughly 3-5 sentences covering: (1) why it fits this specific request and profile, (2) its most distinctive trait or what makes it unique on the island (mention a 'puntoDiForza' naturally, phrased in plain language, when present), (3) one concrete practical tip (timing, access, what to bring). Keep this same level of care and detail per beach whether the plan covers 1 day or 7 — do not thin out or compress descriptions just because there are more beaches to cover. Avoid filler and repeated boilerplate phrasing across days, but do not sacrifice the substance above for brevity.";

  const system = [
    "You are the YourElba Conversation Layer.",
    "Generate the final user-facing recommendation message.",
    "Use warm, direct tone.",
    `Always reply in ${targetLanguage}.`,
    "Do not output JSON.",
    "Ground every factual claim (beach name, zone, sun/wind exposure) only in 'shortlist_beach_details'.",
    "Never invent or assume a beach's orientation, sunset visibility, or wind exposure beyond what that data states.",
    "If exposure data is missing or ambiguous for a beach, do not make specific directional claims about it.",
    "If today's request mentions a specific current wind direction (e.g. 'vento da nord'), only claim a beach is sheltered from it if that beach's own 'esposizione_venti' text literally names that same direction (e.g. 'riparata dai venti settentrionali' supports a claim about a NORTH wind only). Do not infer shelter from a different wind than the one written in esposizione_venti just because esposizione_cardinale geometrically seems to face away from it — that is a guess, not data. This applies to every beach you mention, including alternatives: if an alternative pick's esposizione_venti names a different wind than today's, say plainly that it is not specifically sheltered from today's wind (and explain why you're still suggesting it, e.g. a strong overall fit) rather than implying it shares the top pick's wind protection.",
    "If the user's request has conflicting needs (e.g. shelter from a wind direction vs. wanting a sunset view over the sea, which need opposite-ish exposures), say so plainly: name the trade-off and explain briefly why the chosen beach is the best compromise, instead of implying it fully satisfies both.",
    "Match each description strictly to its own spiaggia_id and nome in 'shortlist_beach_details'. Beaches with similar names (e.g. 'Stecchi Uno' vs 'Stecchi Due') can have different tags/crowd levels even with the same exposure — never swap details between them. Double-check the name you write corresponds to the id you are describing, in shortlist order.",
    "If a beach's 'puntiDiForza' in 'shortlist_beach_details' includes a category relevant to the request (e.g. snorkeling_immersione, belle_spettacolari), this means the destination expert hand-scored it 3/3 (the maximum) for that trait — a verified standout, not a generic match. You may mention this as a genuine highlight, phrased naturally (not as a raw category name).",
    "For any practical tip about how to get there, parking, or access, ground it ONLY in that beach's 'indicazioni' field (real directions written by the destination expert) and 'difficoltaAccesso'/'raggiungibileViaTerra' (access difficulty). If 'indicazioni' is missing or empty for a beach, do not invent driving routes or parking advice for it.",
    "Never state a specific clock time as arrival/parking advice (e.g. 'arrive by 9:00', 'entro le 9:30', 'before 8:30') — no data field records opening hours or real-time crowd patterns at that precision, so any specific hour you write is invented and can be actively wrong (a beach can fill up earlier or later than any number you'd guess). If a beach's 'affollamento.livelloGenerale' or 'affollamento.note' implies it fills up, give ONLY qualitative timing advice grounded in that field (e.g. 'è tra le più affollate: conviene arrivare presto in giornata' or 'si riempie rapidamente in alta stagione') — never manufacture a precise hour.",
    "Use 'noteQualitative' (the expert's own narrative notes) as your best source for what makes a beach distinctive or unique, and 'tipoFondale'/'lunghezzaM' for concrete physical details — prefer these grounded specifics over generic adjectives.",
    "If the request or profile mentions dogs or reduced mobility, only make claims about 'caniAmmessi' or 'accessibilitaDisabili' when that field is present and non-null for the beach in question; if it's null/missing, say plainly that this information isn't available rather than assuming either way.",
    itineraryInstruction,
    orderInstruction,
    perBeachContentInstruction,
    naturismSuppressionInstruction,
    namedBeachSuppressionInstruction
  ]
    .filter(Boolean)
    .join(" ");

  const prompt = JSON.stringify(
    {
      richiesta_del_giorno: input.richiestaDelGiorno,
      profile: input.profile,
      interpretation_internal_en: input.interpretation,
      itinerary_plan: plan,
      shortlist_internal_en: input.shortlist,
      shortlist_beach_details: input.shortlistBeachDetails,
      response_requirements: {
        structure: hasMultiDayPlan
          ? ["quick opening", "one section per day, each following the per-beach content guidance", "closing note"]
          : ["quick opening", "top recommendation(s), each following the per-beach content guidance", "closing note"],
        style: "friendly, concise, actionable — length follows from the per-beach content guidance, not from a total word target"
      }
    },
    null,
    2
  );

  // maxTokens qui e' solo un tetto tecnico di sicurezza (evita risposte tagliate a meta'), non
  // una leva di stile: la lunghezza effettiva la decide la specifica di contenuto per spiaggia
  // sopra. Scala sul numero REALE di spiagge nello shortlist (non solo sui giorni rilevati),
  // cosi' regge anche richieste come "le 7 spiagge" che non vengono riconosciute come piano
  // multi-giorno ma restituiscono comunque piu' spiagge da descrivere per intero.
  const beachCount = Math.max(1, input.shortlist.length);
  const safetyMaxTokens = Math.min(8000, 1200 + beachCount * 500);

  const rawAiResponse = await sendAnthropicMessage({
    system,
    prompt,
    maxTokens: safetyMaxTokens,
    temperature: 0.5
  });

  const aiResponse = stripInventedClockTimes(rawAiResponse);

  // Le descrizioni delle spiagge nominate esplicitamente richiedono una chiamata AI dedicata
  // (vedi generateNamedBeachDescription) — fatta qui, dopo la risposta principale, cosi' le due
  // non si mescolano e il promemoria che le precede resta un testo fisso e affidabile.
  const namedBeachBlocks = namedBeachEntries.length > 0 ? await buildNamedBeachBlocks(namedBeachEntries, input.lingua) : [];

  // Note di trasparenza aggiunte deterministicamente in coda (vedi commento sopra sul perche'
  // non sono piu' delegate all'AI): sempre esatte per costruzione, mai un elenco reinventato.
  const transparencyNotes = [
    crowdingLimitNames.length > 0 ? buildCrowdingTransparencyNote(crowdingLimitNames, input.lingua) : null,
    windLimitNames.length > 0 ? buildWindTransparencyNote(windLimitNames, input.lingua) : null,
    naturismConflict ? buildNaturismConflictNote(input.lingua) : null,
    ...namedBeachBlocks
  ].filter((note): note is string => Boolean(note));

  if (transparencyNotes.length === 0) return aiResponse;
  return `${aiResponse}\n\n${transparencyNotes.join("\n\n")}`;
}
