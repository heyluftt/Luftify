import { useCallback, useEffect, useRef, useState } from "react";
import type { WheelEvent } from "react";

const WHEEL_IDLE_MS = 160;
const ENGINE_SETTLE_TIMEOUT_MS = 1_200;
const SETTLED_PAINT_DELAY_MS = 34;
const PIXELS_PER_WHEEL_STEP = 100;

interface SmoothVolumeWheelOptions {
  enabled: boolean;
  stepPercent: number;
  value: number;
  minimum?: number;
  maximum?: number;
  wheelStep?: number;
  onStart?: () => void;
  onChange: (value: number) => void;
  onCommit?: () => Promise<void> | void;
}

export function useSmoothVolumeWheel({
  enabled,
  stepPercent,
  value,
  minimum = 0,
  maximum = 1,
  wheelStep = Math.max(0, stepPercent) / 100,
  onStart,
  onChange,
  onCommit,
}: SmoothVolumeWheelOptions) {
  const externalValueRef = useRef(value);
  const targetRef = useRef(value);
  const activeRef = useRef(false);
  const settlingRef = useRef(false);
  const generationRef = useRef(0);
  const onStartRef = useRef(onStart);
  const onChangeRef = useRef(onChange);
  const onCommitRef = useRef(onCommit);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [previewValue, setPreviewValue] = useState<number>();

  onStartRef.current = onStart;
  onChangeRef.current = onChange;
  onCommitRef.current = onCommit;

  useEffect(() => {
    externalValueRef.current = value;
    if (!activeRef.current && !settlingRef.current) targetRef.current = value;
  }, [value]);

  const releasePreview = useCallback((generation: number) => {
    if (generation !== generationRef.current || activeRef.current) return;
    if (settleTimerRef.current !== undefined) clearTimeout(settleTimerRef.current);
    settleTimerRef.current = undefined;
    settlingRef.current = false;
    targetRef.current = externalValueRef.current;
    setPreviewValue(undefined);
  }, []);

  const finishBurst = useCallback(() => {
    if (!activeRef.current) return;
    if (idleTimerRef.current !== undefined) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = undefined;
    activeRef.current = false;
    settlingRef.current = true;
    const generation = generationRef.current;
    const settled = onCommitRef.current?.();

    settleTimerRef.current = setTimeout(
      () => releasePreview(generation),
      ENGINE_SETTLE_TIMEOUT_MS,
    );
    void Promise.resolve(settled).finally(() => {
      if (generation !== generationRef.current || activeRef.current) return;
      if (settleTimerRef.current !== undefined) clearTimeout(settleTimerRef.current);
      settleTimerRef.current = setTimeout(
        () => releasePreview(generation),
        SETTLED_PAINT_DELAY_MS,
      );
    });
  }, [releasePreview]);

  const stop = useCallback(() => {
    const shouldCommit = activeRef.current;
    generationRef.current += 1;
    if (idleTimerRef.current !== undefined) clearTimeout(idleTimerRef.current);
    if (settleTimerRef.current !== undefined) clearTimeout(settleTimerRef.current);
    idleTimerRef.current = undefined;
    settleTimerRef.current = undefined;
    activeRef.current = false;
    settlingRef.current = false;
    if (shouldCommit) void onCommitRef.current?.();
    targetRef.current = externalValueRef.current;
    setPreviewValue(undefined);
  }, []);

  useEffect(() => () => {
    if (idleTimerRef.current !== undefined) clearTimeout(idleTimerRef.current);
    if (settleTimerRef.current !== undefined) clearTimeout(settleTimerRef.current);
    if (activeRef.current) void onCommitRef.current?.();
  }, []);

  useEffect(() => {
    if (!enabled) stop();
  }, [enabled, stop]);

  const onWheel = useCallback((event: WheelEvent<HTMLInputElement>) => {
    if (!enabled || event.deltaY === 0) return;
    event.preventDefault();

    const base = activeRef.current || settlingRef.current
      ? targetRef.current
      : externalValueRef.current;
    const next = clamp(base + wheelDelta(event, wheelStep), minimum, maximum);
    if (next === base) return;

    if (!activeRef.current) {
      generationRef.current += 1;
      if (settleTimerRef.current !== undefined) clearTimeout(settleTimerRef.current);
      settleTimerRef.current = undefined;
      settlingRef.current = false;
      onStartRef.current?.();
    }
    activeRef.current = true;
    targetRef.current = next;
    setPreviewValue(next);
    onChangeRef.current(next);

    if (idleTimerRef.current !== undefined) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(finishBurst, WHEEL_IDLE_MS);
  }, [enabled, finishBurst, maximum, minimum, wheelStep]);

  return {
    displayValue: previewValue ?? value,
    isWheelAdjusting: previewValue !== undefined,
    onWheel,
    stopWheelPreview: stop,
  };
}

function wheelDelta(event: WheelEvent<HTMLInputElement>, step: number): number {
  if (event.deltaMode !== 0) return -Math.sign(event.deltaY) * step;

  // A mouse wheel stays at one configured step. Small touchpad deltas retain
  // their precision, so the visual movement no longer feels like a staircase.
  const strength = Math.min(1, Math.max(.08, Math.abs(event.deltaY) / PIXELS_PER_WHEEL_STEP));
  return -Math.sign(event.deltaY) * step * strength;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
