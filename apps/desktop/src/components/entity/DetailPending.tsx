import { t } from "../../i18n";
import type { EntitySummary } from "@luft/protocol-types";
import { LoaderCircle } from "lucide-react";
import { DetailHero } from "./DetailHero";

interface DetailPendingProps {
  summary: EntitySummary | undefined;
  kind: string;
  connected: boolean;
  error: boolean;
  capabilityMissing?: boolean;
  errorDetail?: string;
}

export function DetailPending({
  summary,
  kind,
  connected,
  error,
  capabilityMissing = false,
  errorDetail,
}: DetailPendingProps) {
  const name = summary?.name ?? kind;

  return (
    <>
      <DetailHero
        kind={kind}
        name={name}
        subtitle={summary?.subtitle}
        image={summary?.coverUri}
      />

      {capabilityMissing ? (
        <div className="message-card error">
          <div>
            <strong>{t("libraryUi.playlistUnavailable")}</strong>

            <p>{t("libraryUi.reconnectHint")}</p>
          </div>
        </div>
      ) : (
        <div
          className={
            error && connected ? "message-card error" : "library-loading detail-loading"
          }
        >
          {error && connected ? (
            <div>
              <strong>{t("libraryUi.detailsUnavailable")}</strong>

              <p>
                {errorDetail
                  ?? t("libraryUi.reopenHint")}
              </p>
            </div>
          ) : (
            <>
              <LoaderCircle size={20} />

              {connected
                ? t("libraryUi.detailsLoading")
                : t("library.connecting")}
            </>
          )}
        </div>
      )}
    </>
  );
}
