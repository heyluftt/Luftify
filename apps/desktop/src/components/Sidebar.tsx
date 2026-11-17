import { BarChart3, Blocks, ChevronLeft, ChevronRight, Compass, Gift, Headphones, Home, MessageCircle, MicVocal, PictureInPicture2, Search, Settings, Users } from "lucide-react";
import { useRef } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { productConfig } from "../config/product";
import { useRecapCatalog } from "../features/recap/useRecaps";
import { useFriends } from "../features/friends/useFriends";
import { useChatInbox } from "../features/chat/useChat";
import { t } from "../i18n";
import { desktopApi } from "../services/desktopApi";
import { useUiStore } from "../stores/uiStore";
import { SERVER_AVAILABLE } from "../features/server/ServerNotice";
import { useNavGlide } from "../features/motion/useNavGlide";
import { SidebarLibrary } from "./sidebar/SidebarLibrary";
import { SidebarSourceStatus } from "./sidebar/SidebarSourceStatus";
import { SidebarBrandMark } from "./sidebar/SidebarBrandMark";

interface NavEntry {
  to: string;
  label: string;
  icon: typeof Home;
  /** Something new waits there (a fresh recap). */
  fresh?: boolean;
  count?: number;
  /** Needs the sync server, which is switched off for now. */
  paused?: boolean;
}

function primaryNav(recapFresh: boolean, friendsPending: number, messagesUnread: number): NavEntry[] {
  return [
    { to: "/", label: t("nav.home"), icon: Home },
    { to: "/search", label: t("nav.search"), icon: Search },
    { to: "/lyrics", label: t("nav.lyrics"), icon: MicVocal },
    { to: "/insights", label: t("nav.insights"), icon: BarChart3 },
    { to: "/recaps", label: t("nav.recaps"), icon: Gift, fresh: recapFresh },
    { to: "/listen", label: t("nav.listenTogether"), icon: Headphones, paused: !SERVER_AVAILABLE },
    { to: "/friends", label: t("nav.friends"), icon: Users, count: friendsPending, paused: !SERVER_AVAILABLE },
    { to: "/messages", label: t("chat.title"), icon: MessageCircle, count: messagesUnread, paused: !SERVER_AVAILABLE },
  ];
}

function systemNav(): NavEntry[] {
  return [
    { to: "/modules", label: t("nav.modules"), icon: Blocks },
    { to: "/diagnostics", label: t("nav.diagnostics"), icon: Compass },
    { to: "/settings", label: t("nav.settings"), icon: Settings },
  ];
}

export function Sidebar() {
  const navRef = useRef<HTMLElement>(null);
  useNavGlide(navRef, useLocation().pathname);
  const collapsed = useUiStore((store) => store.sidebarCollapsed);
  const setCollapsed = useUiStore((store) => store.setSidebarCollapsed);
  const recapFresh = useRecapCatalog().fresh.length > 0;
  const social = useFriends().data;
  const messagesUnread = useChatInbox().data?.reduce((sum, chat) => sum + chat.unread, 0) ?? 0;
  const friendsPending = social?.connection === "online"
    ? (social.snapshot?.incomingRequests.length ?? 0) + (social.snapshot?.invitations.length ?? 0) : 0;
  return (
    <aside className={collapsed ? "sidebar is-collapsed" : "sidebar"}>
      <header className="sidebar-header">
        <div className="sidebar-logo">
          <SidebarBrandMark />
          <strong className="sidebar-logo-copy">{productConfig.shortName}</strong>
        </div>
        <button
          type="button"
          className="sidebar-icon-button sidebar-collapse-toggle"
          aria-controls="sidebar-navigation"
          aria-expanded={!collapsed}
          aria-label={collapsed ? t("nav.expandSidebar") : t("nav.collapseSidebar")}
          title={collapsed ? t("nav.expandSidebar") : t("nav.collapseSidebar")}
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? <ChevronRight size={16} aria-hidden="true" /> : <ChevronLeft size={16} aria-hidden="true" />}
        </button>
      </header>

      <nav ref={navRef} id="sidebar-navigation" className="sidebar-nav" aria-label={t("nav.main")}>
        <span className="nav-glide" aria-hidden="true" />
        {primaryNav(recapFresh, friendsPending, messagesUnread).map((entry) => <NavItem key={entry.to} entry={entry} />)}
      </nav>

      <SidebarLibrary collapsed={collapsed} />

      <footer className="sidebar-footer">
        <SidebarSourceStatus />
        <nav className="sidebar-system" aria-label={t("nav.system")}>
          <button
            type="button"
            className="sidebar-icon-button"
            aria-label={t("miniplayer.show")}
            title={t("miniplayer.show")}
            onClick={() => void desktopApi.showMiniplayer()}
          >
            <PictureInPicture2 size={17} aria-hidden="true" />
          </button>
          {systemNav().map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} title={label} aria-label={label} className={({ isActive }) => (isActive ? "sidebar-icon-button active" : "sidebar-icon-button")}>
              <Icon size={17} aria-hidden="true" />
            </NavLink>
          ))}
        </nav>
      </footer>
    </aside>
  );
}

function NavItem({ entry: { to, label, icon: Icon, fresh, count, paused } }: { entry: NavEntry }) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      title={paused ? `${label} – ${t("server.unavailable")}` : label}
      aria-label={paused ? `${label} – ${t("server.unavailable")}` : count ? `${label} – ${t(to === "/messages" ? "chat.unread" : "friends.pendingCount", { n: count })}` : fresh ? `${label} – ${t("recap.page.new")}` : label}
      className={({ isActive }) => `nav-item${isActive ? " active" : ""}${paused ? " is-paused" : ""}`}
    >
      <Icon size={20} strokeWidth={1.9} aria-hidden="true" />
      <span>{label}</span>
      {fresh && <i className="nav-fresh-dot" aria-hidden="true" />}
      {!!count && <i className="nav-friends-count" aria-hidden="true">{count > 99 ? "99+" : count}</i>}
    </NavLink>
  );
}
