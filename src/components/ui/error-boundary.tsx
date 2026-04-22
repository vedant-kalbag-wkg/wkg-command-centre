"use client";

import React from "react";

interface ErrorBoundaryProps {
  fallback: React.ReactNode;
  children: React.ReactNode;
  /**
   * When this value changes between renders, a previously-caught error is
   * cleared so children are re-rendered. Pass something stable-per-inputs
   * (e.g. `JSON.stringify(canonicalFilters)`) so a filter change lets the
   * island retry instead of leaving the user stuck on the fallback forever.
   */
  resetKey?: unknown;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

/**
 * Tiny client-side error boundary used to scope failures in Suspense data
 * islands so one broken query doesn't collapse the whole page. Modelled on
 * `react-error-boundary` but intentionally dependency-free — we only need
 * `fallback` + `children` + `resetKey` here.
 */
export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo): void {
    console.error("[ErrorBoundary]", error, info);
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    if (this.state.hasError && !Object.is(prevProps.resetKey, this.props.resetKey)) {
      this.setState({ hasError: false });
    }
  }

  render(): React.ReactNode {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}
