import { lazy, Suspense } from "react";
import "../../styles/pages/recap.css";
import { OverlayErrorBoundary } from "../../components/OverlayErrorBoundary";
import { useRecapStore } from "./recapStore";

const RecapStory = lazy(() => import("./RecapStory").then((module) => ({ default: module.RecapStory })));

/** One story at a time, wherever it was opened. */
export function RecapStoryHost() {
  const period = useRecapStore((store) => store.period);
  const close = useRecapStore((store) => store.close);
  if (!period) return null;
  return (
    <OverlayErrorBoundary key={period.id} onFail={close}>
      <Suspense fallback={null}>
        <RecapStory period={period} onClose={close} />
      </Suspense>
    </OverlayErrorBoundary>
  );
}
