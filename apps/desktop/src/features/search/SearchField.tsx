import { LoaderCircle, Search, X } from "lucide-react";
import { t } from "../../i18n";
import { useUiStore } from "../../stores/uiStore";
import { parseSpotifyLink } from "../links/spotifyLink";
import type {
  KeyboardEvent,
  RefObject,
} from "react";

type SearchFieldProps = {
  inputRef: RefObject<HTMLInputElement | null>;
  value: string;
  onChange: (value: string) => void;
  onSubmit?: ((value: string) => void) | undefined;
  loading?: boolean | undefined;
  inputPending?: boolean | undefined;
  resultCount?: number | undefined;
  /** Arrow down leaves the field for the first result. */
  onFocusResults?: (() => void) | undefined;
};

export function SearchField({
  inputRef,
  value,
  onChange,
  onSubmit,
  loading = false,
  inputPending,
  resultCount,
  onFocusResults,
}: SearchFieldProps) {
  const pending = inputPending ?? loading;
  const submit = () => {
    const normalized = value.trim().replace(/\s+/g, " ");

    if (normalized) {
      onSubmit?.(normalized);
    }
  };

  const handleKeyDown = (
    event: KeyboardEvent<HTMLInputElement>,
  ) => {
    if (event.key === "ArrowDown" && onFocusResults) {
      event.preventDefault();
      onFocusResults();
      return;
    }

    if (event.key !== "Escape") {
      return;
    }

    event.stopPropagation();

    if (value) {
      onChange("");
      return;
    }

    event.currentTarget.blur();
  };

  return (
    <form
      className="search-field"
      role="search"
      aria-label={t("search.aria")}
      aria-busy={pending}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <Search
        className="search-field-icon"
        size={21}
        aria-hidden="true"
      />

      <label className="sr-only" htmlFor="spotify-search-input">
        {t("search.label")}
      </label>

      <input
        id="spotify-search-input"
        ref={inputRef}
        value={value}
        maxLength={200}
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="search"
        onChange={(event) =>
          onChange(event.currentTarget.value)
        }
        onKeyDown={handleKeyDown}
        onPaste={(event) => {
          // Searching for a link finds nothing; the palette opens what it points to.
          const text = event.clipboardData.getData("text/plain");
          if (!parseSpotifyLink(text)) return;
          event.preventDefault();
          useUiStore.getState().openCommandPaletteWith(text.trim());
        }}
        placeholder={t("search.placeholder")}
      />

      <span className="search-field-trailing">
        {pending && (
          <LoaderCircle
            className="search-field-spinner"
            size={17}
            aria-label={t("search.searching")}
          />
        )}

        {!pending &&
          value &&
          resultCount !== undefined && (
            <span className="search-field-count">
              {t("search.resultCount", { n: resultCount })}
            </span>
          )}

        {value && (
          <button
            type="button"
            onClick={() => {
              onChange("");
              inputRef.current?.focus();
            }}
            aria-label={t("search.clear")}
          >
            <X size={17} />
          </button>
        )}
      </span>
    </form>
  );
}
