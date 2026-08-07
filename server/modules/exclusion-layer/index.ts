export type MobilityLevel = "alta" | "media" | "bassa";
export type TrailDifficulty = "easy_or_none" | "moderate" | "steep" | "very_steep_or_impervious";
export type Reachability = "land" | "sea_only" | "unknown";

export type MezzoTrasporto = "auto" | "scooter" | "bus" | "barca" | "a_piedi";

export interface ExclusionUserProfile {
  mobilita_livello?: MobilityLevel;
  mobilita_ridotta?: boolean;
  richiesta_esplicita_naturismo?: boolean;
  // Mezzo di trasporto usato in giornata. Se "barca", l'utente puo' raggiungere
  // le spiagge raggiungibili solo via mare: non vanno escluse a priori.
  mezzo_trasporto?: MezzoTrasporto;
}

export interface ExclusionBeach {
  id: string;
  nome: string;
  info_pratiche: {
    reachability?: Reachability;
    naturismo_tollerato?: boolean;
    trail_difficulty?: TrailDifficulty;
  };
}

export interface ExclusionResult<T extends ExclusionBeach = ExclusionBeach> {
  included: T[];
  excluded: Array<{
    beach: T;
    reasons: string[];
  }>;
}

// Hardcoded business rules required by MVP brief.
const HARD_EXCLUSION_RULES = {
  EXCLUDE_SEA_ONLY_WITHOUT_BOAT: "EXCLUDE_SEA_ONLY_WITHOUT_BOAT",
  EXCLUDE_NATURISM_UNLESS_EXPLICIT: "EXCLUDE_NATURISM_UNLESS_EXPLICIT",
  EXCLUDE_STEEP_TRAIL_IF_MOBILITY_NOT_HIGH: "EXCLUDE_STEEP_TRAIL_IF_MOBILITY_NOT_HIGH"
} as const;

function resolveMobilityLevel(profile: ExclusionUserProfile): MobilityLevel {
  if (profile.mobilita_livello) return profile.mobilita_livello;
  if (profile.mobilita_ridotta === true) return "bassa";
  return "media";
}

export function applyHardExclusions<T extends ExclusionBeach>(
  beaches: T[],
  profile: ExclusionUserProfile
): ExclusionResult<T> {
  const mobilityLevel = resolveMobilityLevel(profile);
  const explicitNaturism = profile.richiesta_esplicita_naturismo === true;
  const hasBoatAccess = profile.mezzo_trasporto === "barca";

  const included: T[] = [];
  const excluded: ExclusionResult<T>["excluded"] = [];

  for (const beach of beaches) {
    const reasons: string[] = [];
    const reachability = beach.info_pratiche.reachability;
    const naturism = beach.info_pratiche.naturismo_tollerato === true;
    const trailDifficulty = beach.info_pratiche.trail_difficulty;

    // Rule 1: exclude sea-only beaches unless the user is moving by boat today.
    if (reachability === "sea_only" && !hasBoatAccess) {
      reasons.push(HARD_EXCLUSION_RULES.EXCLUDE_SEA_ONLY_WITHOUT_BOAT);
    }

    // Rule 2: exclude naturist beaches unless explicitly requested.
    if (naturism && !explicitNaturism) {
      reasons.push(HARD_EXCLUSION_RULES.EXCLUDE_NATURISM_UNLESS_EXPLICIT);
    }

    // Rule 3: very steep/impervious paths require high mobility.
    if (trailDifficulty === "very_steep_or_impervious" && mobilityLevel !== "alta") {
      reasons.push(HARD_EXCLUSION_RULES.EXCLUDE_STEEP_TRAIL_IF_MOBILITY_NOT_HIGH);
    }

    if (reasons.length > 0) {
      excluded.push({ beach, reasons });
    } else {
      included.push(beach);
    }
  }

  return { included, excluded };
}

export { HARD_EXCLUSION_RULES };
