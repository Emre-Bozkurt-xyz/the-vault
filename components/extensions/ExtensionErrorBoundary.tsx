"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Isolates one extension's UI (`docs/23_EXTENSION_SDK_PLAN.md` §18.5): if it
 * throws while rendering, it is replaced by `fallback` and logged; the page or
 * editor around it keeps working. `fallback` receives the error message in
 * development only, so authors see why while readers never see a stack.
 */
export class ExtensionErrorBoundary extends Component<
  {
    extensionId: string;
    /** What failed, for the log: a block's source, an overlay id. */
    label: string;
    fallback: (developmentMessage: string | undefined) => ReactNode;
    children: ReactNode;
  },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(
      `Extension "${this.props.extensionId}" failed to render ${this.props.label}`,
      error,
      info.componentStack,
    );
  }

  render() {
    if (this.state.error) {
      return this.props.fallback(
        process.env.NODE_ENV === "production"
          ? undefined
          : `${this.props.extensionId}: ${this.state.error.message}`,
      );
    }

    return this.props.children;
  }
}
