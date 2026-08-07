import { sendAnthropicForJson } from "../../core/ai/anthropic-client";
import type { RecommendationUserProfile } from "../recommendation-engine";

export interface InterpretationOutput {
  zona_ammessa: string[];
  intensita_reale: "low" | "medium" | "high";
  tolleranza_cammino_minuti: number;
  vincoli_forti: string[];
  vincoli_morbidi: string[];
  tipo_esperienza_target: string;
}

interface InterpretationInput {
  profile: RecommendationUserProfile;
  richiestaDelGiorno: string;
}

function sanitizeInterpretation(payload: InterpretationOutput): InterpretationOutput {
  const zona = Array.isArray(payload.zona_ammessa) ? payload.zona_ammessa.map((z) => String(z).toLowerCase()) : [];
  const intensita = payload.intensita_reale;
  const safeIntensity = intensita === "low" || intensita === "medium" || intensita === "high" ? intensita : "medium";
  const minutes = Number(payload.tolleranza_cammino_minuti);
  return {
    zona_ammessa: zona,
    intensita_reale: safeIntensity,
    tolleranza_cammino_minuti: Number.isFinite(minutes) ? Math.max(0, Math.round(minutes)) : 15,
    vincoli_forti: Array.isArray(payload.vincoli_forti) ? payload.vincoli_forti.map(String) : [],
    vincoli_morbidi: Array.isArray(payload.vincoli_morbidi) ? payload.vincoli_morbidi.map(String) : [],
    tipo_esperienza_target: String(payload.tipo_esperienza_target ?? "balanced_beach_day")
  };
}

export async function interpretUserRequest(input: InterpretationInput): Promise<InterpretationOutput> {
  const system = [
    "You are the YourElba Interpretation Layer.",
    "Always reason in English and output only one JSON object.",
    "Do not add markdown, prose, or extra keys.",
    "Use exactly these keys:",
    "zona_ammessa, intensita_reale, tolleranza_cammino_minuti, vincoli_forti, vincoli_morbidi, tipo_esperienza_target.",
    "'Zona di soggiorno' in the request text is only where the user is staying, for logistics context. It is NOT a request to stay in that zone.",
    "Only restrict zona_ammessa to specific zones when the user explicitly asks for a direction, an area, or says they don't want to travel far.",
    "If the user asks generically for the island's best, most beautiful, or most characteristic beaches (no explicit geographic or travel-distance restriction), set zona_ammessa to all zones so recommendations can span the whole island, and add 'prioritize geographic variety across zones' to vincoli_morbidi."
  ].join(" ");

  const prompt = JSON.stringify(
    {
      task: "Interpret user profile and daily request for recommendation constraints.",
      output_contract: {
        zona_ammessa: ["north", "south", "east", "west", "center"],
        intensita_reale: "low|medium|high",
        tolleranza_cammino_minuti: "integer minutes",
        vincoli_forti: ["non negotiable constraints in English"],
        vincoli_morbidi: ["soft preferences in English"],
        tipo_esperienza_target: "short snake_case label in English"
      },
      input: {
        profile: input.profile,
        richiesta_del_giorno: input.richiestaDelGiorno
      }
    },
    null,
    2
  );

  const interpreted = await sendAnthropicForJson<InterpretationOutput>({
    system,
    prompt,
    maxTokens: 700,
    temperature: 0
  });
  return sanitizeInterpretation(interpreted);
}
