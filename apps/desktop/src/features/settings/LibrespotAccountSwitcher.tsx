import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeftRight, Check, LoaderCircle, Plus } from "lucide-react";
import { useState } from "react";
import { desktopApi } from "../../services/desktopApi";
import { t } from "../../i18n";

export function LibrespotAccountSwitcher({ disabled }: { disabled: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const accounts = useQuery({
    queryKey: ["librespot-accounts"],
    queryFn: desktopApi.librespotAccounts,
    enabled: expanded,
    staleTime: 0,
    retry: false,
  });
  const switchAccount = useMutation({ mutationFn: desktopApi.switchLibrespotAccount });
  const busy = disabled || switchAccount.isPending;
  const error = switchAccount.error;
  const errorText = error && typeof error === "object" && "message" in error
    ? String(error.message) : t("accounts.error");
  return (
    <div className="libre-account-switcher">
      <button type="button" className="secondary-button" disabled={busy}
        aria-expanded={expanded} aria-controls="libre-account-list"
        onClick={() => setExpanded(value => !value)}>
        <ArrowLeftRight size={16} />{t("accounts.switch")}
      </button>
      {expanded && (
        <div id="libre-account-list" className="libre-account-list">
          <p>{t("accounts.hint")}</p>
          {accounts.isPending && <p role="status">{t("accounts.loading")}</p>}
          {accounts.isError && (
            <button type="button" className="secondary-button" disabled={busy}
              onClick={() => void accounts.refetch()}>{t("accounts.retry")}</button>
          )}
          {accounts.data?.map((account, index) => (
            <button type="button" className="secondary-button" key={account.id}
              disabled={busy || account.active}
              onClick={() => switchAccount.mutate(account.id)}>
              {account.active ? <Check size={16} /> : <ArrowLeftRight size={16} />}
              <span>{account.username ?? (account.id === "default" ? t("accounts.original") : t("accounts.unsigned", { number: index + 1 }))}</span>
              {account.active && <small>{t("accounts.active")}</small>}
            </button>
          ))}
          <button type="button" className="secondary-button" disabled={busy}
            onClick={() => switchAccount.mutate(null)}>
            <Plus size={16} />{t("accounts.add")}
          </button>
          {switchAccount.isPending && <p role="status"><LoaderCircle size={14} className="spin" /> {t("accounts.restarting")}</p>}
          {switchAccount.isError && <p role="alert">{errorText}</p>}
        </div>
      )}
    </div>
  );
}
