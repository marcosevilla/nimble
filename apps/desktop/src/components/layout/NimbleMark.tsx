/* The C3 "Stamp" mark (public/favicon.svg, Figma 7CZR91ENBhMRrRDkKJSemR
   node 8:436) for the sidebar wordmark. The app-icon tile is dropped and
   the viewBox cropped to the glyph so the dots stay legible at 18px; the
   terracotta dots read on both themes, and the one near-black "ink" dot
   takes currentColor so it doesn't vanish on the dark sidebar. */

const DOTS: [number, number, string?][] = [
  [312, 379, '#D0735D'],
  [322, 462],
  [333, 545],
  [343, 629, '#A24B39'],
  [353, 712, 'currentColor'],
  [406, 452, '#D0735D'],
  [479, 358],
  [562, 348],
  [656, 421],
  [666, 505],
  [676, 588],
  [687, 672, '#D07460'],
]

export function NimbleMark({ className }: { className?: string }) {
  return (
    <svg viewBox="247 203 545 545" aria-hidden="true" focusable="false" className={className}>
      <g fill="#CC654F">
        {DOTS.map(([cx, cy, fill]) => (
          <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={36} fill={fill} />
        ))}
      </g>
      <circle cx={722} cy={243} r={40} fill="#FF4F00" />
    </svg>
  )
}
