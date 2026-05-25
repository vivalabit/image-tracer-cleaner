import { useEffect, useMemo, useState } from "react";
import type { ChangeEvent } from "react";

type AppMode = "manual" | "random" | "metadata" | "batch";
type PreviewMode = "compare" | "slider" | "difference";
type MetadataTab = "overview" | "exif" | "iptc" | "xmp" | "output";
type ParamMode = "fixed" | "random";

type PipelineParam = {
  id: string;
  title: string;
  value: string;
  range: string;
  unit: string;
  mode: ParamMode;
};

type PipelineStep = {
  id: string;
  title: string;
  operation: string;
  category: string;
  enabled: boolean;
  randomize: boolean;
  impact: "subtle" | "medium" | "strong";
  params: PipelineParam[];
};

type MetadataRow = {
  label: string;
  source: string;
  output: string;
  status: "kept" | "edited" | "removed";
};

const starterPipeline: PipelineStep[] = [
  {
    id: "resize",
    title: "Micro resize",
    operation: "resize",
    category: "Geometry",
    enabled: true,
    randomize: true,
    impact: "subtle",
    params: [
      { id: "scale_x_pct", title: "X scale", value: "100", range: "98-102", unit: "%", mode: "random" },
      { id: "scale_y_pct", title: "Y scale", value: "100", range: "98-102", unit: "%", mode: "random" },
    ],
  },
  {
    id: "noise",
    title: "Fine noise",
    operation: "interference",
    category: "Pixels",
    enabled: true,
    randomize: true,
    impact: "subtle",
    params: [{ id: "strength", title: "Strength", value: "3", range: "1-5", unit: "px", mode: "random" }],
  },
  {
    id: "contrast",
    title: "Contrast trim",
    operation: "sharp",
    category: "Color",
    enabled: true,
    randomize: false,
    impact: "medium",
    params: [{ id: "amount", title: "Amount", value: "-4", range: "-8-8", unit: "%", mode: "fixed" }],
  },
  {
    id: "metadata",
    title: "Metadata cleanup",
    operation: "metadata",
    category: "Metadata",
    enabled: true,
    randomize: false,
    impact: "medium",
    params: [
      { id: "gps", title: "GPS", value: "strip", range: "strip/keep", unit: "", mode: "fixed" },
      { id: "software", title: "Software", value: "Image Randomizer", range: "custom", unit: "", mode: "fixed" },
    ],
  },
];

const addableSteps = [
  "Crop",
  "Rotate",
  "Blur",
  "Border",
  "Pixelization",
  "Mirror",
  "Format change",
  "Metadata template",
];

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
  { method: "POST", path: "/api/preview", note: "temporary render" },
  { method: "POST", path: "/api/export", note: "final image" },
  { method: "POST", path: "/api/metadata/read", note: "metadata scan" },
  { method: "POST", path: "/api/batch", note: "multi-file job" },
];

function App() {
  const [mode, setMode] = useState<AppMode>("manual");
  const [previewMode, setPreviewMode] = useState<PreviewMode>("compare");
  const [metadataTab, setMetadataTab] = useState<MetadataTab>("overview");
  const [pipeline, setPipeline] = useState<PipelineStep[]>(starterPipeline);
  const [selectedStepId, setSelectedStepId] = useState(starterPipeline[0].id);
  const [file, setFile] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState("");
  const [seed, setSeed] = useState("42");
  const [quality, setQuality] = useState("92");
  const [outputFormat, setOutputFormat] = useState("PNG");

  useEffect(() => {
    if (!file) {
      setSourceUrl("");
      return;
    }

    const nextUrl = URL.createObjectURL(file);
    setSourceUrl(nextUrl);

    return () => URL.revokeObjectURL(nextUrl);
  }, [file]);

  const activeSteps = useMemo(() => pipeline.filter((step) => step.enabled), [pipeline]);
  const selectedStep = pipeline.find((step) => step.id === selectedStepId) ?? pipeline[0];

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    setFile(event.target.files?.[0] ?? null);
  }

  function updateStep(stepId: string, patch: Partial<PipelineStep>) {
    setPipeline((current) => current.map((step) => (step.id === stepId ? { ...step, ...patch } : step)));
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
  }

  function addStep(title: string) {
    const id = `${title.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}`;
    const nextStep: PipelineStep = {
      id,
      title,
      operation: title.toLowerCase().replace(/\s+/g, "_"),
      category: title === "Metadata template" ? "Metadata" : "Custom",
      enabled: true,
      randomize: true,
      impact: "medium",
      params: [{ id: "amount", title: "Amount", value: "1", range: "1-3", unit: "", mode: "random" }],
    };

    setPipeline((current) => [...current, nextStep]);
    setSelectedStepId(id);
  }

  function removeStep(stepId: string) {
    setPipeline((current) => {
      const next = current.filter((step) => step.id !== stepId);
      if (selectedStepId === stepId && next.length > 0) {
        setSelectedStepId(next[0].id);
      }
      return next;
    });
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
          <span className="status-pill">API draft</span>
          <button type="button" className="ghost-button">
            Save preset
          </button>
          <button type="button" className="primary-button">
            Export
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
            <input value={seed} inputMode="numeric" onChange={(event) => setSeed(event.target.value)} />
          </label>

          <label className="field">
            <span>Output format</span>
            <select value={outputFormat} onChange={(event) => setOutputFormat(event.target.value)}>
              <option>PNG</option>
              <option>JPEG</option>
              <option>WEBP</option>
            </select>
          </label>

          <label className="range-field">
            <span>Quality</span>
            <input
              type="range"
              min="40"
              max="100"
              value={quality}
              onChange={(event) => setQuality(event.target.value)}
            />
            <strong>{quality}</strong>
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
            <ImageViewport title="Output" imageUrl={sourceUrl} variant="output" />
            {previewMode === "slider" ? <div className="slider-handle" aria-hidden="true" /> : null}
          </div>

          <div className="metric-strip" aria-label="Render metrics">
            <Metric label="Visual match" value="97.8%" tone="good" />
            <Metric label="Hash" value="changed" tone="warn" />
            <Metric label="Metadata" value="4 edits" tone="info" />
            <Metric label="Size delta" value="-8.2%" tone="good" />
          </div>
        </section>

        <aside className="pipeline-panel" aria-label="Pipeline builder">
          <div className="panel-header compact">
            <div>
              <span className="eyebrow">Pipeline</span>
              <h2>Recipe</h2>
            </div>
            <button type="button" className="ghost-button small-button">
              Randomize
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
            {addableSteps.map((step) => (
              <button key={step} type="button" onClick={() => addStep(step)}>
                + {step}
              </button>
            ))}
          </div>
        </aside>
      </section>

      <section className="detail-grid">
        <section className="settings-panel" aria-label="Selected operation settings">
          <div className="panel-header compact">
            <div>
              <span className="eyebrow">Step settings</span>
              <h2>{selectedStep.title}</h2>
            </div>
            <label className="switch-field">
              <input
                type="checkbox"
                checked={selectedStep.randomize}
                onChange={(event) => updateStep(selectedStep.id, { randomize: event.target.checked })}
              />
              <span>Random</span>
            </label>
          </div>

          <div className="param-grid">
            {selectedStep.params.map((param) => (
              <label className="param-row" key={param.id}>
                <span>{param.title}</span>
                <input defaultValue={param.mode === "random" ? param.range : param.value} />
                <small>{param.mode}</small>
                <em>{param.unit}</em>
              </label>
            ))}
          </div>
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

export default App;
