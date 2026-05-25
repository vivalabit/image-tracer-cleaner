import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";

import { fetchMethods, randomizeImage } from "./api";
import type { MethodDefinition, MethodParameter, NumericRange, Operation, OutputFormat, RandomizeRequest, RecipeStep } from "./types";

type AppMode = "manual" | "random" | "metadata" | "batch";
type PreviewMode = "compare" | "slider" | "difference";
type MetadataTab = "overview" | "exif" | "iptc" | "xmp" | "output";

type PipelineParam = {
  id: string;
  title: string;
  value: string;
  placeholder: string;
  unit: string;
  type: string;
  choices: string[];
  range: NumericRange | null;
};

type PipelineStep = RecipeStep & {
  id: string;
  title: string;
  category: string;
  impact: "subtle" | "medium" | "strong";
  paramControls: PipelineParam[];
};

type MetadataRow = {
  label: string;
  source: string;
  output: string;
  status: "kept" | "edited" | "removed";
};

const metadataRows: Record<MetadataTab, MetadataRow[]> = {
  overview: [
    { label: "Format", source: "JPEG", output: "PNG", status: "edited" },
    { label: "Dimensions", source: "2400 x 1600", output: "2398 x 1602", status: "edited" },
    { label: "File hash", source: "b72f...18a", output: "91ad...e44", status: "edited" },
    { label: "GPS", source: "Present", output: "Removed", status: "removed" },
  ],
  exif: [
    { label: "Make", source: "Canon", output: "Canon", status: "kept" },
    { label: "Model", source: "EOS R6", output: "EOS R6", status: "kept" },
    { label: "DateTimeOriginal", source: "2026:05:22 14:03:11", output: "2026:05:22 14:03:11", status: "kept" },
    { label: "GPSInfo", source: "46.2044, 6.1432", output: "Removed", status: "removed" },
  ],
  iptc: [
    { label: "Creator", source: "Sample author", output: "Removed", status: "removed" },
    { label: "Copyright", source: "Empty", output: "Edited", status: "edited" },
    { label: "Keywords", source: "product, draft", output: "product, processed", status: "edited" },
  ],
  xmp: [
    { label: "CreatorTool", source: "Lightroom", output: "Image Randomizer", status: "edited" },
    { label: "Rating", source: "0", output: "0", status: "kept" },
    { label: "History", source: "Present", output: "Removed", status: "removed" },
  ],
  output: [
    { label: "Color profile", source: "sRGB IEC61966", output: "sRGB IEC61966", status: "kept" },
    { label: "Compression", source: "JPEG 92", output: "PNG optimized", status: "edited" },
    { label: "Alpha", source: "None", output: "None", status: "kept" },
  ],
};

const endpointRows = [
  { method: "GET", path: "/api/methods", note: "operation registry" },
  { method: "POST", path: "/api/randomize", note: "multipart operations" },
];

function App() {
  const [mode, setMode] = useState<AppMode>("manual");
  const [previewMode, setPreviewMode] = useState<PreviewMode>("compare");
  const [metadataTab, setMetadataTab] = useState<MetadataTab>("overview");
  const [pipeline, setPipeline] = useState<PipelineStep[]>([]);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [methods, setMethods] = useState<MethodDefinition[]>([]);
  const [apiStatus, setApiStatus] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState("");
  const [outputBlob, setOutputBlob] = useState<Blob | null>(null);
  const [outputUrl, setOutputUrl] = useState("");
  const [seed, setSeed] = useState("42");
  const [outputFormat, setOutputFormat] = useState<OutputFormat>("PNG");
  const [isRendering, setIsRendering] = useState(false);
  const [renderError, setRenderError] = useState("");
  const nextPipelineStepId = useRef(0);

  useEffect(() => {
    let active = true;

    fetchMethods()
      .then((nextMethods) => {
        if (!active) {
          return;
        }
        setMethods(nextMethods);
        setApiStatus("");
      })
      .catch((error: unknown) => {
        if (!active) {
          return;
        }
        setApiStatus(error instanceof Error ? error.message : "Failed to load methods");
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!file) {
      setSourceUrl("");
      setOutputBlob(null);
      return;
    }

    const nextUrl = URL.createObjectURL(file);
    setSourceUrl(nextUrl);
    setOutputBlob(null);

    return () => URL.revokeObjectURL(nextUrl);
  }, [file]);

  useEffect(() => {
    if (!outputBlob) {
      setOutputUrl("");
      return;
    }

    const nextUrl = URL.createObjectURL(outputBlob);
    setOutputUrl(nextUrl);

    return () => URL.revokeObjectURL(nextUrl);
  }, [outputBlob]);

  const activeSteps = useMemo(() => pipeline.filter((step) => step.enabled), [pipeline]);
  const selectedStep = pipeline.find((step) => step.id === selectedStepId) ?? null;
  const methodsByName = useMemo(() => new Map(methods.map((method) => [method.name, method])), [methods]);
  const requestPreview = useMemo(
    () =>
      JSON.stringify(
        {
          file: file ? file.name : null,
          operations: activeSteps.map(toOperation),
          seed: parseSeedOrNull(seed),
          output_format: outputFormat,
        },
        null,
        2,
      ),
    [activeSteps, file, outputFormat, seed],
  );

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    setFile(event.target.files?.[0] ?? null);
  }

  function updateStep(stepId: string, patch: Partial<PipelineStep>) {
    setPipeline((current) =>
      current.map((step) => {
        if (step.id !== stepId) {
          return step;
        }

        const next = { ...step, ...patch };
        return { ...next, params: controlsToParams(next.paramControls) };
      }),
    );
    setOutputBlob(null);
  }

  function updateParam(stepId: string, paramId: string, value: string) {
    setPipeline((current) =>
      current.map((step) => {
        if (step.id !== stepId) {
          return step;
        }

        const paramControls = step.paramControls.map((param) => (param.id === paramId ? { ...param, value } : param));
        const next = { ...step, paramControls };
        return { ...next, params: controlsToParams(paramControls) };
      }),
    );
    setOutputBlob(null);
  }

  function clearParam(stepId: string, paramId: string) {
    updateParam(stepId, paramId, "");
  }

  function moveStep(stepId: string, direction: -1 | 1) {
    setPipeline((current) => {
      const index = current.findIndex((step) => step.id === stepId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) {
        return current;
      }

      const next = [...current];
      const [step] = next.splice(index, 1);
      next.splice(nextIndex, 0, step);
      return next;
    });
    setOutputBlob(null);
  }

  function addStep(methodName: string) {
    const method = methodsByName.get(methodName);
    if (!method) {
      return;
    }

    nextPipelineStepId.current += 1;
    const nextStep = createPipelineStep(method, nextPipelineStepId.current);

    setPipeline((current) => [...current, nextStep]);
    setSelectedStepId(nextStep.id);
    setOutputBlob(null);
  }

  function removeStep(stepId: string) {
    const next = pipeline.filter((step) => step.id !== stepId);
    setPipeline(next);
    if (selectedStepId === stepId) {
      setSelectedStepId(next[0]?.id ?? null);
    }
    setOutputBlob(null);
  }

  async function handleRandomize() {
    if (!file) {
      setRenderError("Choose an image first.");
      return;
    }

    setIsRendering(true);
    setRenderError("");

    try {
      const request: RandomizeRequest = {
        file,
        operations: activeSteps.map(toOperation),
        seed: parseSeed(seed),
        output_format: outputFormat,
      };
      const nextOutput = await randomizeImage(request);
      setOutputBlob(nextOutput);
    } catch (error) {
      setRenderError(error instanceof Error ? error.message : "Randomize request failed");
    } finally {
      setIsRendering(false);
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="app-mark" aria-hidden="true">
            IR
          </span>
          <div>
            <h1>Image Randomizer Studio</h1>
            <p>Frontend prototype</p>
          </div>
        </div>
        <div className="topbar-actions">
          <span className={apiStatus ? "status-pill warning" : "status-pill"}>{apiStatus ? "API offline" : "API ready"}</span>
          <button type="button" className="ghost-button">
            Save preset
          </button>
          <button type="button" className="primary-button" disabled={!file || isRendering} onClick={handleRandomize}>
            {isRendering ? "Rendering" : "Export"}
          </button>
        </div>
      </header>

      <section className="workspace">
        <aside className="control-panel" aria-label="Project controls">
          <label className="file-drop">
            <span className="eyebrow">Input image</span>
            <input type="file" accept="image/*" onChange={handleFileChange} />
            <strong>{file ? file.name : "Choose image"}</strong>
            <small>{file ? `${Math.round(file.size / 1024)} KB` : "PNG, JPEG, WEBP"}</small>
          </label>

          <div className="segmented-control" aria-label="Mode">
            {(["manual", "random", "metadata", "batch"] as const).map((nextMode) => (
              <button
                key={nextMode}
                type="button"
                className={mode === nextMode ? "active" : ""}
                onClick={() => setMode(nextMode)}
              >
                {formatMode(nextMode)}
              </button>
            ))}
          </div>

          <label className="field">
            <span>Seed</span>
            <input
              value={seed}
              inputMode="numeric"
              onChange={(event) => {
                setSeed(event.target.value);
                setOutputBlob(null);
              }}
            />
          </label>

          <label className="field">
            <span>Output format</span>
            <select
              value={outputFormat}
              onChange={(event) => {
                setOutputFormat(event.target.value as OutputFormat);
                setOutputBlob(null);
              }}
            >
              <option>PNG</option>
              <option>JPEG</option>
              <option>WEBP</option>
            </select>
          </label>

          <div className="preset-list" aria-label="Presets">
            {["Light cleanup", "Subtle variant", "Metadata strip"].map((preset) => (
              <button key={preset} type="button">
                {preset}
              </button>
            ))}
          </div>
        </aside>

        <section className="preview-panel" aria-label="Image preview">
          <div className="panel-header">
            <div>
              <span className="eyebrow">Preview</span>
              <h2>{activeSteps.length} active steps</h2>
            </div>
            <div className="view-tabs" aria-label="Preview view">
              {(["compare", "slider", "difference"] as const).map((view) => (
                <button
                  key={view}
                  type="button"
                  className={previewMode === view ? "active" : ""}
                  onClick={() => setPreviewMode(view)}
                >
                  {formatPreviewMode(view)}
                </button>
              ))}
            </div>
          </div>

          <div className={`preview-stage ${previewMode}`}>
            <ImageViewport title="Source" imageUrl={sourceUrl} variant="source" />
            <ImageViewport title="Output" imageUrl={outputUrl} variant="output" />
            {previewMode === "slider" ? <div className="slider-handle" aria-hidden="true" /> : null}
          </div>

          <div className="metric-strip" aria-label="Render metrics">
            <Metric label="Active steps" value={`${activeSteps.length}`} tone="info" />
            <Metric label="Format" value={outputFormat} tone="info" />
            <Metric label="Seed" value={seed.trim() || "none"} tone="good" />
            <Metric label="Result" value={renderError ? "error" : outputUrl ? "ready" : "idle"} tone={renderError ? "warn" : "good"} />
          </div>
          {renderError ? <p className="inline-error">{renderError}</p> : null}
        </section>

        <aside className="pipeline-panel" aria-label="Pipeline builder">
          <div className="panel-header compact">
            <div>
              <span className="eyebrow">Pipeline</span>
              <h2>Recipe</h2>
            </div>
            <button type="button" className="ghost-button small-button" disabled={!file || isRendering} onClick={handleRandomize}>
              {isRendering ? "Rendering" : "Randomize"}
            </button>
          </div>

          <div className="step-list">
            {pipeline.map((step, index) => (
              <article
                key={step.id}
                className={`step-card ${selectedStepId === step.id ? "selected" : ""}`}
                onClick={() => setSelectedStepId(step.id)}
              >
                <div className="step-order">{index + 1}</div>
                <div className="step-main">
                  <div className="step-title-row">
                    <strong>{step.title}</strong>
                    <span className={`impact-badge ${step.impact}`}>{step.impact}</span>
                  </div>
                  <span>{step.category}</span>
                </div>
                <div className="step-actions">
                  <button
                    type="button"
                    title="Toggle step"
                    aria-label="Toggle step"
                    className={step.enabled ? "icon-button active" : "icon-button"}
                    onClick={(event) => {
                      event.stopPropagation();
                      updateStep(step.id, { enabled: !step.enabled });
                    }}
                  >
                    O
                  </button>
                  <button
                    type="button"
                    title="Move up"
                    aria-label="Move up"
                    className="icon-button"
                    onClick={(event) => {
                      event.stopPropagation();
                      moveStep(step.id, -1);
                    }}
                  >
                    ^
                  </button>
                  <button
                    type="button"
                    title="Move down"
                    aria-label="Move down"
                    className="icon-button"
                    onClick={(event) => {
                      event.stopPropagation();
                      moveStep(step.id, 1);
                    }}
                  >
                    v
                  </button>
                  <button
                    type="button"
                    title="Delete"
                    aria-label="Delete"
                    className="icon-button danger"
                    onClick={(event) => {
                      event.stopPropagation();
                      removeStep(step.id);
                    }}
                  >
                    x
                  </button>
                </div>
              </article>
            ))}
          </div>

          <div className="add-step-grid">
            {methods.length > 0 ? (
              methods.map((method) => (
                <button key={method.name} type="button" onClick={() => addStep(method.name)}>
                  + {method.title}
                </button>
              ))
            ) : (
              <div className="empty-row">{apiStatus ? "Operations unavailable" : "Loading operations"}</div>
            )}
          </div>
        </aside>
      </section>

      <section className="detail-grid">
        <section className="settings-panel" aria-label="Selected operation settings">
          {selectedStep ? (
            <>
              <div className="panel-header compact">
                <div>
                  <span className="eyebrow">Step settings</span>
                  <h2>{selectedStep.title}</h2>
                </div>
              </div>

              <div className="param-grid">
                {selectedStep.paramControls.length > 0 ? (
                  selectedStep.paramControls.map((param) => (
                    <ParamControl
                      key={param.id}
                      param={param}
                      onClear={() => clearParam(selectedStep.id, param.id)}
                      onChange={(value) => updateParam(selectedStep.id, param.id, value)}
                    />
                  ))
                ) : (
                  <div className="empty-row">No parameters</div>
                )}
              </div>
            </>
          ) : (
            <div className="empty-row">No selected step</div>
          )}
        </section>

        <section className="metadata-panel" aria-label="Metadata editor">
          <div className="panel-header compact">
            <div>
              <span className="eyebrow">Metadata</span>
              <h2>Source to output</h2>
            </div>
            <div className="metadata-actions">
              <button type="button">Strip all</button>
              <button type="button">Keep safe</button>
              <button type="button">Template</button>
            </div>
          </div>

          <div className="metadata-tabs">
            {(["overview", "exif", "iptc", "xmp", "output"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                className={metadataTab === tab ? "active" : ""}
                onClick={() => setMetadataTab(tab)}
              >
                {tab.toUpperCase()}
              </button>
            ))}
          </div>

          <div className="metadata-table">
            {metadataRows[metadataTab].map((row) => (
              <div className="metadata-row" key={`${metadataTab}-${row.label}`}>
                <strong>{row.label}</strong>
                <span>{row.source}</span>
                <span>{row.output}</span>
                <mark className={row.status}>{row.status}</mark>
              </div>
            ))}
          </div>
        </section>

        <section className="api-panel" aria-label="API surface">
          <div className="panel-header compact">
            <div>
              <span className="eyebrow">API</span>
              <h2>Contract draft</h2>
            </div>
            <button type="button" className="ghost-button small-button">
              Open docs
            </button>
          </div>

          <div className="endpoint-list">
            {endpointRows.map((endpoint) => (
              <div className="endpoint-row" key={endpoint.path}>
                <code>{endpoint.method}</code>
                <span>{endpoint.path}</span>
                <small>{endpoint.note}</small>
              </div>
            ))}
          </div>
          <pre className="recipe-preview">{requestPreview}</pre>
        </section>
      </section>
    </main>
  );
}

function ImageViewport(props: { title: string; imageUrl: string; variant: "source" | "output" }) {
  return (
    <figure className={`image-viewport ${props.variant}`}>
      <figcaption>{props.title}</figcaption>
      <div className="image-canvas">
        {props.imageUrl ? <img src={props.imageUrl} alt={props.title} /> : <MockImage variant={props.variant} />}
      </div>
    </figure>
  );
}

function MockImage(props: { variant: "source" | "output" }) {
  return (
    <div className={`mock-image ${props.variant}`} aria-label={`${props.variant} mock image`}>
      <span className="mock-sky" />
      <span className="mock-block primary" />
      <span className="mock-block secondary" />
      <span className="mock-line one" />
      <span className="mock-line two" />
    </div>
  );
}

function Metric(props: { label: string; value: string; tone: "good" | "warn" | "info" }) {
  return (
    <div className={`metric ${props.tone}`}>
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

function ParamControl(props: { param: PipelineParam; onChange: (value: string) => void; onClear: () => void }) {
  const status = props.param.value.trim() === "" ? "backend" : "set";

  return (
    <div className={`param-row ${props.param.type}`}>
      <span className="param-title">{props.param.title}</span>
      <div className="param-control">{renderParamInput(props.param, props.onChange)}</div>
      <small>{status}</small>
      <button type="button" className="param-reset" disabled={status === "backend"} onClick={props.onClear}>
        Default
      </button>
    </div>
  );
}

function renderParamInput(param: PipelineParam, onChange: (value: string) => void) {
  if (param.type === "integer" || param.type === "number") {
    const range = getNumericRange(param);
    const step = param.type === "integer" ? "1" : "0.1";

    return (
      <div className="number-param">
        <input
          type="number"
          min={range.min}
          max={range.max}
          step={step}
          value={param.value}
          placeholder={param.placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
        <input
          type="range"
          min={range.min}
          max={range.max}
          step={step}
          value={getSliderValue(param, range)}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
    );
  }

  if (param.type === "enum") {
    return (
      <select value={param.value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Backend default</option>
        {param.choices.map((choice) => (
          <option key={choice} value={choice}>
            {choice}
          </option>
        ))}
      </select>
    );
  }

  if (param.type === "rgb_color") {
    return (
      <div className="color-param">
        <input
          type="color"
          value={normalizeColorValue(param.value)}
          onChange={(event) => onChange(event.target.value)}
        />
        <code>{param.value || "backend"}</code>
      </div>
    );
  }

  return (
    <input
      value={param.value}
      placeholder={param.placeholder}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function formatMode(mode: AppMode): string {
  const labels: Record<AppMode, string> = {
    manual: "Manual",
    random: "Random",
    metadata: "Metadata",
    batch: "Batch",
  };
  return labels[mode];
}

function formatPreviewMode(mode: PreviewMode): string {
  const labels: Record<PreviewMode, string> = {
    compare: "Side by side",
    slider: "Slider",
    difference: "Diff",
  };
  return labels[mode];
}

function createPipelineStep(method: MethodDefinition, stepNumber: number): PipelineStep {
  const paramControls = method.parameters.map(createParamControl);

  return {
    id: `${method.name}-${stepNumber}`,
    name: method.name,
    title: method.title,
    category: inferCategory(method.name),
    enabled: true,
    impact: inferImpact(method.name),
    params: controlsToParams(paramControls),
    paramControls,
  };
}

function createParamControl(parameter: MethodParameter): PipelineParam {
  return {
    id: parameter.name,
    title: parameter.title,
    value: "",
    placeholder: formatParamPlaceholder(parameter),
    unit: inferUnit(parameter.name),
    type: parameter.type,
    choices: parameter.choices.map(String),
    range: parameter.value_range ?? parameter.random_default,
  };
}

function toOperation(step: PipelineStep): Operation {
  return {
    name: step.name,
    params: step.params,
  };
}

function controlsToParams(params: PipelineParam[]): Record<string, unknown> {
  return params.reduce<Record<string, unknown>>((result, param) => {
    const value = parseParamValue(param.value, param.type);
    if (value !== undefined) {
      result[param.id] = value;
    }
    return result;
  }, {});
}

function parseParamValue(value: string, type: string): unknown {
  const normalized = value.trim();
  if (normalized === "") {
    return undefined;
  }

  if (type === "integer") {
    const parsed = Number.parseInt(normalized, 10);
    return Number.isFinite(parsed) ? parsed : normalized;
  }

  if (type === "number") {
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : normalized;
  }

  if (type === "rgb_color") {
    if (/^#[0-9a-fA-F]{6}$/.test(normalized)) {
      return [
        Number.parseInt(normalized.slice(1, 3), 16),
        Number.parseInt(normalized.slice(3, 5), 16),
        Number.parseInt(normalized.slice(5, 7), 16),
      ];
    }

    const channels = normalized.split(/[,\s]+/).map((channel) => Number.parseInt(channel, 10));
    return channels.length === 3 && channels.every(Number.isFinite) ? channels : normalized;
  }

  return normalized;
}

function parseSeed(value: string): number | null {
  const normalized = value.trim();
  if (normalized === "") {
    return null;
  }

  const parsed = Number(normalized);
  if (!Number.isInteger(parsed)) {
    throw new Error("Seed must be an integer or empty.");
  }
  return parsed;
}

function parseSeedOrNull(value: string): number | null {
  try {
    return parseSeed(value);
  } catch {
    return null;
  }
}

function formatParamPlaceholder(parameter: MethodParameter): string {
  if (parameter.default !== null && parameter.default !== undefined) {
    return String(parameter.default);
  }

  if (parameter.random_default) {
    return `${parameter.random_default.min}-${parameter.random_default.max}`;
  }

  if (parameter.value_range) {
    return `${parameter.value_range.min}-${parameter.value_range.max}`;
  }

  return "";
}

function getNumericRange(param: PipelineParam): NumericRange {
  return param.range ?? { min: 0, max: 100 };
}

function getSliderValue(param: PipelineParam, range: NumericRange): number {
  const value = Number(param.value);
  if (Number.isFinite(value)) {
    return Math.min(range.max, Math.max(range.min, value));
  }

  const placeholderValue = Number(param.placeholder);
  if (Number.isFinite(placeholderValue)) {
    return Math.min(range.max, Math.max(range.min, placeholderValue));
  }

  return (range.min + range.max) / 2;
}

function normalizeColorValue(value: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#ffffff";
}

function inferUnit(name: string): string {
  if (name.endsWith("_pct") || name === "amount") {
    return "%";
  }
  if (name === "angle") {
    return "deg";
  }
  if (name === "size" || name.endsWith("_size") || name === "radius" || name === "x" || name === "y") {
    return "px";
  }
  return "";
}

function inferCategory(name: string): string {
  if (["crop", "resize", "fixresize", "rotate", "hmirror", "vmirror", "move"].includes(name)) {
    return "Geometry";
  }
  if (["invert", "grayscale", "sharp"].includes(name)) {
    return "Color";
  }
  if (["interference", "blur", "eskiz", "pixelization"].includes(name)) {
    return "Pixels";
  }
  return "Custom";
}

function inferImpact(name: string): PipelineStep["impact"] {
  if (["hmirror", "vmirror", "invert", "grayscale", "eskiz", "pixelization"].includes(name)) {
    return "strong";
  }
  if (["crop", "rotate", "border", "blur", "move"].includes(name)) {
    return "medium";
  }
  return "subtle";
}

export default App;
