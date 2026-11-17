import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { isMiniPlayerWindow } from "./features/miniplayer/miniplayerWindow";
import { prefetchPages } from "./pages/lazyPages";
import { queryClient } from "./queryClient";
import { persistQueries, restorePersistedQueries } from "./queryPersistence";
import { enableMotionAfterFirstPaint } from "./features/motion/motionRuntime";
import { trackWindowActivity } from "./features/motion/windowActivity";
// Also applies the "Animationen" setting to the root, in every window.
import { trackCoverLaunches } from "./features/motion/coverFlight";
import { suppressWebPageControls } from "./layouts/webPageControls";
import { trackInputModality } from "./layouts/inputModality";
import { applyThemeMode, readRememberedThemeMode } from "./themes/theme";
import "./styles/index.css";

performance.mark("luft:react-start");
// The main window restores and saves the small persisted Home sections;
// the mini player never shows them.
if (!isMiniPlayerWindow()) {
  restorePersistedQueries(queryClient);
  persistQueries(queryClient);
}
suppressWebPageControls();
trackInputModality();
// The first frame waits for the active theme's stylesheet (a local file,
// a few ms), so the app never paints in the wrong colours; the cap only
// guards against a stylesheet that never answers.
const themeReady = applyThemeMode(readRememberedThemeMode() ?? "dark");
void Promise.race([themeReady, new Promise((resolve) => window.setTimeout(resolve, 1_500))]).then(() => {
  createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
  enableMotionAfterFirstPaint();
  if (!isMiniPlayerWindow()) {
    prefetchPages();
    trackWindowActivity();
    trackCoverLaunches();
  }
});
