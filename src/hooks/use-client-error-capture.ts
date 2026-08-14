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

      // Ignore noise from Facebook/Instagram In-App Browser injected scripts
      if (errorData.source?.startsWith('iabjs://')) return;
      const iabNoise = errorData.message || errorData.stackTrace || '';
      if (/sendDataToNative|sendPageHideMessage|iabjs:\/\//.test(iabNoise)) return;

      // Ignore Meta IAB "Java object is gone" — native Android WebView bridge GC'd
      // while JS still holds a reference. Harmless; happens in FB/IG In-App Browser.
      if (/Java object is gone/.test(iabNoise)) return;

      // Ignore IAB/SDK "webkit.messageHandlers is undefined" — third-party SDKs
      // (TikTok Pixel, LinkedIn, IAB scripts) trying to access iOS WKWebView native
      // bridge from non-iOS contexts. Harmless; SDKs fall back gracefully.
      if (/webkit\.messageHandlers/.test(iabNoise)) return;

      // Ignore generic "Script error." from cross-origin scripts (e.g. Meta Pixel
      // fbevents.js failing inside Instagram/Facebook In-App Browser). These are
      // harmless CORS-masked errors that cannot be acted on.
      if (errorData.type === 'js_error' && errorData.message === 'Script error.' && !errorData.source) return;

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
      // Skip Facebook/Instagram IAB injected script errors early
      if (source?.startsWith('iabjs://')) return false;
      const msg = String(message);
      if (/sendDataToNative|sendPageHideMessage|Java object is gone|webkit\.messageHandlers/.test(msg)) return false;

      // Skip generic "Script error." from cross-origin third-party scripts
      // (e.g. Meta Pixel fbevents.js inside IG/FB In-App Browser)
      if (msg === 'Script error.' && !source) return false;
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
