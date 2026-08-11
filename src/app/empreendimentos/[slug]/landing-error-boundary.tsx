'use client';

import React from 'react';
import { Building2, ArrowLeft, RotateCcw } from 'lucide-react';

/**
 * React Error Boundary — prevents white-screen crashes on the landing page.
 * If ANY child component throws during render, this catches it and shows
 * a fallback UI that STILL allows the user to contact via WhatsApp.
 *
 * This is the last line of defense — it ensures the lead can ALWAYS
 * reach an attendant even if the entire React tree fails.
 */
interface Props {
  children: React.ReactNode;
   fallbackWhatsAppUrl?: string;
  fallbackEnterpriseName?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class LandingErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // 1. Log to tracking pixel if available
    try {
      if (typeof window !== 'undefined' && (window as unknown as Record<string, unknown>).CRMPIXEL) {
        const px = (window as unknown as Record<string, unknown>).CRMPIXEL as {
          track: (name: string, data?: Record<string, unknown>) => void;
        };
        px.track('react_error', {
          error_message: (error?.message || 'Unknown').substring(0, 200),
          component_stack: (errorInfo?.componentStack || '').substring(0, 500),
        });
      }
    } catch {
      /* tracking itself failed — non-critical */
    }

    // 2. Send to /api/errors/log via sendBeacon (survives page close)
    try {
      if (typeof window !== 'undefined' && navigator.sendBeacon) {
        const blob = new Blob([JSON.stringify({
          type: 'react_error',
          message: (error?.message || 'Unknown React error').substring(0, 2000),
          source: errorInfo?.componentStack?.split('\n')[0] || undefined,
          stackTrace: (error?.stack || errorInfo?.componentStack || '').substring(0, 5000),
          pageUrl: window.location.href,
          userAgent: navigator.userAgent,
        })], { type: 'application/json' });
        navigator.sendBeacon('/api/errors/log', blob);
      }
    } catch {
      /* sendBeacon failed — non-critical */
    }

    console.error('[LandingPage] Error Boundary caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#0A0A0A] text-white flex items-center justify-center p-4">
          <div className="text-center max-w-md">
            <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-[#C9A96E] to-[#8B6914] flex items-center justify-center mx-auto mb-6 shadow-lg shadow-[#C9A96E]/20">
              <Building2 className="h-8 w-8 text-white" />
            </div>
            <h1 className="text-2xl font-bold mb-3">
              {this.props.fallbackEnterpriseName || 'Empreendimento'}
            </h1>
            <p className="text-white/50 mb-8 leading-relaxed">
              Ocorreu um erro inesperado. Por favor, tente recarregar a página ou entre em contato diretamente pelo WhatsApp.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <a
                href={this.props.fallbackWhatsAppUrl || 'https://wa.me/?text=Tenho%20interesse%20em%20um%20empreendimento'}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2.5 px-6 py-3.5 rounded-xl bg-[#25D366] text-white font-semibold text-sm hover:bg-[#20bd5a] transition-colors shadow-lg shadow-[#25D366]/15"
              >
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                </svg>
                Falar com consultor
              </a>
              <button
                onClick={() => {
                  this.setState({ hasError: false, error: null });
                  window.location.reload();
                }}
                className="flex items-center gap-2 px-6 py-3.5 rounded-xl bg-white/[0.06] border border-white/[0.10] text-white font-medium text-sm hover:bg-white/[0.10] transition-all"
              >
                <RotateCcw className="h-4 w-4" />
                Recarregar página
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
