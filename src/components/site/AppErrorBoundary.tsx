import { Component, type ErrorInfo, type ReactNode } from "react";

import { captureException } from "#/lib/analytics";

/**
 * Last-resort boundary around the whole app: reports the error to PostHog and shows a plain
 * message instead of a blank page. Uncaught errors outside React are captured by PostHog itself.
 */
export class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: Error, _info: ErrorInfo) {
    captureException(error);
  }

  override render() {
    if (this.state.failed) {
      return <div role="alert">Something went wrong. Please refresh the page and try again.</div>;
    }
    return this.props.children;
  }
}
