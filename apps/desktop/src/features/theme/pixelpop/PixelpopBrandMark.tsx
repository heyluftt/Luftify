/** A music note drawn in 8 × 8 pixels. */
const NOTE = [
  "....####",
  "....#..#",
  "....#..#",
  "....#...",
  "..###...",
  ".####...",
  ".####...",
  "..##....",
];
const CELL = 6;
const ORIGIN = 7;

const cells = NOTE.flatMap((row, y) => [...row].flatMap((bit, x) => (bit === "#" ? [[x, y] as const] : [])));

export function PixelpopBrandMark() {
  return (
    <g className="brand-mark-variant brand-mark-pixelpop" shapeRendering="crispEdges">
      {cells.map(([x, y]) => (
        <rect key={`s${x}-${y}`} x={ORIGIN + x * CELL + 3} y={ORIGIN + y * CELL + 3} width={CELL} height={CELL} fill="var(--pp-plum, #b65fcf)" />
      ))}
      {cells.map(([x, y]) => (
        <rect key={`n${x}-${y}`} x={ORIGIN + x * CELL} y={ORIGIN + y * CELL} width={CELL} height={CELL} fill={y < 3 ? "var(--pp-sun, #ffc94a)" : "var(--pp-coral, #ff6b5b)"} />
      ))}
    </g>
  );
}
