import { t } from "../i18n";
import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props { children: ReactNode }
interface State { failed: boolean }

export class ContentErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State { return { failed: true }; }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Content boundary", error.name, info.componentStack);
  }

  private retry = (): void => this.setState({ failed: false });

  render(): ReactNode {
    if (this.state.failed) {
      return (
        <section className="page content-error-state" role="alert">
          <h1>{t("libraryUi.pageFailed")}</h1>
          <p>{t("libraryUi.playbackContinues")}</p>
          <button type="button" className="primary-button" onClick={this.retry}>{t("libraryUi.retry")}</button>
        </section>
      );
    }
    return this.props.children;
  }
}
