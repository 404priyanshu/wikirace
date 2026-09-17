import { ArrowRight, Flag, Play } from "lucide-react";
import { ArticleField } from "./ArticleField";

export function RaceSetup({
  start,
  target,
  maxHops,
  onStartChange,
  onTargetChange,
  onMaxHopsChange,
  onStart,
  disabled,
}) {
  const ready = start.trim() && target.trim() && start.trim() !== target.trim();
  return (
    <form
      className="race-setup"
      onSubmit={(event) => {
        event.preventDefault();
        if (ready && !disabled) onStart();
      }}
    >
      <ArticleField
        label="START ARTICLE"
        value={start}
        onChange={onStartChange}
        disabled={disabled}
        accent="var(--blue)"
      />
      <ArrowRight className="route-arrow" aria-hidden="true" size={18} />
      <ArticleField
        label="TARGET ARTICLE"
        value={target}
        onChange={onTargetChange}
        disabled={disabled}
        accent="var(--lime)"
      />
      <label className="hop-field">
        <span className="field-label">MAX HOPS</span>
        <span className="field-shell">
          <Flag aria-hidden="true" size={14} />
          <input
            aria-label="Maximum hops"
            type="number"
            min="1"
            max="30"
            value={maxHops}
            disabled={disabled}
            onChange={(event) => onMaxHopsChange(Number(event.target.value))}
          />
        </span>
      </label>
      <button className="start-button" type="submit" disabled={!ready || disabled}>
        <Play aria-hidden="true" size={16} fill="currentColor" />
        {disabled ? "RACING" : "START RACE"}
      </button>
    </form>
  );
}
