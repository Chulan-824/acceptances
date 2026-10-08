/*
 * Provenance notice (recorded 2026-10-08); renderer origin/derivation remains pending.
 * Visualization protocol and short scale/domain expressions have upstream correspondences.
 * AI-assisted local rewrite referenced lobehub/lobehub@1c7a7116313bcc2d675937139554a244f7adf7a0.
 * Applicable upstream portions retain LobeHub Community License + Apache-2.0 and
 * Copyright (c) 2024/06/17 - current LobeHub LLC. All rights reserved.
 * See ../LICENSE-SCOPE.md, ../NOTICE and ../docs/licensing/lobehub-provenance.md.
 * This notice does not certify the whole component as derived or grant MIT.
 */
import { useMemo } from "react";

import type {
  ChartSeries,
  Dataset,
  Visualization,
} from "./types";

const WIDTH = 720;
const HEIGHT = 260;
const PAD = { top: 18, right: 18, bottom: 42, left: 52 };
const COLORS = ["#111827", "#2563eb", "#d97706", "#059669", "#9333ea"];

function numeric(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function format(value: unknown) {
  if (typeof value === "number") {
    return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 4 }).format(value);
  }
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

function extent(values: number[]) {
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  if (minimum === maximum) {
    const padding = Math.abs(minimum) * 0.1 || 1;
    return [minimum - padding, maximum + padding] as const;
  }
  return [minimum, maximum] as const;
}

function scale(value: number, domain: readonly [number, number], range: readonly [number, number]) {
  return (
    range[0] +
    ((value - domain[0]) / (domain[1] - domain[0])) * (range[1] - range[0])
  );
}

function titleOf(view: Visualization) {
  return view.title || view.id;
}

function ChartFrame({
  title,
  xLabel,
  yLabel,
  children,
}: {
  title: string;
  xLabel?: string;
  yLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <figure className="visual chart">
      <figcaption>{title}</figcaption>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={title}>
        <line className="axis" x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={HEIGHT - PAD.bottom} />
        <line
          className="axis"
          x1={PAD.left}
          y1={HEIGHT - PAD.bottom}
          x2={WIDTH - PAD.right}
          y2={HEIGHT - PAD.bottom}
        />
        {children}
        {xLabel ? (
          <text className="axis-label" x={WIDTH / 2} y={HEIGHT - 8} textAnchor="middle">
            {xLabel}
          </text>
        ) : null}
        {yLabel ? (
          <text
            className="axis-label"
            x={14}
            y={HEIGHT / 2}
            textAnchor="middle"
            transform={`rotate(-90 14 ${HEIGHT / 2})`}
          >
            {yLabel}
          </text>
        ) : null}
      </svg>
    </figure>
  );
}

function Legend({ series }: { series: ChartSeries[] }) {
  return (
    <div className="legend">
      {series.map((entry, index) => (
        <span key={entry.field}>
          <i style={{ background: COLORS[index % COLORS.length] }} />
          {entry.label || entry.field}
        </span>
      ))}
    </div>
  );
}

function MetricComparison({ dataset, view }: ViewProps) {
  const encoding = view.encoding || {};
  if (!encoding.label || !encoding.before || !encoding.after) {
    return <Invalid view={view} reason="缺少 label、before 或 after 编码" />;
  }
  return (
    <figure className="visual metrics">
      <figcaption>{titleOf(view)}</figcaption>
      <div className="metric-grid">
        {dataset.rows.map((row, index) => {
          const before = numeric(row[encoding.before!]);
          const after = numeric(row[encoding.after!]);
          const delta = before === null || after === null ? null : after - before;
          const unit = encoding.unit ? format(row[encoding.unit]) : "";
          return (
            <article key={index}>
              <strong>{format(row[encoding.label!])}</strong>
              <div className="metric-values">
                <span>{format(row[encoding.before!])}{unit}</span>
                <b aria-hidden="true">→</b>
                <span>{format(row[encoding.after!])}{unit}</span>
              </div>
              <small>{delta === null ? "无数值变化" : `变化 ${delta > 0 ? "+" : ""}${format(delta)}${unit}`}</small>
            </article>
          );
        })}
      </div>
      {view.context ? <p className="visual-context">{view.context}</p> : null}
    </figure>
  );
}

function LineChart({ dataset, view }: ViewProps) {
  const encoding = view.encoding || {};
  const series = encoding.series || [];
  if (!encoding.x || series.length === 0) {
    return <Invalid view={view} reason="缺少 x 或 series 编码" />;
  }
  const points = dataset.rows.map((row, index) => ({
    x: numeric(row[encoding.x!]) ?? index,
    row,
  }));
  const yValues = points.flatMap(({ row }) =>
    series.map((entry) => numeric(row[entry.field])).filter((value): value is number => value !== null),
  );
  if (!points.length || !yValues.length) return <Invalid view={view} reason="没有可绘制的数值" />;
  const xDomain = extent(points.map((point) => point.x));
  const yDomain = extent(yValues);
  return (
    <ChartFrame title={titleOf(view)} xLabel={encoding.xLabel || encoding.x} yLabel={encoding.yLabel}>
      {series.map((entry, seriesIndex) => {
        const values = points
          .map((point) => {
            const y = numeric(point.row[entry.field]);
            return y === null
              ? null
              : `${scale(point.x, xDomain, [PAD.left, WIDTH - PAD.right])},${scale(y, yDomain, [HEIGHT - PAD.bottom, PAD.top])}`;
          })
          .filter(Boolean)
          .join(" ");
        return <polyline key={entry.field} points={values} fill="none" stroke={COLORS[seriesIndex % COLORS.length]} strokeWidth="2.5" />;
      })}
      <foreignObject x={PAD.left} y={HEIGHT - PAD.bottom + 8} width={WIDTH - PAD.left - PAD.right} height="30">
        <Legend series={series} />
      </foreignObject>
    </ChartFrame>
  );
}

function BarChart({ dataset, view }: ViewProps) {
  const encoding = view.encoding || {};
  const series = encoding.series || [];
  if (!encoding.category || series.length === 0) {
    return <Invalid view={view} reason="缺少 category 或 series 编码" />;
  }
  const values = dataset.rows.flatMap((row) =>
    series.map((entry) => numeric(row[entry.field])).filter((value): value is number => value !== null),
  );
  if (!values.length) return <Invalid view={view} reason="没有可绘制的数值" />;
  const yDomain = extent([...values, 0]);
  const plotWidth = WIDTH - PAD.left - PAD.right;
  const groupWidth = plotWidth / Math.max(dataset.rows.length, 1);
  const barWidth = Math.max(2, (groupWidth * 0.72) / series.length);
  const baseline = scale(0, yDomain, [HEIGHT - PAD.bottom, PAD.top]);
  return (
    <ChartFrame title={titleOf(view)} xLabel={encoding.category} yLabel={encoding.valueLabel}>
      {dataset.rows.flatMap((row, rowIndex) =>
        series.map((entry, seriesIndex) => {
          const value = numeric(row[entry.field]);
          if (value === null) return null;
          const y = scale(value, yDomain, [HEIGHT - PAD.bottom, PAD.top]);
          const x = PAD.left + rowIndex * groupWidth + groupWidth * 0.14 + seriesIndex * barWidth;
          return (
            <g key={`${rowIndex}-${entry.field}`}>
              <rect x={x} y={Math.min(y, baseline)} width={barWidth - 2} height={Math.max(1, Math.abs(baseline - y))} fill={COLORS[seriesIndex % COLORS.length]}>
                <title>{`${format(row[encoding.category!])}: ${format(value)}`}</title>
              </rect>
              {seriesIndex === 0 ? (
                <text className="tick" x={PAD.left + rowIndex * groupWidth + groupWidth / 2} y={HEIGHT - PAD.bottom + 14} textAnchor="middle">
                  {format(row[encoding.category!]).slice(0, 10)}
                </text>
              ) : null}
            </g>
          );
        }),
      )}
      <foreignObject x={PAD.left} y={2} width={WIDTH - PAD.left - PAD.right} height="28">
        <Legend series={series} />
      </foreignObject>
    </ChartFrame>
  );
}

function ScatterPlot({ dataset, view }: ViewProps) {
  const encoding = view.encoding || {};
  if (!encoding.x || !encoding.y) return <Invalid view={view} reason="缺少 x 或 y 编码" />;
  const points = dataset.rows
    .map((row) => ({ row, x: numeric(row[encoding.x!]), y: numeric(row[encoding.y!]) }))
    .filter((point): point is { row: Record<string, unknown>; x: number; y: number } => point.x !== null && point.y !== null);
  if (!points.length) return <Invalid view={view} reason="没有可绘制的数值" />;
  const xDomain = extent(points.map((point) => point.x));
  const yDomain = extent(points.map((point) => point.y));
  const groups = [...new Set(points.map((point) => String(encoding.color ? point.row[encoding.color] : "")))];
  return (
    <ChartFrame title={titleOf(view)} xLabel={encoding.xLabel || encoding.x} yLabel={encoding.yLabel || encoding.y}>
      {points.map((point, index) => {
        const group = String(encoding.color ? point.row[encoding.color] : "");
        return (
          <circle
            key={index}
            cx={scale(point.x, xDomain, [PAD.left, WIDTH - PAD.right])}
            cy={scale(point.y, yDomain, [HEIGHT - PAD.bottom, PAD.top])}
            r="5"
            fill={COLORS[Math.max(0, groups.indexOf(group)) % COLORS.length]}
          >
            <title>{encoding.label ? format(point.row[encoding.label]) : `${format(point.x)}, ${format(point.y)}`}</title>
          </circle>
        );
      })}
    </ChartFrame>
  );
}

function Heatmap({ dataset, view }: ViewProps) {
  const encoding = view.encoding || {};
  if (!encoding.x || !encoding.y || !encoding.value) {
    return <Invalid view={view} reason="缺少 x、y 或 value 编码" />;
  }
  const xs = [...new Set(dataset.rows.map((row) => format(row[encoding.x!])))];
  const ys = [...new Set(dataset.rows.map((row) => format(row[encoding.y!])))];
  const values = dataset.rows.map((row) => numeric(row[encoding.value!])).filter((value): value is number => value !== null);
  if (!values.length) return <Invalid view={view} reason="没有可绘制的数值" />;
  const [minimum, maximum] = extent(values);
  const byCell = new Map(dataset.rows.map((row) => [`${format(row[encoding.x!])}\0${format(row[encoding.y!])}`, row]));
  return (
    <figure className="visual heatmap">
      <figcaption>{titleOf(view)}</figcaption>
      <div className="heatmap-scroll">
        <div className="heatmap-grid" style={{ gridTemplateColumns: `minmax(90px, auto) repeat(${xs.length}, minmax(64px, 1fr))` }}>
          <span />
          {xs.map((x) => <strong key={x}>{x}</strong>)}
          {ys.flatMap((y) => [
            <strong key={`y-${y}`}>{y}</strong>,
            ...xs.map((x) => {
              const row = byCell.get(`${x}\0${y}`);
              const value = row ? numeric(row[encoding.value!]) : null;
              const alpha = value === null ? 0 : 0.16 + 0.78 * ((value - minimum) / (maximum - minimum));
              return <span key={`${x}-${y}`} style={{ background: value === null ? "#f3f4f6" : `rgba(37, 99, 235, ${alpha})`, color: alpha > 0.72 ? "white" : "#111827" }}>{format(value)}</span>;
            }),
          ])}
        </div>
      </div>
    </figure>
  );
}

function TableView({ dataset, view }: ViewProps) {
  const requested = view.encoding?.columns;
  const columns = requested?.length ? requested : dataset.fields.map((field) => field.key);
  const extrema = new Map<string, unknown>();
  for (const highlight of view.encoding?.highlights || []) {
    const values = dataset.rows.map((row) => numeric(row[highlight.field])).filter((value): value is number => value !== null);
    if (values.length) extrema.set(highlight.field, highlight.mode === "min" ? Math.min(...values) : Math.max(...values));
  }
  return (
    <figure className="visual table-view">
      <figcaption>{titleOf(view)}</figcaption>
      <div className="table-scroll">
        <table>
          <thead><tr>{columns.map((column) => <th key={column}>{dataset.fields.find((field) => field.key === column)?.label || column}</th>)}</tr></thead>
          <tbody>
            {dataset.rows.map((row, index) => (
              <tr key={index}>{columns.map((column) => <td className={extrema.get(column) === numeric(row[column]) ? "highlight" : ""} key={column}>{format(row[column])}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

function Invalid({ view, reason }: { view: Visualization; reason: string }) {
  return <p className="visual invalid"><strong>{titleOf(view)}</strong>：{reason}</p>;
}

interface ViewProps {
  dataset: Dataset;
  view: Visualization;
}

function VisualizationView(props: ViewProps) {
  switch (props.view.type) {
    case "metric-comparison": return <MetricComparison {...props} />;
    case "line-chart": return <LineChart {...props} />;
    case "bar-chart": return <BarChart {...props} />;
    case "scatter-plot": return <ScatterPlot {...props} />;
    case "heatmap": return <Heatmap {...props} />;
    case "table": return <TableView {...props} />;
    default: return <Invalid view={props.view} reason={`不支持 ${props.view.type}`} />;
  }
}

export function Visualizations({ datasets = [], views = [] }: { datasets?: Dataset[]; views?: Visualization[] }) {
  const datasetById = useMemo(() => new Map(datasets.map((dataset) => [dataset.id, dataset])), [datasets]);
  if (!views.length) return null;
  return (
    <section className="visualizations" aria-label="结构化可视化">
      {views.map((view) => {
        const dataset = datasetById.get(view.dataset);
        return dataset ? <VisualizationView dataset={dataset} key={view.id} view={view} /> : <Invalid key={view.id} view={view} reason={`找不到数据集 ${view.dataset}`} />;
      })}
    </section>
  );
}
