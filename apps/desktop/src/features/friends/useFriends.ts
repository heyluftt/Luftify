import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { t, type MessageKey } from "../../i18n";
import { LISTEN_TOGETHER_QUERY_KEY } from "../listen-together/roomStatusCache";
import { friendsApi } from "./friendsApi";
import type { FriendsControls, FriendsOperation, FriendsStatus } from "./friendsTypes";

export const FRIENDS_QUERY_KEY = ["friends"] as const;

/** Only FriendsSync polls. Pages and navigation observe the same cache. */
export function useFriends(sync = false) {
  return useQuery({
    queryKey: FRIENDS_QUERY_KEY,
    queryFn: friendsApi.status,
    // The backend pushes every change (friends://status); this is a fallback.
    refetchInterval: sync ? 60_000 : false,
    staleTime: 15_000,
    retry: false,
  });
}

export function useFriendsControls() {
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: friendsApi.run,
    onMutate: () => client.cancelQueries({ queryKey: FRIENDS_QUERY_KEY }),
    onSuccess: (status, operation) => {
      client.setQueryData(FRIENDS_QUERY_KEY, status);
      if (operation.type === "invite" || operation.type === "acceptInvite") {
        void client.invalidateQueries({ queryKey: [LISTEN_TOGETHER_QUERY_KEY] });
      }
      if (operation.type === "activate" || operation.type === "restore" || (operation.type === "action" && operation.action.type === "updateProfile")) {
        void client.invalidateQueries({ queryKey: ["settings"] });
        void client.invalidateQueries({ queryKey: ["friends-search"] });
      }
    },
  });
  const controls: FriendsControls = {
    pending: mutation.isPending,
    send: (operation: FriendsOperation, onSuccess?: (status: FriendsStatus) => void) => mutation.mutate(operation, onSuccess ? { onSuccess } : undefined),
  };
  return { controls, mutation };
}

export function friendsErrorText(error: unknown): string | undefined {
  if (!error) return undefined;
  const raw = typeof error === "string" ? error : error && typeof error === "object" && "message" in error && typeof error.message === "string" ? error.message : "";
  if (raw.startsWith("friends.error.")) {
    return t(raw as MessageKey) || t("friends.error.generic");
  }
  if (raw.startsWith("listen.")) return t(raw as MessageKey) || t("friends.error.generic");
  return t("friends.error.generic");
}
