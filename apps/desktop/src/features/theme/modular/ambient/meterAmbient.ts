import { ambientAlpha, frameAroundBox, readAmbientLevels, runAmbientLoop } from "../../../lyrics/selfDrawnAmbient";
import { MODULAR_COLOURS, type ModularAmbientRef } from "./modularAmbientState";

const PEAK_HOLD_SECONDS = 0.5;
const FALL = 1.6;
const PEAK_FALL = 1.1;
const BANDS = [MODULAR_COLOURS.led, MODULAR_COLOURS.yellow, MODULAR_COLOURS.red];

interface Meter { level: number; peak: number; hold: number }

/** LED meters beside the cover: bass and highs outside, mids inside */
export function startMeterAmbient(canvas: HTMLCanvasElement, state: ModularAmbientRef, still: boolean): () => void {
  const context = canvas.getContext("2d");
  if (!context) return () => undefined;
  const meters: Meter[] = Array.from({ length: 4 }, () => ({ level: 0, peak: 0, hold: 0 }));
  let time = 0;

  const draw = (seconds: number, now: number) => {
    const { reach, strength, playing, spread } = state.current;
    const frame = frameAroundBox(canvas, reach);
    if (!frame) return;
    const { dpr, pad, coverWidth, coverHeight } = frame;
    // big covers get thicker LEDs
    const unit = dpr * Math.min(1.6, Math.max(1, Math.min(coverWidth, coverHeight) / dpr / 240));
    const column = 5 * unit;
    const columnGap = 3 * unit;
    const segmentGap = 2 * unit;
    const count = Math.max(8, Math.floor((coverHeight + segmentGap) / (6 * unit)));
    const pitch = (coverHeight + segmentGap) / count;
    const segment = pitch - segmentGap;
    const edge = (8 + 10 * spread) * unit;
    const innerLeft = pad - edge - column;
    const innerRight = pad + coverWidth + edge;
    const columns = [innerLeft - columnGap - column, innerLeft, innerRight, innerRight + column + columnGap];
    const bottom = pad + coverHeight;
    const top = (k: number) => bottom - (k + 1) * pitch + segmentGap;

    const levels = readAmbientLevels(state.current.sink, playing, now);
    if (playing) time += seconds;
    const sway = (offset: number) => 0.88 + 0.12 * Math.sin(time * 3.1 + offset);
    const sources = levels.live
      ? [levels.bass, levels.mid * sway(1), levels.mid * sway(2.4), levels.high]
      : playing ? [0.2, 0.15, 0.15, 0.12].map((value, index) => value * (0.7 + 0.3 * Math.sin(time * 1.3 + index)))
      : [0, 0, 0, 0];

    context.clearRect(0, 0, frame.width, frame.height);
    context.globalAlpha = ambientAlpha(strength);
    meters.forEach((meter, index) => {
      const target = Math.min(1, Math.pow(sources[index]!, 0.75) * 1.15);
      meter.level = target > meter.level ? target : Math.max(target, meter.level - FALL * seconds);
      if (meter.level >= meter.peak) { meter.peak = meter.level; meter.hold = PEAK_HOLD_SECONDS; }
      else if (meter.hold > 0) meter.hold -= seconds;
      else meter.peak = Math.max(0, meter.peak - PEAK_FALL * seconds);

      const x = columns[index]!;
      const lit = Math.round(meter.level * count);
      const peak = Math.min(count, Math.round(meter.peak * count)) - 1;
      const off = new Path2D();
      const bands = BANDS.map(() => new Path2D());
      for (let k = 0; k < count; k++) {
        if (k >= lit && k === peak) continue;
        const share = k / count;
        (k < lit ? bands[share < 0.7 ? 0 : share < 0.9 ? 1 : 2]! : off).rect(x, top(k), column, segment);
      }
      context.fillStyle = MODULAR_COLOURS.meterOff;
      context.fill(off);
      bands.forEach((path, band) => {
        context.fillStyle = BANDS[band]!;
        context.shadowColor = BANDS[band]!;
        context.shadowBlur = 6 * unit;
        context.fill(path);
      });
      context.shadowBlur = 0;
      if (peak >= lit && peak >= 0) {
        context.fillStyle = MODULAR_COLOURS.ink;
        context.fillRect(x, top(peak), column, segment);
      }
    });
    context.globalAlpha = 1;
  };

  return runAmbientLoop(draw, still, { box: canvas.parentElement, awake: () => state.current.playing });
}
