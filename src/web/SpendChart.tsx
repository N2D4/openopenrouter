import { useState } from "react";
import { usd } from "./api";

type Day = { date: string; cost: number; requests: number };

const W = 720;
const H = 220;
const PAD = { top: 12, right: 8, bottom: 26, left: 52 };

function niceMax(v: number) {
  if (v <= 0) return 1;
  const exp = 10 ** Math.floor(Math.log10(v));
  const f = v / exp;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * exp;
}

/** Bar path with 4px rounded top corners, flat at the baseline. */
function barPath(x: number, y: number, w: number, h: number) {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

/** Daily spend over the selected window. Missing days are shown as zero. */
export function SpendChart({ days, windowDays }: { days: Day[]; windowDays: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const byDate = new Map(days.map((d) => [d.date, d]));
  const series: Day[] = [];
  for (let i = windowDays - 1; i >= 0; i--) {
    const date = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    series.push(byDate.get(date) ?? { date, cost: 0, requests: 0 });
  }
  const max = niceMax(Math.max(...series.map((d) => d.cost)));
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const slot = innerW / series.length;
  const barW = Math.max(2, slot - 2); // 2px surface gap between bars
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  const h = hover != null ? series[hover] : null;

  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Daily spend, last ${windowDays} days`}>
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid-line" x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} />
            <text className="axis-label" x={PAD.left - 8} y={y(t) + 4} textAnchor="end">
              {usd(t, max < 1 ? 2 : 0)}
            </text>
          </g>
        ))}
        {series.map((d, i) => {
          const x = PAD.left + i * slot + 1;
          const bh = Math.max(d.cost > 0 ? 1 : 0, (d.cost / max) * innerH);
          return (
            <g key={d.date}>
              {bh > 0 && <path className={`bar${hover === i ? " hover" : ""}`} d={barPath(x, y(0) - bh, barW, bh)} />}
              <rect className="hit" x={x - 1} y={PAD.top} width={slot} height={innerH} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
              {(i % 7 === (series.length - 1) % 7) && (
                <text className="axis-label" x={x + barW / 2} y={H - 8} textAnchor="middle">
                  {new Date(`${d.date}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {h && hover != null && (
        <div className="tooltip" style={{ left: `${((PAD.left + hover * slot + slot / 2) / W) * 100}%`, top: `${(y(h.cost) / H) * 100}%` }}>
          <span className="faint">{new Date(`${h.date}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}</span>
          <strong>{usd(h.cost)}</strong>
          <span className="faint">{h.requests.toLocaleString()} requests</span>
        </div>
      )}
    </div>
  );
}
