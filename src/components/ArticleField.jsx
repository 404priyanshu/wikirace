import { Check, LoaderCircle, Search } from "lucide-react";
import { useState } from "react";
import { useWikipediaSearch } from "../hooks/useWikipediaSearch";

export function ArticleField({ label, value, onChange, disabled, accent }) {
  const [focused, setFocused] = useState(false);
  const { results, loading, clear } = useWikipediaSearch(value, focused && !disabled);

  function select(title) {
    onChange(title);
    clear();
    setFocused(false);
  }

  return (
    <label className="article-field" style={{ "--field-accent": accent }}>
      <span className="field-label">{label}</span>
      <span className="field-shell">
        <Search aria-hidden="true" size={15} />
        <input
          aria-label={label}
          value={value}
          disabled={disabled}
          autoComplete="off"
          spellCheck="false"
          onFocus={() => setFocused(true)}
          onBlur={() => window.setTimeout(() => setFocused(false), 120)}
          onChange={(event) => onChange(event.target.value)}
        />
        {loading ? (
          <LoaderCircle className="spin" aria-hidden="true" size={14} />
        ) : (
          <Check className="field-check" aria-hidden="true" size={14} />
        )}
      </span>
      {focused && results.length > 0 && (
        <span className="suggestions">
          {results.map((result) => (
            <button key={result.title} type="button" onMouseDown={() => select(result.title)}>
              <strong>{result.title}</strong>
              {result.description && <small>{result.description}</small>}
            </button>
          ))}
        </span>
      )}
    </label>
  );
}
