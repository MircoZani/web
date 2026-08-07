import { NextResponse } from "next/server";
import { buildRecommendationsResponse } from "@/server/api/recommendations";

// Route handler Next.js: sostituisce il vecchio server Node separato (src/api/server.ts) per
// la parte "/recommendations". Gira lato server (runtime Node, non edge) cosi' fs/path per
// leggere il dataset normalizzato funzionano come prima. Nessuna gestione CORS necessaria:
// frontend e backend sono ora la stessa origine.
export async function POST(request: Request) {
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be valid JSON." }, { status: 400 });
  }

  const { statusCode, payload } = await buildRecommendationsResponse(body);
  return NextResponse.json(payload, { status: statusCode });
}
