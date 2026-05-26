import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";

import { fetchMethods, randomizeImage, readImageMetadata } from "./api";
import type {
  ImageMetadata,
  MethodDefinition,
  MethodParameter,
  NumericRange,
  Operation,
  OutputFormat,
  RandomizeRequest,
  RecipeStep,
} from "./types";

type AppMode = "manual" | "random" | "metadata" | "batch";
type PreviewMode = "compare" | "slider" | "difference";
type MetadataTab = "overview" | "exif" | "iptc" | "xmp" | "output";
type ParamMode = "manual" | "random";

type PipelineParam = {
  id: string;
  title: string;
  mode: ParamMode;
  value: string;
  minValue: string;
  maxValue: string;
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
  const [metadata, setMetadata] = useState<ImageMetadata | null>(null);
  const [metadataError, setMetadataError] = useState("");
  const [isReadingMetadata, setIsReadingMetadata] = useState(false);
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
      setMetadata(null);
      setMetadataError("");
      setIsReadingMetadata(false);
      return;
    }

    const nextUrl = URL.createObjectURL(file);
    setSourceUrl(nextUrl);
    setOutputBlob(null);

    return () => URL.revokeObjectURL(nextUrl);
  }, [file]);

  useEffect(() => {
    if (!file) {
      return;
    }

    let active = true;
    setMetadata(null);
    setMetadataError("");
    setIsReadingMetadata(true);

    readImageMetadata(file)
      .then((nextMetadata) => {
        if (!active) {
          return;
        }
        setMetadata(nextMetadata);
      })
      .catch((error: unknown) => {
        if (!active) {
          return;
        }
        setMetadataError(error instanceof Error ? error.message : "Metadata request failed");
      })
      .finally(() => {
        if (active) {
          setIsReadingMetadata(false);
        }
      });

    return () => {
      active = false;
    };
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
  const visibleMetadataRows = useMemo(
    () => buildMetadataRows(metadata, metadataTab, metadataError, isReadingMetadata),
    [isReadingMetadata, metadata, metadataError, metadataTab],
  );
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

  function updateParam(stepId: string, paramId: string, patch: Partial<PipelineParam>) {
    setPipeline((current) =>
      current.map((step) => {
        if (step.id !== stepId) {
          return step;
        }

        const paramControls = step.paramControls.map((param) => (param.id === paramId ? { ...param, ...patch } : param));
        const next = { ...step, paramControls };
        return { ...next, params: controlsToParams(paramControls) };
      }),
    );
    setOutputBlob(null);
  }

  function clearParam(stepId: string, paramId: string) {
    updateParam(stepId, paramId, { mode: "manual", value: "", minValue: "", maxValue: "" });
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
                      onChange={(patch) => updateParam(selectedStep.id, param.id, patch)}
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
              <h2>{metadata ? "Read-only scan" : "No file"}</h2>
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
            {visibleMetadataRows.map((row) => (
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

function ParamControl(props: { param: PipelineParam; onChange: (patch: Partial<PipelineParam>) => void; onClear: () => void }) {
  const hasValue = hasParamValue(props.param);
  const status = hasValue ? props.param.mode : "backend";

  return (
    <div className={`param-row ${props.param.type}`}>
      <span className="param-title">{props.param.title}</span>
      <select
        className="param-mode"
        value={props.param.mode}
        onChange={(event) => props.onChange({ mode: event.target.value as ParamMode })}
      >
        <option value="manual">Manual</option>
        <option value="random">Random</option>
      </select>
      <div className="param-control">{renderParamInput(props.param, props.onChange)}</div>
      <small>{status}</small>
      <button type="button" className="param-reset" disabled={!hasValue} onClick={props.onClear}>
        Default
      </button>
    </div>
  );
}

function renderParamInput(param: PipelineParam, onChange: (patch: Partial<PipelineParam>) => void) {
  if (param.mode === "random") {
    return renderRandomParamInput(param, onChange);
  }

  return renderManualParamInput(param, onChange);
}

function renderManualParamInput(param: PipelineParam, onChange: (patch: Partial<PipelineParam>) => void) {
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
          onChange={(event) => onChange({ value: event.target.value })}
        />
        <input
          type="range"
          min={range.min}
          max={range.max}
          step={step}
          value={getSliderValue(param, range)}
          onChange={(event) => onChange({ value: event.target.value })}
        />
      </div>
    );
  }

  if (param.type === "enum") {
    return (
      <select value={param.value} onChange={(event) => onChange({ value: event.target.value })}>
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
          onChange={(event) => onChange({ value: event.target.value })}
        />
        <code>{param.value || "backend"}</code>
      </div>
    );
  }

  return (
    <input
      value={param.value}
      placeholder={param.placeholder}
      onChange={(event) => onChange({ value: event.target.value })}
    />
  );
}

function renderRandomParamInput(param: PipelineParam, onChange: (patch: Partial<PipelineParam>) => void) {
  if (param.type === "integer" || param.type === "number") {
    const range = getNumericRange(param);
    const step = param.type === "integer" ? "1" : "0.1";

    return (
      <div className="random-number-param">
        <input
          aria-label={`${param.title} min`}
          type="number"
          min={range.min}
          max={range.max}
          step={step}
          value={param.minValue}
          placeholder={String(range.min)}
          onChange={(event) => onChange({ minValue: event.target.value })}
        />
        <input
          aria-label={`${param.title} max`}
          type="number"
          min={range.min}
          max={range.max}
          step={step}
          value={param.maxValue}
          placeholder={String(range.max)}
          onChange={(event) => onChange({ maxValue: event.target.value })}
        />
      </div>
    );
  }

  if (param.type === "rgb_color") {
    return (
      <div className="random-color-param">
        <input
          aria-label={`${param.title} min`}
          type="color"
          value={normalizeColorValue(param.minValue || "#000000")}
          onChange={(event) => onChange({ minValue: event.target.value })}
        />
        <input
          aria-label={`${param.title} max`}
          type="color"
          value={normalizeColorValue(param.maxValue || "#ffffff")}
          onChange={(event) => onChange({ maxValue: event.target.value })}
        />
        <code>{param.minValue || "#000000"}..{param.maxValue || "#ffffff"}</code>
      </div>
    );
  }

  if (param.type === "enum") {
    return <span className="random-choice-summary">{param.choices.join(", ")}</span>;
  }

  return (
    <div className="random-number-param">
      <input
        aria-label={`${param.title} min`}
        value={param.minValue}
        onChange={(event) => onChange({ minValue: event.target.value })}
      />
      <input
        aria-label={`${param.title} max`}
        value={param.maxValue}
        onChange={(event) => onChange({ maxValue: event.target.value })}
      />
    </div>
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

function buildMetadataRows(
  metadata: ImageMetadata | null,
  tab: MetadataTab,
  error: string,
  isLoading: boolean,
): MetadataRow[] {
  if (isLoading) {
    return [{ label: "Status", source: "Reading", output: "", status: "kept" }];
  }

  if (error) {
    return [{ label: "Status", source: error, output: "", status: "removed" }];
  }

  if (!metadata) {
    return [{ label: "Status", source: "No file selected", output: "", status: "kept" }];
  }

  if (tab === "overview") {
    return [
      { label: "Format", source: metadata.format ?? "Unknown", output: "", status: "kept" },
      {
        label: "Dimensions",
        source: `${metadata.dimensions.width} x ${metadata.dimensions.height}`,
        output: "",
        status: "kept",
      },
      {
        label: "GPS",
        source: metadata.gps_presence ? "Present" : "Not present",
        output: "",
        status: metadata.gps_presence ? "edited" : "kept",
      },
      { label: "File hash", source: metadata.file_hash, output: "", status: "kept" },
    ];
  }

  if (tab === "output") {
    return [
      {
        label: "Color profile",
        source: metadata.color_profile ? `${metadata.color_profile.bytes} bytes` : "Not present",
        output: "",
        status: metadata.color_profile ? "kept" : "removed",
      },
      {
        label: "Color profile hash",
        source: metadata.color_profile?.sha256 ?? "",
        output: "",
        status: metadata.color_profile ? "kept" : "removed",
      },
    ];
  }

  const section = metadata[tab] as Record<string, unknown>;
  const entries = Object.entries(section);
  if (entries.length === 0) {
    return [{ label: tab.toUpperCase(), source: "Empty", output: "", status: "kept" }];
  }

  return entries.map(([label, value]) => ({
    label,
    source: formatMetadataValue(value),
    output: "",
    status: "kept",
  }));
}

function formatMetadataValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return JSON.stringify(value);
}

function createParamControl(parameter: MethodParameter): PipelineParam {
  return {
    id: parameter.name,
    title: parameter.title,
    mode: "manual",
    value: "",
    minValue: formatRandomMin(parameter),
    maxValue: formatRandomMax(parameter),
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
    const value = serializeParamValue(param);
    if (value !== undefined) {
      result[param.id] = value;
    }
    return result;
  }, {});
}

function serializeParamValue(param: PipelineParam): unknown {
  if (param.mode === "random") {
    return serializeRandomParamValue(param);
  }

  return parseParamValue(param.value, param.type);
}

function serializeRandomParamValue(param: PipelineParam): unknown {
  if (param.type === "enum") {
    return param.choices.length > 0 ? { mode: "random", type: "enum", choices: param.choices } : undefined;
  }

  if (param.type === "rgb_color") {
    return {
      mode: "random",
      type: "rgb_color",
      min: param.minValue || "#000000",
      max: param.maxValue || "#ffffff",
    };
  }

  const range = getNumericRange(param);
  const min = parseRandomNumber(param.minValue, range.min);
  const max = parseRandomNumber(param.maxValue, range.max);
  if (min === undefined || max === undefined) {
    return undefined;
  }

  return { mode: "random", type: param.type, min, max };
}

function parseRandomNumber(value: string, fallback: number): number | undefined {
  const normalized = value.trim();
  if (normalized === "") {
    return fallback;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function hasParamValue(param: PipelineParam): boolean {
  if (param.mode === "manual") {
    return param.value.trim() !== "";
  }

  if (param.type === "enum") {
    return param.choices.length > 0;
  }

  return true;
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

function formatRandomMin(parameter: MethodParameter): string {
  if (parameter.type === "rgb_color") {
    return "#000000";
  }

  const range = parameter.random_default ?? parameter.value_range;
  return range ? String(range.min) : "";
}

function formatRandomMax(parameter: MethodParameter): string {
  if (parameter.type === "rgb_color") {
    return "#ffffff";
  }

  const range = parameter.random_default ?? parameter.value_range;
  return range ? String(range.max) : "";
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
