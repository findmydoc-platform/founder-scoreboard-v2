"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export function usePlanningFocusMode() {
  const [focusModeActive, setFocusModeActive] = useState(false);
  const ownsFullscreenRef = useRef(false);

  useEffect(() => {
    const handleFullscreenChange = () => {
      if (ownsFullscreenRef.current && !document.fullscreenElement) {
        ownsFullscreenRef.current = false;
        setFocusModeActive(false);
      }
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  const enterFocusMode = useCallback(async () => {
    setFocusModeActive(true);
    if (!document.documentElement.requestFullscreen || document.fullscreenElement) return;
    try {
      await document.documentElement.requestFullscreen();
      ownsFullscreenRef.current = document.fullscreenElement === document.documentElement;
    } catch {
      ownsFullscreenRef.current = false;
    }
  }, []);

  const exitFocusMode = useCallback(async () => {
    setFocusModeActive(false);
    const shouldExitFullscreen = ownsFullscreenRef.current && Boolean(document.fullscreenElement);
    ownsFullscreenRef.current = false;
    if (!shouldExitFullscreen) return;
    try {
      await document.exitFullscreen();
    } catch {
      // The layout still leaves focus mode even if the browser already exited fullscreen.
    }
  }, []);

  const toggleFocusMode = useCallback(() => {
    if (focusModeActive) void exitFocusMode();
    else void enterFocusMode();
  }, [enterFocusMode, exitFocusMode, focusModeActive]);

  return {
    focusModeActive,
    toggleFocusMode,
  };
}
