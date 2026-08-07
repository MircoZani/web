"use client";

import { PROFILE_STEPS, getStepValue, type ChatState } from "./steps";

interface PreferencesPanelProps {
  state: ChatState;
  onEdit: (id: keyof ChatState) => void;
  onClose: () => void;
}

export function PreferencesPanel({ state, onEdit, onClose }: PreferencesPanelProps) {
  return (
    <div className="prefs-backdrop" onClick={onClose}>
      <div className="prefs-panel" onClick={(e) => e.stopPropagation()}>
        <div className="prefs-panel-header">
          <h3 style={{ margin: 0 }}>Le tue preferenze</h3>
          <button type="button" className="btn btn-ghost" onClick={onClose} aria-label="Chiudi">
            Chiudi
          </button>
        </div>
        <p className="lead" style={{ margin: "0.25rem 0 1rem" }}>
          Puoi modificarle in qualsiasi momento: la risposta attuale è evidenziata.
        </p>

        <div className="prefs-list">
          {PROFILE_STEPS.map((step) => {
            const value = getStepValue(state, step);
            return (
              <div key={step.id} className="prefs-row">
                <div className="prefs-row-header">
                  <span className="prefs-row-label">{step.shortLabel}</span>
                  <button type="button" className="prefs-edit-link" onClick={() => onEdit(step.id)}>
                    Modifica
                  </button>
                </div>

                {step.kind === "text" ? (
                  <p className="prefs-text-value">{typeof value === "string" && value.trim() ? value : "(non specificato)"}</p>
                ) : (
                  <div className="row">
                    {step.options?.map((o) => {
                      const isSelected =
                        step.kind === "boolean"
                          ? (value ? "true" : "false") === o.value
                          : step.kind === "chip-multi"
                          ? Array.isArray(value) && value.includes(o.value)
                          : value === o.value;
                      return (
                        <span key={o.value} className={`chip prefs-chip ${isSelected ? "selected" : ""}`}>
                          {o.label}
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
