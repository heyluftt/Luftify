import { Library, LoaderCircle } from "lucide-react";
import { libraryPhaseLabel, type LibraryPhase } from "./libraryState";

export function LibraryStatus({ phase }: { phase: LibraryPhase }) {
  if (phase === "ready") return null;

  return (
    <span className={`library-status ${phase}`} role="status" aria-live="polite">
      {phase === "refreshing-cache" && <LoaderCircle size={13} />}
      {libraryPhaseLabel(phase)}
    </span>
  );
}

export function LibraryPlaceholder({ phase }: { phase: LibraryPhase }) {
  if (phase === "error" || phase === "needs-login") {
    return (
      <div className="empty-inline">
        <Library size={20} />
        {libraryPhaseLabel(phase)}
      </div>
    );
  }

  return (
    <div className="library-loading" role="status">
      <LoaderCircle size={20} />
      {libraryPhaseLabel(phase)}
    </div>
  );
}
