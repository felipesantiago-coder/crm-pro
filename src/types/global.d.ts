// Tracking pixel loaded by the landing page script.
interface CRMPIXEL {
  track(event: string, data?: Record<string, unknown>): void;
  identify(leadId: string): void;
  trackSectionView(section: string): void;
  trackExitIntent(): void;
  trackGalleryClick(index: number, total: number): void;
  trackFAQOpen(index: number, question: string): void;
  trackFormFocus(field: string): void;
  trackFormBlur(field: string, durationMs?: number): void;
  _setFormFieldsFilled(count: number): void;
}

declare global {
  interface Window {
    CRMPIXEL?: CRMPIXEL;
  }
}

export {};