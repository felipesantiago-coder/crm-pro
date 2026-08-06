'use client';

import { useEffect, useCallback, useRef } from 'react';

interface ErrorCaptureOptions {
  slug?: string;
  enabled?: boolean;
}

/**
 * Global JS error capture hook.
 * Installs window.onerror + unhandledrejection listeners.
 * Sends errors to /api/errors/log via sendBeacon (survives page close).
 * Deduplicates identical errors within 10s to avoid flooding.
 */
export function useClientErrorCapture({ slug, enabled = true }: ErrorCaptureOptions = {}) {
  const slugRef = useRef(slug);
  const dedupMap = useRef<Map<string, number>>(new Map());

  const sendError = useCallback(
    (errorData: {
      type: 'js_error' | 'promise_rejection' | 'react_error';
      message: string;
      source?: string;
      lineNumber?: number;
      colNumber?: number;
      stackTrace?: string;
    }) => {
      if (typeof window === 'undefined' || !enabled) return;

      // Dedup: skip if same message+source was seen in the last 10s
      const dedupKey = `${errorData.type}:${errorData.message}:${errorData.source}`;
      const now = Date.now();
      const lastSeen = dedupMap.current.get(dedupKey);
      if (lastSeen && now - lastSeen < 10_000) return;
      dedupMap.current.set(dedupKey, now);

      // Clean old entries every 100 errors
      if (dedupMap.current.size > 100) {
        const cutoff = now - 15_000;
        for (const [k, t] of dedupMap.current) {
          if (t < cutoff) dedupMap.current.delete(k);
        }
      }

      const payload = {
        ...errorData,
        pageUrl: window.location.href,
        userAgent: navigator.userAgent,
        slug: slugRef.current || undefined,
      };

      // Use sendBeacon if available (survives page close), fallback to fetch
      const blob = new Blob([JSON.stringify(payload)], {
        type: 'application/json',
      });

      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/errors/log', blob);
      } else {
        // Fallback — fire and forget
        fetch('/api/errors/log', {
          method: 'POST',
          body: JSON.stringify(payload),
          headers: { 'Content-Type': 'application/json' },
          keepalive: true,
        }).catch(() => {});
      }
    },
    [enabled],
  );

  /** Call this from ErrorBoundary.componentDidCatch */
  const logReactError = useCallback(
    (error: Error, componentStack?: string) => {
      sendError({
        type: 'react_error',
        message: error?.message || 'Unknown React error',
        source: componentStack?.split('\n')[0] || undefined,
        stackTrace: error?.stack || componentStack || undefined,
      });
    },
    [sendError],
  );

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;

    // Keep slugRef in sync
    slugRef.current = slug;

    // --- window.onerror ---
    const prevOnerror = window.onerror;
    window.onerror = (message, source, lineno, colno, error) => {
      sendError({
        type: 'js_error',
        message: String(message),
        source: source || undefined,
        lineNumber: lineno || undefined,
        colNumber: colno || undefined,
        stackTrace: error?.stack || undefined,
      });
      // Preserve any existing handler
      if (prevOnerror) {
        return prevOnerror(message, source, lineno, colno, error);
      }
      return false;
    };

    // --- unhandledrejection ---
    const rejectionHandler = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const message =
        reason instanceof Error
          ? reason.message
          : typeof reason === 'string'
            ? reason
            : 'Unhandled promise rejection';
      const stack = reason instanceof Error ? reason.stack : undefined;

      sendError({
        type: 'promise_rejection',
        message,
        stackTrace: stack,
      });
    };
    window.addEventListener('unhandledrejection', rejectionHandler);

    return () => {
      window.onerror = prevOnerror;
      window.removeEventListener('unhandledrejection', rejectionHandler);
    };
  }, [enabled, slug, sendError]);

  return { logReactError };
}
