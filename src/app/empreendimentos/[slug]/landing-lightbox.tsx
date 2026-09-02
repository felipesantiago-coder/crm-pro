'use client';

import React, { useRef, useEffect, useCallback, useState } from 'react';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';

interface LightboxProps {
  images: { id: string; url: string; altText: string | null }[];
  activeIdx: number;
  onClose: () => void;
  onIndexChange: (idx: number) => void;
}

export default function LandingLightbox({ images, activeIdx, onClose, onIndexChange }: LightboxProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const len = images.length;

  // Track whether the current index change came from user scroll (not programmatic).
  // This prevents the scrollToIndex effect from fighting with the user's swipe gesture.
  const isUserScrolling = useRef(false);
  const programmaticScroll = useRef(false);

  // Snap scroll container to active image (only for external index changes: nav buttons, keyboard)
  const scrollToIndex = useCallback((idx: number) => {
    if (!scrollRef.current) return;
    const child = scrollRef.current.children[idx] as HTMLElement | undefined;
    if (!child) return;
    programmaticScroll.current = true;
    child.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
    // Reset flag after scroll animation completes
    setTimeout(() => { programmaticScroll.current = false; }, 400);
  }, []);

  // Only scroll programmatically when index changed from OUTSIDE (keyboard, nav buttons)
  // NOT when index changed from user's own swipe gesture
  const prevActiveIdx = useRef(activeIdx);
  useEffect(() => {
    if (activeIdx === prevActiveIdx.current) return;
    prevActiveIdx.current = activeIdx;
    // Skip if the user is actively scrolling — they're already at the right position
    if (isUserScrolling.current) return;
    scrollToIndex(activeIdx);
  }, [activeIdx, scrollToIndex]);

  // Sync scroll position → active index (debounced to avoid rapid updates)
  const scrollTimer = useRef<ReturnType<typeof setTimeout>>();
  const handleScroll = useCallback(() => {
    if (!scrollRef.current || programmaticScroll.current) return;
    const container = scrollRef.current;
    const idx = Math.round(container.scrollLeft / container.clientWidth);
    if (idx >= 0 && idx < len && idx !== activeIdx) {
      isUserScrolling.current = true;
      onIndexChange(idx);
      // Keep the flag true while the user is still swiping
      clearTimeout(scrollTimer.current);
      scrollTimer.current = setTimeout(() => { isUserScrolling.current = false; }, 600);
    }
  }, [len, activeIdx, onIndexChange]);

  // Clear timer on unmount
  useEffect(() => () => clearTimeout(scrollTimer.current), []);

  const goPrev = () => { isUserScrolling.current = false; onIndexChange(Math.max(0, activeIdx - 1)); };
  const goNext = () => { isUserScrolling.current = false; onIndexChange(Math.min(len - 1, activeIdx + 1)); };

  // Keyboard navigation
  useEffect(() => {
    const h = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') onClose();
      if (ev.key === 'ArrowRight') goNext();
      if (ev.key === 'ArrowLeft') goPrev();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose, goNext, goPrev]);

  return (
    <div className="fixed inset-0 z-[60] bg-black/95 flex flex-col" onClick={onClose}>
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-3 sm:px-6 sm:py-4" onClick={(ev) => ev.stopPropagation()}>
        <div className="text-white/60 text-xs sm:text-sm bg-white/10 backdrop-blur-sm px-3 py-1.5 sm:px-4 sm:py-2 rounded-full min-h-[44px] flex items-center">
          {activeIdx + 1} / {images.length}
        </div>
        <button onClick={onClose} className="min-h-[44px] min-w-[44px] flex items-center justify-center text-white/60 hover:text-white bg-white/10 backdrop-blur-sm rounded-full p-2 sm:p-2.5 transition-colors">
          <X className="h-6 w-6" />
        </button>
      </div>
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        onClick={(ev) => ev.stopPropagation()}
        className="flex-1 flex overflow-x-auto snap-x snap-mandatory [-webkit-overflow-scrolling:touch] [overscroll-behavior-x:contain]"
      >
        {images.map((img, idx) => (
          <div key={img.id} className="flex-shrink-0 w-full h-full snap-start flex items-center justify-center p-2 sm:p-4">
            <img src={img.url} alt={img.altText || ''} width={1200} height={800} className="max-w-full max-h-full object-contain rounded-xl select-none pointer-events-none" loading="lazy" decoding="async" draggable={false} />
          </div>
        ))}
      </div>
      {images.length > 1 && (<>
        <button onClick={(ev) => { ev.stopPropagation(); goPrev(); }} className="absolute left-2 sm:left-6 top-1/2 -translate-y-1/2 min-h-[44px] min-w-[44px] flex items-center justify-center text-white/60 hover:text-white bg-white/10 backdrop-blur-sm rounded-full p-2.5 sm:p-3 transition-colors z-10">
          <ChevronLeft className="h-5 w-5 sm:h-6 sm:w-6" />
        </button>
        <button onClick={(ev) => { ev.stopPropagation(); goNext(); }} className="absolute right-2 sm:right-6 top-1/2 -translate-y-1/2 min-h-[44px] min-w-[44px] flex items-center justify-center text-white/60 hover:text-white bg-white/10 backdrop-blur-sm rounded-full p-2.5 sm:p-3 transition-colors z-10">
          <ChevronRight className="h-5 w-5 sm:h-6 sm:w-6" />
        </button>
      </>)}
    </div>
  );
}
