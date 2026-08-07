"use client";

import { useEffect, useRef, useState } from "react";
import type { RecommendationsResponse } from "@/lib/types";
import { loadProfile, loadRichiesta, saveProfile, saveRichiesta, saveResults, buildRichiestaGiornoText } from "@/lib/session";
import { fetchRecommendations } from "@/lib/api";
import { renderMarkdown } from "@/lib/markdown";
import {
  STEPS,
  RICHIESTA_STEPS,
  emptyChatState,
  getStepValue,
  setStepValue,
  optionLabel,
  toApiProfile,
  type ChatState,
  type StepDef
} from "./steps";
import { PreferencesPanel } from "./PreferencesPanel";

interface TranscriptItem {
  id: string;
  from: "ai" | "user";
  node: React.ReactNode;
}

type Phase = "flow" | "loading" | "result" | "error";

export function ChatClient() {
  const [state, setState] = useState<ChatState>(emptyChatState);
  const [activeIndex, setActiveIndex] = useState(0);
  const [transcript, setTranscript] = useState<TranscriptItem[]>([]);
  const [pendingMulti, setPendingMulti] = useState<string[]>([]);
  const [textDraft, setTextDraft] = useState("");
  const [phase, setPhase] = useState<Phase>("flow");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [prefsOpen, setPrefsOpen] = useState(false);

  const idRef = useRef(0);
  const nextId = () => `m-${idRef.current++}`;
  const loadingIdRef = useRef<string | null>(null);
  const initedRef = useRef(false);
  const threadEndRef = useRef<HTMLDivElement | null>(null);

  const pushAi = (node: React.ReactNode) => {
    setTranscript((prev) => [...prev, { id: nextId(), from: "ai", node }]);
  };
  const pushUser = (node: React.ReactNode) => {
    setTranscript((prev) => [...prev, { id: nextId(), from: "user", node }]);
  };

  // Init: carica profilo/richiesta salvati (se presenti) come valori di default,
  // poi mostra la prima domanda. Non salta mai le domande: e' un allineamento
  // rapido, non un login.
  useEffect(() => {
    if (initedRef.current) return;
    initedRef.current = true;
    const savedProfile = loadProfile();
    const savedRichiesta = loadRichiesta();
    setState((s) => ({ ...s, ...(savedProfile ?? {}), ...(savedRichiesta ?? {}) }));
    beginStep(STEPS[0], 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [transcript, phase]);

  function beginStep(step: StepDef, index: number, prefillState?: ChatState) {
    const s = prefillState ?? state;
    if (step.kind === "chip-multi") {
      setPendingMulti(Array.isArray(getStepValue(s, step)) ? (getStepValue(s, step) as string[]) : []);
    }
    if (step.kind === "text") {
      const v = getStepValue(s, step);
      setTextDraft(typeof v === "string" ? v : "");
    }
    pushAi(step.question);
    setActiveIndex(index);
  }

  function advanceFrom(index: number) {
    const next = index + 1;
    if (next >= STEPS.length) {
      void handleSubmit();
      return;
    }
    const current = STEPS[index];
    const nextStep = STEPS[next];
    if (current.section === "profilo" && nextStep.section === "richiesta") {
      pushAi("Ora raccontami la tua giornata di oggi.");
    }
    beginStep(nextStep, next);
  }

  function chooseSingle(step: StepDef, index: number, value: string, label: string) {
    setState((s) => setStepValue(s, step, value));
    pushUser(label);
    advanceFrom(index);
  }

  function chooseBoolean(step: StepDef, index: number, value: boolean, label: string) {
    setState((s) => setStepValue(s, step, value));
    pushUser(label);
    advanceFrom(index);
  }

  function toggleMulti(value: string) {
    setPendingMulti((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));
  }

  function confirmMulti(step: StepDef, index: number) {
    setState((s) => setStepValue(s, step, pendingMulti));
    pushUser(optionLabel(step, pendingMulti));
    advanceFrom(index);
  }

  function confirmText(step: StepDef, index: number, value: string) {
    setState((s) => setStepValue(s, step, value));
    pushUser(value.trim() ? value.trim() : "(nessuna nota)");
    advanceFrom(index);
  }

  async function handleSubmit() {
    setPhase("loading");
    setErrorMsg(null);
    const loadingId = nextId();
    loadingIdRef.current = loadingId;
    setTranscript((prev) => [...prev, { id: loadingId, from: "ai", node: "Sto cercando le spiagge migliori per te…" }]);

    // Salviamo lo stato corrente cosi' torna precompilato anche nelle pagine
    // classiche di onboarding/richiesta (stesso localStorage, stesso formato).
    saveProfile(state);
    saveRichiesta(state);

    try {
      const richiesta_giorno = buildRichiestaGiornoText(state, state);
      const data = await fetchRecommendations({
        profile: toApiProfile(state),
        richiesta_giorno,
        affollamento_massimo: state.affollamento_massimo,
        limit: 10
      });
      saveResults(data);
      setTranscript((prev) => prev.filter((t) => t.id !== loadingIdRef.current));
      pushAi(<ResultBubble data={data} />);
      setPhase("result");
    } catch (e) {
      setTranscript((prev) => prev.filter((t) => t.id !== loadingIdRef.current));
      const msg = e instanceof Error ? e.message : "Errore di rete";
      setErrorMsg(msg);
      pushAi(`Non sono riuscito a completare la richiesta (${msg}).`);
      setPhase("error");
    }
  }

  function startNewRichiesta() {
    setState((s) => ({
      ...s,
      fascia_oraria: "mattina",
      camminata_oggi: "media",
      durata: "mezza_giornata",
      tipo_richiesta: "mix",
      affollamento_massimo: "medio",
      testo_libero: ""
    }));
    setErrorMsg(null);
    pushAi("Va bene, dimmi la nuova richiesta di oggi.");
    const first = RICHIESTA_STEPS[0];
    const idx = STEPS.findIndex((s) => s.id === first.id);
    beginStep(first, idx);
    setPhase("flow");
  }

  function editStep(id: keyof ChatState) {
    const idx = STEPS.findIndex((s) => s.id === id);
    if (idx < 0) return;
    setPrefsOpen(false);
    setErrorMsg(null);
    pushAi(`Va bene, aggiorniamo questa risposta: ${STEPS[idx].question}`);
    beginStep(STEPS[idx], idx, state);
    setPhase("flow");
  }

  const activeStep = phase === "flow" ? STEPS[activeIndex] : null;

  return (
    <div className="card chat-card">
      <div className="chat-topbar">
        <div>
          <h2 style={{ margin: 0 }}>La tua giornata all&apos;Elba</h2>
          <p className="lead" style={{ margin: "0.15rem 0 0" }}>
            Rispondi come in una chat: bastano pochi tocchi.
          </p>
        </div>
        <button type="button" className="btn btn-ghost chat-prefs-btn" onClick={() => setPrefsOpen(true)}>
          Preferenze
        </button>
      </div>

      <div className="chat-thread">
        {transcript.map((item) => (
          <div key={item.id} className={`chat-bubble ${item.from}`}>
            {item.node}
          </div>
        ))}
        <div ref={threadEndRef} />
      </div>

      {activeStep && (
        <div className="chat-composer">
          {(activeStep.kind === "chip-single" || activeStep.kind === "boolean") && (
            <div className="row">
              {activeStep.options?.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  className="chip"
                  onClick={() =>
                    activeStep.kind === "boolean"
                      ? chooseBoolean(activeStep, activeIndex, o.value === "true", o.label)
                      : chooseSingle(activeStep, activeIndex, o.value, o.label)
                  }
                >
                  {o.label}
                </button>
              ))}
            </div>
          )}

          {activeStep.kind === "chip-multi" && (
            <>
              <div className="row">
                {activeStep.options?.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    className={`chip ${pendingMulti.includes(o.value) ? "selected" : ""}`}
                    onClick={() => toggleMulti(o.value)}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              <div className="nav-actions">
                <button type="button" className="btn btn-primary" onClick={() => confirmMulti(activeStep, activeIndex)}>
                  Continua
                </button>
              </div>
            </>
          )}

          {activeStep.kind === "text" && (
            <div className="chat-text-composer">
              <input
                type="text"
                value={textDraft}
                onChange={(e) => setTextDraft(e.target.value)}
                placeholder={activeStep.placeholder}
                autoComplete="off"
              />
              <div className="nav-actions">
                {!activeStep.required && (
                  <button type="button" className="btn btn-ghost" onClick={() => confirmText(activeStep, activeIndex, "")}>
                    Salta
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={activeStep.required && !textDraft.trim()}
                  onClick={() => confirmText(activeStep, activeIndex, textDraft)}
                >
                  Continua
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {phase === "result" && (
        <div className="chat-composer">
          <div className="row">
            <button type="button" className="chip" onClick={startNewRichiesta}>
              Nuova richiesta
            </button>
          </div>
        </div>
      )}

      {phase === "error" && (
        <div className="chat-composer">
          <div className="row">
            <button type="button" className="chip" onClick={() => void handleSubmit()}>
              Riprova
            </button>
          </div>
        </div>
      )}

      {prefsOpen && <PreferencesPanel state={state} onEdit={editStep} onClose={() => setPrefsOpen(false)} />}
    </div>
  );
}

function ResultBubble({ data }: { data: RecommendationsResponse }) {
  return (
    <div>
      <div className="conversation">{renderMarkdown(data.final_response)}</div>
      {data.recommendations.length > 0 && (
        <div className="chat-rec-list">
          {data.recommendations.slice(0, 5).map((rec, i) => (
            <div key={`${rec.spiaggia_id}-${i}`} className="chat-rec-card">
              <strong>
                {i + 1}. {rec.nome}
              </strong>
              <span className="chat-rec-meta">
                {rec.attivita} · score {rec.rank_score.toFixed(2)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
