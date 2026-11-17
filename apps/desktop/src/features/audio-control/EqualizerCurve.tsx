import { t } from "../../i18n";
import { motion } from "motion/react";
import { useLessMotion } from "../motion/motionLevel";

const WIDTH = 900;
const HEIGHT = 220;
const PADDING_X = 42;
const PADDING_Y = 22;
const RANGE_DB = 12;

export function EqualizerCurve({ bandsDb, active }: { bandsDb: number[]; active: boolean }) {
  const reducedMotion = useLessMotion();
  const points = bandsDb.map((gain, index) => ({
    x: PADDING_X + index * ((WIDTH - PADDING_X * 2) / Math.max(1, bandsDb.length - 1)),
    y: gainToY(gain),
  }));
  const linePath = createSmoothPath(points);
  const baseline = gainToY(0);
  const firstPoint = points[0];
  const lastPoint = points.at(-1);
  const fillPath = firstPoint && lastPoint
    ? `${linePath} L ${lastPoint.x} ${baseline} L ${firstPoint.x} ${baseline} Z`
    : "";
  const transition = reducedMotion ? { duration: 0 } : { duration: 0.22, ease: "easeOut" as const };

  return (
    <div className={`eq-curve-shell${active ? " is-active" : ""}`}>
      <div className="eq-curve-scale" aria-hidden="true">
        <span>+12</span><span>0</span><span>−12</span>
      </div>
      <svg
        className="eq-curve"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={t("audio.eq.curve")}
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="eq-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--color-primary)" stopOpacity="0.28" />
            <stop offset="1" stopColor="var(--color-primary)" stopOpacity="0.015" />
          </linearGradient>
        </defs>
        {[-12, -6, 0, 6, 12].map((gain) => (
          <line
            key={gain}
            className={gain === 0 ? "eq-grid-line is-zero" : "eq-grid-line"}
            x1={PADDING_X}
            x2={WIDTH - PADDING_X}
            y1={gainToY(gain)}
            y2={gainToY(gain)}
          />
        ))}
        {points.map((point, index) => (
          <line
            key={index}
            className="eq-grid-line is-vertical"
            x1={point.x}
            x2={point.x}
            y1={PADDING_Y}
            y2={HEIGHT - PADDING_Y}
          />
        ))}
        <motion.path className="eq-curve-fill" initial={false} animate={{ d: fillPath }} transition={transition} />
        <motion.path className="eq-curve-line" initial={false} animate={{ d: linePath }} transition={transition} />
        {points.map((point, index) => (
          <motion.circle
            key={index}
            className="eq-curve-point"
            cx={point.x}
            r={active ? 4.5 : 3.5}
            initial={false}
            animate={{ cy: point.y }}
            transition={transition}
          />
        ))}
      </svg>
    </div>
  );
}

function gainToY(gain: number): number {
  const clamped = Math.min(RANGE_DB, Math.max(-RANGE_DB, gain));
  return PADDING_Y + ((RANGE_DB - clamped) / (RANGE_DB * 2)) * (HEIGHT - PADDING_Y * 2);
}

function createSmoothPath(points: Array<{ x: number; y: number }>): string {
  const firstPoint = points[0];
  if (!firstPoint) return "";
  return points.slice(1).reduce((path, point, index) => {
    const previous = points[index];
    if (!previous) return path;
    const midpoint = (previous.x + point.x) / 2;
    return `${path} C ${midpoint} ${previous.y}, ${midpoint} ${point.y}, ${point.x} ${point.y}`;
  }, `M ${firstPoint.x} ${firstPoint.y}`);
}
