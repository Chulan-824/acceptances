/*
 * Source/modification notice (recorded 2026-10-08).
 * Changed for local use: adapted visualization protocol checks to field maps and Diagnostic results.
 * Upstream portions: Copyright (c) 2024/06/17 - current LobeHub LLC. All rights reserved.
 * Reference: lobehub/lobehub@1c7a7116313bcc2d675937139554a244f7adf7a0.
 * Retain LobeHub Community License + Apache-2.0 for upstream expression/adaptations;
 * see ../LICENSE-SCOPE.md, ../NOTICE and ../docs/licensing/lobehub-provenance.md.
 * Local additions and the exact mixed-content boundary remain pending; no file-wide MIT grant.
 */
import {
  FIELD_TYPES,
  VISUALIZATION_TYPES,
} from "./validation-rules-v0.1.0.js";

const SERIES_STYLES = new Set(["muted", "primary", "accent"]);
const HIGHLIGHT_MODES = new Set(["min", "max"]);

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function string(value) {
  return typeof value === "string" && value.trim() !== "";
}

function scalar(value) {
  return value === null || ["string", "number", "boolean"].includes(typeof value);
}

export function validateVisualizations(entry, casePath, add) {
  const datasets = entry.datasets ?? [];
  const views = entry.visualizations ?? [];
  if (!Array.isArray(datasets)) {
    add("DATASETS_INVALID", "reject", `${casePath}/datasets`, "datasets 必须是数组");
    return 0;
  }
  if (!Array.isArray(views)) {
    add("VISUALIZATIONS_INVALID", "reject", `${casePath}/visualizations`, "visualizations 必须是数组");
    return 0;
  }

  const datasetById = new Map();
  let rows = 0;
  datasets.forEach((dataset, index) => {
    const base = `${casePath}/datasets/${index}`;
    if (!object(dataset) || !string(dataset.id)) {
      add("DATASET_INVALID", "reject", base, "dataset 需要非空 id");
      return;
    }
    if (datasetById.has(dataset.id)) {
      add("DATASET_ID_DUPLICATE", "reject", `${base}/id`, "dataset id 必须唯一");
    }
    const fields = Array.isArray(dataset.fields) ? dataset.fields : null;
    const values = Array.isArray(dataset.rows) ? dataset.rows : null;
    if (!fields || !values) {
      add("DATASET_SHAPE_INVALID", "reject", base, "dataset 需要 fields 和 rows 数组");
      return;
    }
    const keys = new Set();
    fields.forEach((field, fieldIndex) => {
      const fieldPath = `${base}/fields/${fieldIndex}`;
      if (!object(field) || !string(field.key) || !FIELD_TYPES.has(field.type)) {
        add("DATASET_FIELD_INVALID", "reject", fieldPath, "field 需要唯一 key 和合法 type");
        return;
      }
      if (keys.has(field.key)) {
        add("DATASET_FIELD_DUPLICATE", "reject", `${fieldPath}/key`, "field key 必须唯一");
      }
      keys.add(field.key);
      if (field.label !== undefined && !string(field.label)) {
        add("DATASET_FIELD_LABEL_INVALID", "reject", `${fieldPath}/label`, "field label 必须是非空字符串");
      }
    });
    values.forEach((row, rowIndex) => {
      const rowPath = `${base}/rows/${rowIndex}`;
      if (!object(row)) {
        add("DATASET_ROW_INVALID", "reject", rowPath, "row 必须是对象");
        return;
      }
      for (const [key, value] of Object.entries(row)) {
        if (!keys.has(key) || !scalar(value)) {
          add("DATASET_ROW_VALUE_INVALID", "reject", `${rowPath}/${key}`, "row 只能包含已声明字段和标量值");
        }
      }
    });
    rows += values.length;
    datasetById.set(dataset.id, { dataset, keys });
  });

  const viewIds = new Set();
  views.forEach((view, index) => {
    const base = `${casePath}/visualizations/${index}`;
    if (!object(view) || !string(view.id) || !VISUALIZATION_TYPES.has(view.type) || view.version !== 1 || !string(view.dataset)) {
      add("VISUALIZATION_INVALID", "reject", base, "visualization 需要唯一 id、公开 type、version 1 和 dataset");
      return;
    }
    if (viewIds.has(view.id)) add("VISUALIZATION_ID_DUPLICATE", "reject", `${base}/id`, "visualization id 必须唯一");
    viewIds.add(view.id);
    const target = datasetById.get(view.dataset);
    if (!target) {
      add("VISUALIZATION_DATASET_MISSING", "reject", `${base}/dataset`, "visualization 引用了不存在的 dataset");
      return;
    }
    if (view.title !== undefined && !string(view.title)) add("VISUALIZATION_TITLE_INVALID", "reject", `${base}/title`, "title 必须是非空字符串");
    if (view.context !== undefined && !string(view.context)) add("VISUALIZATION_CONTEXT_INVALID", "reject", `${base}/context`, "context 必须是非空字符串");
    validateEncoding(view, target.keys, base, add);
  });
  return rows;
}

function validateEncoding(view, keys, base, add) {
  const encoding = view.encoding ?? {};
  if (!object(encoding)) {
    add("VISUALIZATION_ENCODING_INVALID", "reject", `${base}/encoding`, "encoding 必须是对象");
    return;
  }
  const requireFields = {
    "metric-comparison": ["label", "before", "after"],
    "line-chart": ["x"],
    "bar-chart": ["category"],
    "scatter-plot": ["x", "y"],
    heatmap: ["x", "y", "value"],
    table: [],
  }[view.type];
  for (const name of requireFields) {
    if (!string(encoding[name]) || !keys.has(encoding[name])) {
      add("VISUALIZATION_ENCODING_FIELD_INVALID", "reject", `${base}/encoding/${name}`, `${name} 必须引用已声明字段`);
    }
  }
  for (const name of ["beforeSamples", "afterSamples", "direction", "statistic", "target", "unit", "color", "label"]) {
    if (encoding[name] !== undefined && (!string(encoding[name]) || !keys.has(encoding[name]))) {
      add("VISUALIZATION_ENCODING_FIELD_INVALID", "reject", `${base}/encoding/${name}`, `${name} 必须引用已声明字段`);
    }
  }
  if (view.type === "line-chart" || view.type === "bar-chart") {
    if (!Array.isArray(encoding.series) || encoding.series.length === 0) {
      add("VISUALIZATION_SERIES_INVALID", "reject", `${base}/encoding/series`, "series 必须是非空数组");
    } else {
      encoding.series.forEach((series, index) => {
        const seriesPath = `${base}/encoding/series/${index}`;
        if (!object(series) || !string(series.field) || !keys.has(series.field)) {
          add("VISUALIZATION_SERIES_FIELD_INVALID", "reject", seriesPath, "series field 必须引用已声明字段");
        }
        if (series?.style !== undefined && !SERIES_STYLES.has(series.style)) {
          add("VISUALIZATION_SERIES_STYLE_INVALID", "reject", `${seriesPath}/style`, "series style 不在公开词表中");
        }
      });
    }
  }
  if (view.type === "table") {
    if (encoding.columns !== undefined && (!Array.isArray(encoding.columns) || encoding.columns.some((key) => !keys.has(key)))) {
      add("VISUALIZATION_COLUMNS_INVALID", "reject", `${base}/encoding/columns`, "columns 必须引用已声明字段");
    }
    if (encoding.highlights !== undefined) {
      if (!Array.isArray(encoding.highlights)) {
        add("VISUALIZATION_HIGHLIGHTS_INVALID", "reject", `${base}/encoding/highlights`, "highlights 必须是数组");
      } else {
        encoding.highlights.forEach((item, index) => {
          if (!object(item) || !keys.has(item.field) || !HIGHLIGHT_MODES.has(item.mode)) {
            add("VISUALIZATION_HIGHLIGHT_INVALID", "reject", `${base}/encoding/highlights/${index}`, "highlight 需要合法 field 和 mode");
          }
        });
      }
    }
  }
}
