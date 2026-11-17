import { useEffect, useRef } from "react";
import { t } from "../../i18n";

/** Loads the next page when it scrolls into view; the button stays as fallback. */
export function SearchLoadMore({
  loading,
  onLoad,
}: {
  loading: boolean;
  onLoad: () => void;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const load = useRef(onLoad);
  load.current = onLoad;

  useEffect(() => {
    const element = button.current;
    if (!element || loading || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) load.current();
      },
      { rootMargin: "320px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [loading]);

  return (
    <button
      ref={button}
      type="button"
      className="secondary-button load-more search-load-more"
      disabled={loading}
      onClick={onLoad}
    >
      {loading ? t("search.loadingMore") : t("search.loadMore")}
    </button>
  );
}
