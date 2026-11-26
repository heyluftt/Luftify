export const PIXEL_FILTER_SIZES = [2, 4, 8, 16] as const;

/** `filter: url(#pp-px-8)` shows an element in 8 px blocks (pixelpop-motion.css). */
export function PixelpopFilters() {
  return (
    <svg className="pixelpop-filters" width="0" height="0" aria-hidden="true" focusable="false">
      {PIXEL_FILTER_SIZES.map((size) => (
        <filter key={size} id={`pp-px-${size}`} x="0" y="0" width="1" height="1" colorInterpolationFilters="sRGB">
          <feFlood x={size / 2} y={size / 2} width="1" height="1" />
          <feComposite width={size} height={size} />
          <feTile result="grid" />
          <feComposite in="SourceGraphic" in2="grid" operator="in" />
          <feMorphology operator="dilate" radius={size / 2} />
        </filter>
      ))}
    </svg>
  );
}
