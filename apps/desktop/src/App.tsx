import { RemoteSync } from "./features/remote/RemoteSync";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./queryClient";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ListenTogetherSync } from "./features/listen-together/ListenTogetherSync";
import { FriendsSync } from "./features/friends/FriendsSync";
import { ChatSync } from "./features/chat/ChatSync";
import { NoticeStack } from "./features/notices/NoticeStack";
import { PlaybackSync } from "./features/playback/PlaybackSync";
import { AudioControlSync } from "./features/audio-control/audioControl";
import { ThemeSync } from "./features/theme/ThemeSync";
import { StartupSync } from "./features/spotify/StartupSync";
import { MediaPrefetch } from "./features/prefetch/MediaPrefetch";
import { HomeContentPrefetch } from "./features/prefetch/HomeContentPrefetch";
import { AppShell } from "./layouts/AppShell";
import { HomePage } from "./pages/HomePage";
import {
  AudioControlPage,
  DiagnosticsPage,
  InsightsPage,
  RecapsPage,
  ListenTogetherPage,
  FriendsPage,
  MessagesPage,
  LyricsPage,
  ModulesPage,
  EntityPage,
  LibraryPage,
  QueuePage,
  SearchPage,
  SettingsPage,
} from "./pages/lazyPages";
import { MiniPlayerApp } from "./features/miniplayer/MiniPlayerApp";
import { isMiniPlayerWindow } from "./features/miniplayer/miniplayerWindow";

export function App() {
  if (isMiniPlayerWindow()) return <MiniPlayerApp />;
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <StartupSync />
        <PlaybackSync />
        <ListenTogetherSync />
        <MediaPrefetch />
        <HomeContentPrefetch />
        <AudioControlSync />
        <ThemeSync />
        <HashRouter useTransitions={false}>
          <FriendsSync />
          <ChatSync />
          <NoticeStack />
          <RemoteSync />
          <Routes>
            <Route element={<AppShell />}>
              <Route index element={<HomePage />} />
              <Route path="search" element={<SearchPage />} />
              <Route path="library" element={<LibraryPage />} />
              <Route path="liked" element={<LibraryPage likedOnly />} />
              <Route path="queue" element={<QueuePage />} />
              <Route path="lyrics" element={<LyricsPage />} />
              <Route path="insights" element={<InsightsPage />} />
              <Route path="recaps" element={<RecapsPage />} />
              <Route path="listen" element={<ListenTogetherPage />} />
              <Route path="friends" element={<FriendsPage />} />
              <Route path="messages" element={<MessagesPage />} />
              <Route path="messages/:peer" element={<MessagesPage />} />
              <Route path="modules" element={<ModulesPage />} />
              <Route path="modules/audio-control" element={<AudioControlPage />} />
              <Route path="modules/lyrics" element={<LyricsPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="diagnostics" element={<DiagnosticsPage />} />
              <Route path="artist/:uri" element={<EntityPage kind="Künstler" />} />
              <Route path="album/:uri" element={<EntityPage kind="Album" />} />
              <Route path="playlist/:uri" element={<EntityPage kind="Playlist" />} />
              <Route path="*" element={<Navigate replace to="/" />} />
            </Route>
          </Routes>
        </HashRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
