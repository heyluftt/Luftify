import { invoke } from "@tauri-apps/api/core";
import type { DeviceLink, FriendsOperation, FriendsStatus, LinkedDevice, SocialProfile } from "./friendsTypes";

export const friendsApi = {
  status: () => invoke<FriendsStatus>("friends_status"),
  search: (query: string) => invoke<SocialProfile[]>("friends_search", { query }),
  /** The secret recovery code; `renew` replaces it. Never log it. */
  recoveryCode: (renew: boolean) => invoke<string>("friends_recovery_code", { renew }),
  /** A short code for a phone; valid for ten minutes. */
  linkCode: () => invoke<DeviceLink>("friends_link_code"),
  devices: () => invoke<LinkedDevice[]>("friends_devices"),
  removeDevice: (id: string) => invoke<LinkedDevice[]>("friends_remove_device", { id }),
  run: (operation: FriendsOperation): Promise<FriendsStatus> => {
    switch (operation.type) {
      case "refresh": return invoke("friends_refresh");
      case "activate": return invoke("friends_activate", { profile: operation.profile });
      case "action": return invoke("friends_action", { action: operation.action });
      case "invite": return invoke("friends_invite", { profileId: operation.profileId });
      case "acceptInvite": return invoke("friends_accept_invite", { invitationId: operation.invitationId });
      case "dismissInvite": return invoke("friends_dismiss_invite", { invitationId: operation.invitationId });
      case "listenAlong": return invoke("friends_listen_along", { profileId: operation.profileId });
      case "stopListenAlong": return invoke("friends_listen_along_stop");
      case "restore": return invoke("friends_restore", { code: operation.code });
    }
  },
};
