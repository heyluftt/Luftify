import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Called once when the overlay failed; usually closes it. */
  onFail: () => void;
}
interface State { failed: boolean }

/**
 * For overlays opened on top of the app (the recap story): if one fails,
 * it simply closes instead of taking the whole window down with it.
 */
export class OverlayErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State { return { failed: true }; }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Overlay boundary", error.name, info.componentStack);
    this.props.onFail();
  }

  render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}
