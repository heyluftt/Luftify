import { t } from "../i18n";
import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props { children: ReactNode }
interface State { failed: boolean }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State { return { failed: true }; }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("UI boundary", error.name, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.failed) {
      return (
        <main className="fatal-state">
          <h1>{t("libraryUi.fatal")}</h1>
          <p>{t("libraryUi.playbackContinues")}</p>
          <button type="button" className="primary-button" onClick={() => window.location.reload()}>{t("libraryUi.reload")}</button>
        </main>
      );
    }
    return this.props.children;
  }
}
