import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ChangeEvent, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";

import { analyzeImages, fetchMethods, randomizeImage, readImageMetadata } from "./api";
import type {
  ImageAnalysis,
  ImageMetadata,
  MetadataItem,
  MetadataEditPayload,
  MethodDefinition,
  MethodParameter,
  NumericRange,
  Operation,
  OutputFormat,
  RandomizeRequest,
  RecipeStep,
} from "./types";

type PreviewMode = "compare" | "slider" | "difference";
type MetadataTab = "overview" | "exif" | "iptc" | "xmp" | "output";
type ParamMode = "manual" | "random";
type MetadataFieldAction = "keep" | "set" | "remove";

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
  randomizable: boolean;
  includeWhenEmpty: boolean;
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

type MetadataEditState = {
  stripGps: boolean;
  stripAll: boolean;
  creatorAction: MetadataFieldAction;
  creatorValue: string;
  softwareAction: MetadataFieldAction;
  softwareValue: string;
  createdAtAction: MetadataFieldAction;
  createdAtValue: string;
  takenAtAction: MetadataFieldAction;
  takenAtValue: string;
};

const endpointRows = [
  { method: "GET", path: "/api/methods", note: "operation registry" },
  { method: "POST", path: "/api/metadata/read", note: "metadata viewer" },
  { method: "POST", path: "/api/randomize", note: "operations + metadata" },
  { method: "POST", path: "/api/analyze", note: "result analysis" },
];

const defaultMetadataEdit: MetadataEditState = {
  stripGps: false,
  stripAll: false,
  creatorAction: "keep",
  creatorValue: "",
  softwareAction: "keep",
  softwareValue: "Image Randomizer",
  createdAtAction: "keep",
  createdAtValue: "",
  takenAtAction: "keep",
  takenAtValue: "",
};

const fallbackMethods: MethodDefinition[] = [
  createFallbackMethod("hmirror", "Horizontal mirror"),
  createFallbackMethod("vmirror", "Vertical mirror"),
  createFallbackMethod("invert", "Invert colors"),
  createFallbackMethod("grayscale", "Grayscale"),
  createFallbackMethod("crop", "Crop"),
  createFallbackMethod("fixresize", "Fixed resize"),
  createFallbackMethod("resize", "Unfixed resize"),
  createFallbackMethod("interference", "Noise"),
  createFallbackMethod("rotate", "Rotate"),
  createFallbackMethod("border", "Border"),
  createFallbackMethod("sharp", "Contrast"),
  createFallbackMethod("blur", "Blur"),
  createFallbackMethod("eskiz", "Sketch"),
  createFallbackMethod("pixelization", "Pixelization"),
  createFallbackMethod("move", "Move"),
];

function App() {
  const [previewMode, setPreviewMode] = useState<PreviewMode>("compare");
  const [lightboxMode, setLightboxMode] = useState<PreviewMode>("compare");
  const [previewSliderPosition, setPreviewSliderPosition] = useState(50);
  const [lightboxSliderPosition, setLightboxSliderPosition] = useState(50);
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const [metadataTab, setMetadataTab] = useState<MetadataTab>("overview");
  const [pipeline, setPipeline] = useState<PipelineStep[]>([]);
  const [openSettingsStepId, setOpenSettingsStepId] = useState<string | null>(null);
  const [methods, setMethods] = useState<MethodDefinition[]>([]);
  const [apiStatus, setApiStatus] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState("");
  const [outputBlob, setOutputBlob] = useState<Blob | null>(null);
  const [outputUrl, setOutputUrl] = useState("");
  const [analysis, setAnalysis] = useState<ImageAnalysis | null>(null);
  const [analysisError, setAnalysisError] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [metadata, setMetadata] = useState<ImageMetadata | null>(null);
  const [metadataError, setMetadataError] = useState("");
  const [isReadingMetadata, setIsReadingMetadata] = useState(false);
  const [metadataEdit, setMetadataEdit] = useState<MetadataEditState>(defaultMetadataEdit);
  const [seed, setSeed] = useState("42");
  const [outputFormat, setOutputFormat] = useState<OutputFormat>("PNG");
  const [isRendering, setIsRendering] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isPreviewDirty, setIsPreviewDirty] = useState(false);
  const [renderError, setRenderError] = useState("");
  const nextPipelineStepId = useRef(0);
  const outputUrlRef = useRef("");
  const previewAbortController = useRef<AbortController | null>(null);
  const previewRequestId = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
    previewRequestId.current += 1;
    previewAbortController.current?.abort();
    previewAbortController.current = null;

    if (!file) {
      setSourceUrl("");
      clearRenderedOutput();
      setIsPreviewDirty(false);
      setRenderError("");
      setIsRendering(false);
      setMetadata(null);
      setMetadataError("");
      setIsReadingMetadata(false);
      return;
    }

    const nextUrl = URL.createObjectURL(file);
    setSourceUrl(nextUrl);
    clearRenderedOutput();
    setIsPreviewDirty(true);

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

  useEffect(
    () => () => {
      previewAbortController.current?.abort();
      if (outputUrlRef.current) {
        URL.revokeObjectURL(outputUrlRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (!outputUrl) {
      setIsLightboxOpen(false);
    }
  }, [outputUrl]);

  useEffect(() => {
    if (!isLightboxOpen) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsLightboxOpen(false);
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [isLightboxOpen]);

  const activeSteps = useMemo(() => pipeline.filter((step) => step.enabled), [pipeline]);
  const displayMethods = methods.length > 0 ? methods : fallbackMethods;
  const methodsByName = useMemo(() => new Map(displayMethods.map((method) => [method.name, method])), [displayMethods]);
  const recipeMethods = useMemo(() => displayMethods.filter((method) => method.name !== "metadata"), [displayMethods]);
  const activeMetadataPayload = useMemo(() => buildMetadataEditPayload(metadataEdit), [metadataEdit]);
  const visibleMetadataRows = useMemo(
    () => buildMetadataRows(metadata, metadataTab, metadataError, isReadingMetadata, metadataEdit),
    [isReadingMetadata, metadata, metadataEdit, metadataError, metadataTab],
  );
  const requestPreview = useMemo(
    () =>
      JSON.stringify(
        {
          file: file ? file.name : null,
          operations: activeSteps.map(toOperation),
          metadata: activeMetadataPayload,
          seed: parseSeedOrNull(seed),
          output_format: outputFormat,
        },
        null,
        2,
      ),
    [activeMetadataPayload, activeSteps, file, outputFormat, seed],
  );
  const renderPreview = useCallback(async (): Promise<Blob | null> => {
    const requestId = previewRequestId.current + 1;
    previewRequestId.current = requestId;
    const isCurrentRequest = () => previewRequestId.current === requestId;

    if (!file) {
      previewAbortController.current?.abort();
      previewAbortController.current = null;
      setRenderError("Choose an image first.");
      return null;
    }

    previewAbortController.current?.abort();
    const abortController = new AbortController();
    previewAbortController.current = abortController;

    setIsRendering(true);
    setRenderError("");
    setAnalysis(null);
    setAnalysisError("");
    setIsAnalyzing(false);

    try {
      const request: RandomizeRequest = {
        file,
        operations: activeSteps.map(toOperation),
        metadata: activeMetadataPayload,
        seed: parseSeed(seed),
        output_format: outputFormat,
      };
      const nextOutput = await randomizeImage(request, abortController.signal);
      if (!isCurrentRequest()) {
        return null;
      }

      commitRenderedOutput(nextOutput);
      setIsAnalyzing(true);
      try {
        const nextAnalysis = await analyzeImages(file, nextOutput, abortController.signal);
        if (isCurrentRequest()) {
          setAnalysis(nextAnalysis);
        }
      } catch (error) {
        if (isCurrentRequest()) {
          setAnalysisError(error instanceof Error ? error.message : "Analyze request failed");
        }
      } finally {
        if (isCurrentRequest()) {
          setIsAnalyzing(false);
        }
      }

      return isCurrentRequest() ? nextOutput : null;
    } catch (error) {
      if (isAbortError(error)) {
        return null;
      }
      if (isCurrentRequest()) {
        setRenderError(error instanceof Error ? error.message : "Preview request failed");
        setIsAnalyzing(false);
      }
      return null;
    } finally {
      if (isCurrentRequest()) {
        setIsRendering(false);
        if (previewAbortController.current === abortController) {
          previewAbortController.current = null;
        }
      }
    }
  }, [activeMetadataPayload, activeSteps, file, outputFormat, seed]);

  useEffect(() => {
    if (!file) {
      return;
    }

    const previewTimer = window.setTimeout(() => {
      void renderPreview();
    }, 80);

    return () => window.clearTimeout(previewTimer);
  }, [file, renderPreview]);

  const metricError = renderError || analysisError;
  const primaryActionLabel = isExporting ? "Exporting" : "Export";
  const primaryActionDisabled = !file || isRendering || isExporting;

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    setFile(event.target.files?.[0] ?? null);
  }

  function openImagePicker() {
    fileInputRef.current?.click();
  }

  function openOutputLightbox() {
    if (!outputUrl) {
      return;
    }

    setLightboxMode(previewMode);
    setLightboxSliderPosition(previewSliderPosition);
    setIsLightboxOpen(true);
  }

  function invalidateRenderedOutput() {
    previewRequestId.current += 1;
    previewAbortController.current?.abort();
    previewAbortController.current = null;
    setIsPreviewDirty(Boolean(file));
    setRenderError("");
    setAnalysisError("");
    setIsAnalyzing(false);
  }

  function commitRenderedOutput(nextOutput: Blob) {
    const nextUrl = URL.createObjectURL(nextOutput);
    const previousUrl = outputUrlRef.current;

    outputUrlRef.current = nextUrl;
    setOutputBlob(nextOutput);
    setOutputUrl(nextUrl);
    setIsPreviewDirty(false);

    if (previousUrl) {
      window.setTimeout(() => URL.revokeObjectURL(previousUrl), 500);
    }
  }

  function clearRenderedOutput() {
    const previousUrl = outputUrlRef.current;

    outputUrlRef.current = "";
    setOutputBlob(null);
    setOutputUrl("");
    setAnalysis(null);
    setAnalysisError("");
    setIsAnalyzing(false);

    if (previousUrl) {
      URL.revokeObjectURL(previousUrl);
    }
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
    invalidateRenderedOutput();
  }

  function clearParam(stepId: string, paramId: string) {
    updateParam(stepId, paramId, { mode: "manual", value: "", minValue: "", maxValue: "" });
  }

  function addStep(methodName: string) {
    const method = methodsByName.get(methodName);
    if (!method) {
      return;
    }

    nextPipelineStepId.current += 1;
    const nextStep = createPipelineStep(method, nextPipelineStepId.current);

    setPipeline((current) => [...current, nextStep]);
    invalidateRenderedOutput();
  }

  function removeStep(stepId: string) {
    const next = pipeline.filter((step) => step.id !== stepId);
    setPipeline(next);
    if (openSettingsStepId === stepId) {
      setOpenSettingsStepId(null);
    }
    invalidateRenderedOutput();
  }

  function randomizeStepSettings(stepId: string) {
    setPipeline((current) =>
      current.map((step) => {
        if (step.id !== stepId) {
          return step;
        }

        const paramControls = step.paramControls.map(randomizeParamControl);
        return { ...step, paramControls, params: controlsToParams(paramControls) };
      }),
    );
    invalidateRenderedOutput();
  }

  function updateMetadataEdit(patch: Partial<MetadataEditState>) {
    setMetadataEdit((current) => ({ ...current, ...patch }));
    invalidateRenderedOutput();
  }

  function toggleRemoveAllMetadata(checked: boolean) {
    setMetadataEdit((current) =>
      checked
        ? { ...defaultMetadataEdit, stripAll: true, softwareValue: "" }
        : { ...current, stripAll: false },
    );
    invalidateRenderedOutput();
  }

  function removeAllMetadata() {
    setMetadataEdit({ ...defaultMetadataEdit, stripAll: true, softwareValue: "" });
    invalidateRenderedOutput();
  }

  function resetMetadataEdit() {
    setMetadataEdit(defaultMetadataEdit);
    invalidateRenderedOutput();
  }

  async function handleExport() {
    if (!file) {
      setRenderError("Choose an image first.");
      return;
    }

    setIsExporting(true);
    try {
      const blob = outputBlob && !isPreviewDirty ? outputBlob : await renderPreview();
      if (!blob) {
        return;
      }
      downloadBlob(blob, buildOutputFilename(file.name, outputFormat));
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="app-mark" aria-hidden="true">
            <img className="strawberry-logo" src="/logo.png" alt="" />
          </span>
          <div>
            <h1>Image TC</h1>
          </div>
        </div>
        <div className="topbar-actions">
          <span className={apiStatus ? "status-pill warning" : "status-pill"}>
            <span aria-hidden="true" />
            {apiStatus ? "API offline" : "API ready"}
          </span>
          <button type="button" className="primary-button" disabled={primaryActionDisabled} onClick={handleExport}>
            <span className="button-icon" aria-hidden="true">
              ^
            </span>
            {primaryActionLabel}
          </button>
        </div>
      </header>

      <input ref={fileInputRef} className="hidden-file-input" type="file" accept="image/*" onChange={handleFileChange} />

      <section className="workspace">
        <aside className="control-panel" aria-label="Project controls">
          <div className="control-section recipe-picker">
            <div className="control-title">
              <span className="eyebrow">Recipe</span>
              <strong>{recipeMethods.length} effects</strong>
            </div>
            <div className="add-step-grid available-effects">
              {recipeMethods.map((method) => (
                <button key={method.name} type="button" onClick={() => addStep(method.name)}>
                  <span className="method-icon" aria-hidden="true">
                    <OperationIcon name={method.name} />
                  </span>
                  <span className="method-title">{method.title}</span>
                </button>
              ))}
            </div>
          </div>

          <label className="field">
            <span>Seed</span>
            <div className="field-shell">
              <input
                value={seed}
                inputMode="numeric"
                onChange={(event) => {
                  setSeed(event.target.value);
                  invalidateRenderedOutput();
                }}
              />
              <span aria-hidden="true">D6</span>
            </div>
          </label>

          <label className="field">
            <span>Output format</span>
            <div className="field-shell select-shell">
              <span aria-hidden="true">DOC</span>
              <select
                value={outputFormat}
                onChange={(event) => {
                  const nextFormat = event.target.value as OutputFormat;
                  setOutputFormat(nextFormat);
                  invalidateRenderedOutput();
                }}
              >
                <option>PNG</option>
                <option>JPEG</option>
                <option>WEBP</option>
              </select>
            </div>
          </label>
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

          <div
            className={`preview-stage ${previewMode}`}
            style={previewMode === "slider" ? getSliderStyle(previewSliderPosition) : undefined}
            onPointerDown={
              previewMode === "slider"
                ? (event) => handleSliderPointerDown(event, setPreviewSliderPosition)
                : undefined
            }
            onPointerMove={
              previewMode === "slider"
                ? (event) => handleSliderPointerMove(event, setPreviewSliderPosition)
                : undefined
            }
            onPointerUp={previewMode === "slider" ? releaseSliderPointer : undefined}
            onPointerCancel={previewMode === "slider" ? releaseSliderPointer : undefined}
          >
            <ImageViewport title="Source" imageUrl={sourceUrl} variant="source" onPickImage={openImagePicker} />
            <ImageViewport title="Output" imageUrl={outputUrl} variant="output" onOpenImage={openOutputLightbox} />
            {previewMode === "slider" ? (
              <ComparisonSliderHandle
                className="slider-handle"
                label="Compare source and output"
                position={previewSliderPosition}
                onPositionChange={setPreviewSliderPosition}
              />
            ) : null}
          </div>

          <div className="metric-strip" aria-label="Render metrics">
            <Metric label="Visual match" value={formatVisualSimilarity(analysis, isAnalyzing, metricError)} tone={getVisualSimilarityTone(analysis, metricError)} />
            <Metric label="Hash" value={formatHashMetric(analysis, isAnalyzing, metricError)} tone={getHashMetricTone(analysis, metricError)} />
            <Metric label="Metadata" value={formatMetadataChangeMetric(analysis, isAnalyzing, metricError)} tone={getMetadataMetricTone(analysis, metricError)} />
            <Metric label="Size delta" value={formatFileSizeDeltaMetric(analysis, isAnalyzing, metricError)} tone={getSizeDeltaTone(analysis, metricError)} />
          </div>
          {renderError ? <p className="inline-error">{renderError}</p> : null}
          {analysisError ? <p className="inline-error">{analysisError}</p> : null}
        </section>

        <aside className="pipeline-panel selected-effects-panel" aria-label="Selected effects">
          <div className="selected-effects-header">
            <h2>Selected effects</h2>
            <span className="recipe-count">{pipeline.length} steps</span>
          </div>

          <div className="step-list">
            {pipeline.length > 0 ? (
              pipeline.map((step) => (
                <article
                  key={step.id}
                  className={`step-card ${openSettingsStepId === step.id ? "selected" : ""}`}
                >
                  <div className="step-effect-icon" aria-hidden="true">
                    <OperationIcon name={step.name} />
                  </div>
                  <div className="step-main">
                    <strong className="step-effect-name">{step.title}</strong>
                  </div>
                  <div className="step-actions">
                    <button
                      type="button"
                      title="Settings"
                      aria-label={`Settings for ${step.title}`}
                      className={openSettingsStepId === step.id ? "icon-button active" : "icon-button"}
                      onClick={(event) => {
                        event.stopPropagation();
                        setOpenSettingsStepId((current) => (current === step.id ? null : step.id));
                      }}
                    >
                      &#9881;
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
                  {openSettingsStepId === step.id ? (
                    <StepSettingsMenu
                      step={step}
                      onClearParam={(paramId) => clearParam(step.id, paramId)}
                      onParamChange={(paramId, patch) => updateParam(step.id, paramId, patch)}
                      onRandomize={() => randomizeStepSettings(step.id)}
                    />
                  ) : null}
                </article>
              ))
            ) : (
              <div className="selected-empty">No selected effects</div>
            )}
          </div>
        </aside>
      </section>

      <section className="detail-grid">
        <section className="metadata-panel" aria-label="Metadata editor">
          <div className="panel-header compact">
            <div>
              <span className="eyebrow">Metadata</span>
              <h2>{metadata ? "View, edit, remove" : "No file"}</h2>
            </div>
            <div className="metadata-header-actions">
              <button type="button" className="ghost-button small-button" onClick={resetMetadataEdit}>
                Reset
              </button>
              <button
                type="button"
                className="danger-button small-button"
                disabled={!file}
                onClick={removeAllMetadata}
              >
                Remove all metadata
              </button>
            </div>
          </div>

          <div className="metadata-summary">
            <span className="metadata-icon" aria-hidden="true">
              DOC
            </span>
            <div>
              <span>Format</span>
              <strong>{getMetadataFormat(metadata) ?? "--"}</strong>
            </div>
            <div>
              <span>Width</span>
              <strong>{getMetadataWidth(metadata) ?? "--"}</strong>
            </div>
            <div>
              <span>Height</span>
              <strong>{getMetadataHeight(metadata) ?? "--"}</strong>
            </div>
            <div>
              <span>Size</span>
              <strong>{file ? `${Math.round(file.size / 1024)} KB` : "--"}</strong>
            </div>
          </div>

          <div className="metadata-editor-layout">
            <div className="metadata-browser">
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
                <div className="metadata-row metadata-row-head">
                  <strong>Field</strong>
                  <span>Source</span>
                  <span>Output</span>
                  <mark>Status</mark>
                </div>
                {visibleMetadataRows.map((row) => (
                  <div className="metadata-row" key={`${metadataTab}-${row.label}`}>
                    <strong>{row.label}</strong>
                    <span>{row.source}</span>
                    <span>{row.output}</span>
                    <mark className={row.status}>{row.status}</mark>
                  </div>
                ))}
              </div>
            </div>

            <aside className="metadata-edit-controls" aria-label="Metadata actions">
              <div className="metadata-tool-heading">
                <span className="eyebrow">Edit Metadata</span>
                <strong>{formatMetadataEditSummary(metadataEdit)}</strong>
              </div>

              <label className="metadata-switch">
                <input
                  type="checkbox"
                  checked={metadataEdit.stripGps}
                  disabled={metadataEdit.stripAll}
                  onChange={(event) => updateMetadataEdit({ stripGps: event.target.checked })}
                />
                <span>
                  <strong>Strip GPS</strong>
                  <small>Remove location data from EXIF/XMP.</small>
                </span>
              </label>

              <label className="metadata-switch destructive">
                <input
                  type="checkbox"
                  checked={metadataEdit.stripAll}
                  onChange={(event) => toggleRemoveAllMetadata(event.target.checked)}
                />
                <span>
                  <strong>Remove all metadata</strong>
                  <small>Export the photo with metadata, EXIF, XMP, and color profile cleared.</small>
                </span>
              </label>

              <MetadataFieldEditor
                label="Creator"
                action={metadataEdit.creatorAction}
                value={metadataEdit.creatorValue}
                currentValue={getMetadataCurrentValue(metadata, "creator")}
                disabled={metadataEdit.stripAll}
                onActionChange={(creatorAction) => updateMetadataEdit({ creatorAction })}
                onValueChange={(creatorValue) => updateMetadataEdit({ creatorValue })}
              />

              <MetadataFieldEditor
                label="Software"
                action={metadataEdit.softwareAction}
                value={metadataEdit.softwareValue}
                currentValue={getMetadataCurrentValue(metadata, "software")}
                disabled={metadataEdit.stripAll}
                onActionChange={(softwareAction) => updateMetadataEdit({ softwareAction })}
                onValueChange={(softwareValue) => updateMetadataEdit({ softwareValue })}
              />

              <MetadataFieldEditor
                label="Created date"
                action={metadataEdit.createdAtAction}
                value={metadataEdit.createdAtValue}
                currentValue={getMetadataCurrentValue(metadata, "createdAt")}
                disabled={metadataEdit.stripAll}
                inputType="datetime-local"
                onActionChange={(createdAtAction) => updateMetadataEdit({ createdAtAction })}
                onValueChange={(createdAtValue) => updateMetadataEdit({ createdAtValue })}
              />

              <MetadataFieldEditor
                label="Taken date"
                action={metadataEdit.takenAtAction}
                value={metadataEdit.takenAtValue}
                currentValue={getMetadataCurrentValue(metadata, "takenAt")}
                disabled={metadataEdit.stripAll}
                inputType="datetime-local"
                onActionChange={(takenAtAction) => updateMetadataEdit({ takenAtAction })}
                onValueChange={(takenAtValue) => updateMetadataEdit({ takenAtValue })}
              />
            </aside>
          </div>
        </section>

        <section className="api-panel" aria-label="API surface">
          <div className="panel-header compact">
            <div>
              <span className="eyebrow">API</span>
              <h2>Contract draft</h2>
            </div>
            <button type="button" className="ghost-button small-button">
              <span className="button-icon" aria-hidden="true">
                ?
              </span>
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

      {isLightboxOpen && sourceUrl && outputUrl ? (
        <ImageCompareDialog
          mode={lightboxMode}
          outputUrl={outputUrl}
          sourceUrl={sourceUrl}
          sliderPosition={lightboxSliderPosition}
          onClose={() => setIsLightboxOpen(false)}
          onModeChange={setLightboxMode}
          onSliderPositionChange={setLightboxSliderPosition}
        />
      ) : null}
    </main>
  );
}

function ImageViewport(props: {
  title: string;
  imageUrl: string;
  variant: "source" | "output";
  onOpenImage?: () => void;
  onPickImage?: () => void;
}) {
  const shouldShowPickerLabel = props.variant === "source" && !props.imageUrl;
  const canOpenImage = Boolean(props.imageUrl && props.onOpenImage);
  const content = props.imageUrl ? (
    <img src={props.imageUrl} alt={props.title} />
  ) : (
    <MockImage variant={props.variant} actionLabel={shouldShowPickerLabel ? "Choose image" : undefined} />
  );

  return (
    <figure className={`image-viewport ${props.variant}`}>
      <figcaption>{props.title}</figcaption>
      {canOpenImage ? (
        <button type="button" className="image-canvas image-zoom-trigger" onClick={props.onOpenImage} aria-label={`Open ${props.title} preview`}>
          {content}
        </button>
      ) : props.onPickImage ? (
        <button type="button" className="image-canvas image-picker" onClick={props.onPickImage} aria-label="Choose source image">
          {content}
        </button>
      ) : (
        <div className="image-canvas">{content}</div>
      )}
    </figure>
  );
}

function ImageCompareDialog(props: {
  mode: PreviewMode;
  outputUrl: string;
  sourceUrl: string;
  sliderPosition: number;
  onClose: () => void;
  onModeChange: (mode: PreviewMode) => void;
  onSliderPositionChange: (position: number) => void;
}) {
  return (
    <div className="image-lightbox" role="presentation" onClick={props.onClose}>
      <section className="image-lightbox-dialog" role="dialog" aria-label="Large image comparison" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div className="image-lightbox-header">
          <div>
            <span className="eyebrow">Preview</span>
            <h2>Image comparison</h2>
          </div>
          <div className="image-lightbox-actions">
            <div className="view-tabs lightbox-tabs" aria-label="Large preview view">
              {(["compare", "slider", "difference"] as const).map((view) => (
                <button
                  key={view}
                  type="button"
                  className={props.mode === view ? "active" : ""}
                  onClick={() => props.onModeChange(view)}
                >
                  {formatPreviewMode(view)}
                </button>
              ))}
            </div>
            <button type="button" className="icon-button image-lightbox-close" aria-label="Close preview" onClick={props.onClose}>
              x
            </button>
          </div>
        </div>

        <div
          className={`lightbox-stage ${props.mode}`}
          style={props.mode === "slider" ? getSliderStyle(props.sliderPosition) : undefined}
          onPointerDown={
            props.mode === "slider"
              ? (event) => handleSliderPointerDown(event, props.onSliderPositionChange)
              : undefined
          }
          onPointerMove={
            props.mode === "slider"
              ? (event) => handleSliderPointerMove(event, props.onSliderPositionChange)
              : undefined
          }
          onPointerUp={props.mode === "slider" ? releaseSliderPointer : undefined}
          onPointerCancel={props.mode === "slider" ? releaseSliderPointer : undefined}
        >
          <figure className="lightbox-frame source">
            <figcaption>Source</figcaption>
            <div className="lightbox-canvas">
              <img src={props.sourceUrl} alt="Source large preview" />
            </div>
          </figure>
          <figure className="lightbox-frame output">
            <figcaption>{props.mode === "difference" ? "Difference" : "Output"}</figcaption>
            <div className="lightbox-canvas">
              <img src={props.outputUrl} alt="Output large preview" />
            </div>
          </figure>
          {props.mode === "slider" ? (
            <ComparisonSliderHandle
              className="lightbox-slider-handle"
              label="Compare large source and output"
              position={props.sliderPosition}
              onPositionChange={props.onSliderPositionChange}
            />
          ) : null}
        </div>
      </section>
    </div>
  );
}

function ComparisonSliderHandle(props: {
  className: string;
  label: string;
  position: number;
  onPositionChange: (position: number) => void;
}) {
  return (
    <div
      className={props.className}
      role="slider"
      tabIndex={0}
      aria-label={props.label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(props.position)}
      onKeyDown={(event) => handleSliderKeyDown(event, props.position, props.onPositionChange)}
    />
  );
}

function handleSliderPointerDown(
  event: ReactPointerEvent<HTMLDivElement>,
  onPositionChange: (position: number) => void,
) {
  if (event.pointerType === "mouse" && event.button !== 0) {
    return;
  }

  event.currentTarget.setPointerCapture(event.pointerId);
  updateSliderFromPointer(event, onPositionChange);
}

function handleSliderPointerMove(
  event: ReactPointerEvent<HTMLDivElement>,
  onPositionChange: (position: number) => void,
) {
  if (event.buttons !== 1) {
    return;
  }

  updateSliderFromPointer(event, onPositionChange);
}

function releaseSliderPointer(event: ReactPointerEvent<HTMLDivElement>) {
  if (event.currentTarget.hasPointerCapture(event.pointerId)) {
    event.currentTarget.releasePointerCapture(event.pointerId);
  }
}

function updateSliderFromPointer(
  event: ReactPointerEvent<HTMLDivElement>,
  onPositionChange: (position: number) => void,
) {
  const rect = event.currentTarget.getBoundingClientRect();
  const nextPosition = ((event.clientX - rect.left) / rect.width) * 100;
  onPositionChange(clampSliderPosition(nextPosition));
}

function handleSliderKeyDown(
  event: ReactKeyboardEvent<HTMLDivElement>,
  position: number,
  onPositionChange: (position: number) => void,
) {
  const step = event.shiftKey ? 10 : 5;

  if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
    event.preventDefault();
    onPositionChange(clampSliderPosition(position - step));
    return;
  }

  if (event.key === "ArrowRight" || event.key === "ArrowUp") {
    event.preventDefault();
    onPositionChange(clampSliderPosition(position + step));
    return;
  }

  if (event.key === "Home") {
    event.preventDefault();
    onPositionChange(0);
    return;
  }

  if (event.key === "End") {
    event.preventDefault();
    onPositionChange(100);
  }
}

function getSliderStyle(position: number): CSSProperties {
  return { "--slider-position": `${clampSliderPosition(position)}%` } as CSSProperties;
}

function clampSliderPosition(position: number): number {
  if (!Number.isFinite(position)) {
    return 50;
  }

  return Math.min(100, Math.max(0, position));
}

function MockImage(props: { variant: "source" | "output"; actionLabel?: string }) {
  return (
    <div className={`mock-image ${props.variant}`} aria-label={`${props.variant} mock image`}>
      {props.actionLabel ? <span className="mock-action-label">{props.actionLabel}</span> : null}
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
      <span className="metric-icon" aria-hidden="true">
        {getMetricIcon(props.label)}
      </span>
      <div>
        <span>{props.label}</span>
        <strong>{props.value}</strong>
      </div>
    </div>
  );
}

function StepSettingsMenu(props: {
  step: PipelineStep;
  onClearParam: (paramId: string) => void;
  onParamChange: (paramId: string, patch: Partial<PipelineParam>) => void;
  onRandomize: () => void;
}) {
  const canRandomize = props.step.paramControls.some(canRandomizeParam);

  return (
    <div className="step-settings-menu" onClick={(event) => event.stopPropagation()}>
      <div className="step-settings-header">
        <div>
          <span className="eyebrow">Filter settings</span>
          <strong>{props.step.title}</strong>
        </div>
      </div>

      <button type="button" className="ghost-button small-button random-filter-button" disabled={!canRandomize} onClick={props.onRandomize}>
        Random
      </button>

      <div className="param-grid step-param-grid">
        {props.step.paramControls.length > 0 ? (
          props.step.paramControls.map((param) => (
            <ParamControl
              key={param.id}
              compact
              param={param}
              onClear={() => props.onClearParam(param.id)}
              onChange={(patch) => props.onParamChange(param.id, patch)}
            />
          ))
        ) : (
          <div className="empty-row">No settings</div>
        )}
      </div>
    </div>
  );
}

function MetadataFieldEditor(props: {
  label: string;
  action: MetadataFieldAction;
  value: string;
  currentValue: string;
  disabled: boolean;
  inputType?: "text" | "datetime-local";
  onActionChange: (action: MetadataFieldAction) => void;
  onValueChange: (value: string) => void;
}) {
  return (
    <div className="metadata-field-editor">
      <div className="metadata-field-heading">
        <strong>{props.label}</strong>
        <small>Current: {props.currentValue || "not present"}</small>
      </div>
      <div className="metadata-action-tabs" aria-label={`${props.label} metadata action`}>
        {(["keep", "set", "remove"] as const).map((action) => (
          <button
            key={action}
            type="button"
            className={props.action === action ? "active" : ""}
            disabled={props.disabled}
            onClick={() => props.onActionChange(action)}
          >
            {formatMetadataAction(action)}
          </button>
        ))}
      </div>
      {props.action === "set" ? (
        <input
          type={props.inputType ?? "text"}
          step={props.inputType === "datetime-local" ? "1" : undefined}
          value={props.value}
          disabled={props.disabled}
          placeholder={props.currentValue || props.label}
          onInput={(event) => props.onValueChange(event.currentTarget.value)}
          onChange={(event) => props.onValueChange(event.target.value)}
        />
      ) : null}
    </div>
  );
}

function formatVisualSimilarity(analysis: ImageAnalysis | null, isAnalyzing: boolean, error: string): string {
  if (error) {
    return "error";
  }
  if (isAnalyzing) {
    return "analyzing";
  }
  if (!analysis) {
    return "idle";
  }

  return `${analysis.visual_similarity_score.toFixed(1)}%`;
}

function getVisualSimilarityTone(analysis: ImageAnalysis | null, error: string): "good" | "warn" | "info" {
  if (error) {
    return "warn";
  }
  if (!analysis) {
    return "info";
  }
  if (analysis.visual_similarity_score >= 95) {
    return "good";
  }
  return analysis.visual_similarity_score >= 80 ? "info" : "warn";
}

function formatHashMetric(analysis: ImageAnalysis | null, isAnalyzing: boolean, error: string): string {
  if (error) {
    return "error";
  }
  if (isAnalyzing) {
    return "analyzing";
  }
  if (!analysis) {
    return "idle";
  }

  return analysis.original_hash === analysis.output_hash ? "same" : "changed";
}

function getHashMetricTone(analysis: ImageAnalysis | null, error: string): "good" | "warn" | "info" {
  if (error) {
    return "warn";
  }
  if (!analysis) {
    return "info";
  }
  return analysis.original_hash === analysis.output_hash ? "good" : "info";
}

function formatMetadataChangeMetric(analysis: ImageAnalysis | null, isAnalyzing: boolean, error: string): string {
  if (error) {
    return "error";
  }
  if (isAnalyzing) {
    return "analyzing";
  }
  if (!analysis) {
    return "idle";
  }

  const count = countMetadataChanges(analysis);
  return count === 0 ? "same" : `${count} changes`;
}

function getMetadataMetricTone(analysis: ImageAnalysis | null, error: string): "good" | "warn" | "info" {
  if (error) {
    return "warn";
  }
  if (!analysis) {
    return "info";
  }
  return analysis.metadata_changes.changed ? "warn" : "good";
}

function formatFileSizeDeltaMetric(analysis: ImageAnalysis | null, isAnalyzing: boolean, error: string): string {
  if (error) {
    return "error";
  }
  if (isAnalyzing) {
    return "analyzing";
  }
  if (!analysis) {
    return "idle";
  }

  const delta = analysis.file_size_delta.delta_bytes;
  const sign = delta > 0 ? "+" : delta < 0 ? "-" : "";
  const percent = analysis.file_size_delta.delta_percent;
  const percentText = percent === null ? "" : ` (${sign}${Math.abs(percent).toFixed(1)}%)`;
  return `${sign}${formatBytes(Math.abs(delta))}${percentText}`;
}

function getSizeDeltaTone(analysis: ImageAnalysis | null, error: string): "good" | "warn" | "info" {
  if (error) {
    return "warn";
  }
  if (!analysis) {
    return "info";
  }
  return analysis.file_size_delta.delta_bytes <= 0 ? "good" : "info";
}

function countMetadataChanges(analysis: ImageAnalysis): number {
  return (
    analysis.metadata_changes.added.length +
    analysis.metadata_changes.removed.length +
    analysis.metadata_changes.modified.length
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const kilobytes = bytes / 1024;
  if (kilobytes < 1024) {
    return `${kilobytes.toFixed(1)} KB`;
  }

  return `${(kilobytes / 1024).toFixed(1)} MB`;
}

function buildOutputFilename(originalName: string, outputFormat: OutputFormat): string {
  const extension = outputFormat.toLowerCase();
  const dotIndex = originalName.lastIndexOf(".");
  const baseName = dotIndex > 0 ? originalName.slice(0, dotIndex) : originalName;
  const stem = baseName.trim() || "image";
  return `${stem}_processed.${extension}`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function ParamControl(props: { param: PipelineParam; onChange: (patch: Partial<PipelineParam>) => void; onClear: () => void; compact?: boolean }) {
  const hasValue = hasParamValue(props.param);
  const status = hasValue ? props.param.mode : "backend";

  return (
    <div className={`param-row ${props.param.type} ${props.compact ? "compact" : ""}`}>
      <span className="param-title">{props.param.title}</span>
      {props.param.randomizable ? (
        <select
          className="param-mode"
          value={props.param.mode}
          onChange={(event) => props.onChange({ mode: event.target.value as ParamMode })}
        >
          <option value="manual">Manual</option>
          <option value="random">Random</option>
        </select>
      ) : (
        <span className="param-mode-label">Manual</span>
      )}
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

  if (param.type === "boolean") {
    return (
      <label className="toggle-param">
        <input
          type="checkbox"
          checked={param.value === "true"}
          onChange={(event) => onChange({ value: event.target.checked ? "true" : "false" })}
        />
        <span>{param.value === "true" ? "Enabled" : "Disabled"}</span>
      </label>
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

function formatPreviewMode(mode: PreviewMode): string {
  const labels: Record<PreviewMode, string> = {
    compare: "Side by side",
    slider: "Slider",
    difference: "Diff",
  };
  return labels[mode];
}

function getMetricIcon(label: string): string {
  if (label === "Visual match") {
    return "+";
  }
  if (label === "Hash") {
    return "#";
  }
  if (label === "Metadata") {
    return "DOC";
  }
  return "O";
}

function OperationIcon(props: { name: string }) {
  const iconProps = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  switch (props.name) {
    case "hmirror":
      return (
        <svg {...iconProps}>
          <path d="M12 4v16" />
          <path d="M4 7v10l6-5-6-5Z" />
          <path d="M20 7v10l-6-5 6-5Z" />
        </svg>
      );
    case "vmirror":
      return (
        <svg {...iconProps}>
          <path d="M4 12h16" />
          <path d="M7 4h10l-5 6-5-6Z" />
          <path d="M7 20h10l-5-6-5 6Z" />
          <path d="M17 5l3-3" />
          <path d="M19 9l3-3" />
        </svg>
      );
    case "invert":
    case "border":
      return (
        <svg {...iconProps}>
          <path d="M12 3s6 6.2 6 10a6 6 0 0 1-12 0c0-3.8 6-10 6-10Z" />
          <path d="M12 9v8" />
        </svg>
      );
    case "grayscale":
      return (
        <svg {...iconProps}>
          <circle cx="9" cy="12" r="5" fill="currentColor" fillOpacity="0.78" stroke="none" />
          <circle cx="15" cy="12" r="5" fill="#9aa8b8" fillOpacity="0.86" stroke="none" />
          <path d="M12 8a5 5 0 0 1 0 8" stroke="#d7e2ec" />
        </svg>
      );
    case "crop":
      return (
        <svg {...iconProps}>
          <path d="M6 3v15h15" />
          <path d="M3 6h15v15" />
          <path d="M9 9h6v6H9z" />
        </svg>
      );
    case "fixresize":
      return (
        <svg {...iconProps}>
          <path d="M5 5h14v14H5z" />
          <path d="M9 9h6v6H9z" strokeDasharray="2 2" />
          <path d="M7 3v4" />
          <path d="M17 17v4" />
        </svg>
      );
    case "resize":
      return (
        <svg {...iconProps}>
          <path d="M7 7h10v10H7z" />
          <path d="M3 9l4-4 4 4" />
          <path d="M21 15l-4 4-4-4" />
          <path d="M7 5v4" />
          <path d="M17 15v4" />
        </svg>
      );
    case "interference":
      return (
        <svg {...iconProps}>
          <path d="M5 4h14v16H5z" />
          <path d="M9 4v16" />
          <path d="M13 4v16" />
          <path d="M17 4v16" />
          <path d="M5 8h14" />
          <path d="M5 12h14" />
          <path d="M5 16h14" />
          <path d="M7 6l10 12" />
          <path d="M17 6L7 18" />
        </svg>
      );
    case "rotate":
      return (
        <svg {...iconProps}>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v3" />
          <path d="M12 19v3" />
          <path d="M2 12h3" />
          <path d="M19 12h3" />
          <path d="M4.9 4.9 7 7" />
          <path d="m17 17 2.1 2.1" />
          <path d="m19.1 4.9-2.1 2.1" />
          <path d="M7 17 4.9 19.1" />
        </svg>
      );
    case "sharp":
      return (
        <svg {...iconProps}>
          <path d="m4 18 5-1 9-9-4-4-9 9-1 5Z" />
          <path d="m13 5 4 4" />
          <path d="M3 21h18" />
        </svg>
      );
    case "blur":
      return (
        <svg {...iconProps}>
          <path d="M8 3h8l5 5v8l-5 5H8l-5-5V8l5-5Z" />
          <path d="M8 3v5H3" />
          <path d="M16 3v5h5" />
          <path d="M21 16h-5v5" />
          <path d="M3 16h5v5" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      );
    case "eskiz":
      return (
        <svg {...iconProps}>
          <path d="m5 19 4.5-1 9-9-3.5-3.5-9 9L5 19Z" />
          <path d="m13.5 7 3.5 3.5" />
          <path d="M4 21h16" />
        </svg>
      );
    case "pixelization":
      return (
        <svg {...iconProps}>
          <path d="M4 4h6v6H4z" />
          <path d="M14 4h6v6h-6z" />
          <path d="M4 14h6v6H4z" />
          <path d="M14 14h6v6h-6z" />
        </svg>
      );
    case "move":
      return (
        <svg {...iconProps}>
          <path d="M12 2v20" />
          <path d="M2 12h20" />
          <path d="m12 2-3 3" />
          <path d="m12 2 3 3" />
          <path d="m12 22-3-3" />
          <path d="m12 22 3-3" />
          <path d="m2 12 3-3" />
          <path d="m2 12 3 3" />
          <path d="m22 12-3-3" />
          <path d="m22 12-3 3" />
        </svg>
      );
    case "metadata":
      return (
        <svg {...iconProps}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v5" />
          <path d="M12 8h.01" />
        </svg>
      );
    default:
      return (
        <svg {...iconProps}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8v8" />
          <path d="M8 12h8" />
        </svg>
      );
  }
}

function createFallbackMethod(name: string, title: string): MethodDefinition {
  return {
    name,
    title,
    description: "",
    legacy_name: name,
    parameters: [],
    has_settings: false,
    reversible: false,
  };
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

function buildMetadataEditPayload(edit: MetadataEditState): MetadataEditPayload | null {
  if (edit.stripAll) {
    return { strip_all: true };
  }

  const payload: MetadataEditPayload = {
    strip_all: false,
    strip_gps: edit.stripGps,
  };

  if (edit.creatorAction === "set") {
    payload.creator = edit.creatorValue;
  } else if (edit.creatorAction === "remove") {
    payload.creator = "";
  }

  if (edit.softwareAction === "set") {
    payload.software = edit.softwareValue;
  } else if (edit.softwareAction === "remove") {
    payload.software = "";
  }

  if (edit.createdAtAction === "set") {
    payload.created_at = edit.createdAtValue;
  } else if (edit.createdAtAction === "remove") {
    payload.created_at = "";
  }

  if (edit.takenAtAction === "set") {
    payload.taken_at = edit.takenAtValue;
  } else if (edit.takenAtAction === "remove") {
    payload.taken_at = "";
  }

  return hasMetadataEdits(payload) ? payload : null;
}

function hasMetadataEdits(payload: MetadataEditPayload): boolean {
  return Boolean(
    payload.strip_all ||
      payload.strip_gps ||
      "creator" in payload ||
      "software" in payload ||
      "created_at" in payload ||
      "taken_at" in payload,
  );
}

function formatMetadataEditSummary(edit: MetadataEditState): string {
  if (edit.stripAll) {
    return "All metadata will be removed";
  }

  const actions = [
    edit.stripGps ? "GPS removal" : "",
    edit.creatorAction !== "keep" ? `Creator ${edit.creatorAction}` : "",
    edit.softwareAction !== "keep" ? `Software ${edit.softwareAction}` : "",
    edit.createdAtAction !== "keep" ? `Created date ${edit.createdAtAction}` : "",
    edit.takenAtAction !== "keep" ? `Taken date ${edit.takenAtAction}` : "",
  ].filter(Boolean);

  return actions.length > 0 ? actions.join(" / ") : "No metadata edits";
}

function formatMetadataAction(action: MetadataFieldAction): string {
  if (action === "set") {
    return "Set";
  }
  if (action === "remove") {
    return "Remove";
  }
  return "Keep";
}

function getMetadataCurrentValue(
  metadata: ImageMetadata | null,
  field: "creator" | "software" | "createdAt" | "takenAt",
): string {
  if (!metadata) {
    return "";
  }

  const item = findMetadataItemByTags(metadata, getMetadataFieldKeys(field));
  if (item) {
    return formatMetadataValue(item.value);
  }

  return "";
}

function getMetadataFieldKeys(field: "creator" | "software" | "createdAt" | "takenAt"): string[] {
  if (field === "creator") {
    return ["Artist", "Creator", "Author"];
  }
  if (field === "software") {
    return ["Software"];
  }
  if (field === "createdAt") {
    return ["DateTime"];
  }
  return ["DateTimeOriginal", "DateTimeDigitized"];
}

function getMetadataFormat(metadata: ImageMetadata | null): string | null {
  return getMetadataScalar(metadata, "FileType") ?? getMetadataScalar(metadata, "MIMEType");
}

function getMetadataWidth(metadata: ImageMetadata | null): string | null {
  return getMetadataScalar(metadata, "ImageWidth") ?? getMetadataScalar(metadata, "ExifImageWidth");
}

function getMetadataHeight(metadata: ImageMetadata | null): string | null {
  return getMetadataScalar(metadata, "ImageHeight") ?? getMetadataScalar(metadata, "ExifImageHeight");
}

function getMetadataScalar(metadata: ImageMetadata | null, tag: string): string | null {
  if (!metadata) {
    return null;
  }

  const item = findMetadataItemByTags(metadata, [tag]);
  return item ? formatMetadataValue(item.value) : null;
}

function findMetadataItemByTags(metadata: ImageMetadata, tags: string[]): MetadataItem | null {
  const normalizedTags = new Set(tags.map((tag) => tag.toLowerCase()));
  return metadata.find((item) => normalizedTags.has(item.tag.toLowerCase())) ?? null;
}

function getMetadataItemsForTab(metadata: ImageMetadata, tab: MetadataTab): MetadataItem[] {
  if (tab === "exif") {
    return metadata.filter(isExifMetadataItem);
  }
  if (tab === "iptc") {
    return metadata.filter((item) => item.group.toLowerCase().includes("iptc"));
  }
  if (tab === "xmp") {
    return metadata.filter(isXmpMetadataItem);
  }
  if (tab === "output") {
    return metadata.filter((item) => !isExifMetadataItem(item) && !isXmpMetadataItem(item) && !isIptcMetadataItem(item));
  }
  return metadata;
}

function isExifMetadataItem(item: MetadataItem): boolean {
  const group = item.group.toLowerCase();
  const tag = item.tag.toLowerCase();
  return group.includes("exif") || group.includes("ifd") || group === "gps" || tag.includes("gps");
}

function isXmpMetadataItem(item: MetadataItem): boolean {
  const group = item.group.toLowerCase();
  const tag = item.tag.toLowerCase();
  return group.includes("xmp") || tag.includes("xmp");
}

function isIptcMetadataItem(item: MetadataItem): boolean {
  return item.group.toLowerCase().includes("iptc");
}

function hasGpsMetadata(metadata: ImageMetadata): boolean {
  return metadata.some((item) => {
    const text = `${item.group} ${item.tag} ${formatMetadataValue(item.value)}`.toUpperCase();
    return text.includes("GPS");
  });
}

function formatMetadataItemLabel(item: MetadataItem): string {
  const label = item.label || item.tag;
  return item.group ? `${item.group}:${label}` : label;
}

function buildMetadataRows(
  metadata: ImageMetadata | null,
  tab: MetadataTab,
  error: string,
  isLoading: boolean,
  edit: MetadataEditState,
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
    const gpsPresent = hasGpsMetadata(metadata);
    const dimensions = [getMetadataWidth(metadata), getMetadataHeight(metadata)].filter(Boolean).join(" x ");
    return [
      { label: "Format", source: getMetadataFormat(metadata) ?? "Unknown", output: "", status: "kept" },
      {
        label: "Dimensions",
        source: dimensions || "Unknown",
        output: "",
        status: "kept",
      },
      {
        label: "GPS",
        source: gpsPresent ? "Present" : "Not present",
        output: getGpsOutput(edit, gpsPresent),
        status: getGpsStatus(edit, gpsPresent),
      },
      {
        label: "Fields",
        source: String(metadata.length),
        output: edit.stripAll ? "File fields remain" : "",
        status: edit.stripAll ? "edited" : "kept",
      },
      { label: "Writable fields", source: String(metadata.filter((item) => item.writable).length), output: "", status: "kept" },
    ];
  }

  const entries = getMetadataItemsForTab(metadata, tab);
  const plannedRows = buildPlannedMetadataRows(tab, edit, entries.map((item) => item.tag));
  if (entries.length === 0 && plannedRows.length === 0) {
    return [{ label: tab.toUpperCase(), source: "Empty", output: "", status: "kept" }];
  }

  const metadataRows = entries.map((item) => {
    const plan = getMetadataRowPlan(tab, item.tag, item.value, edit);
    return {
      label: formatMetadataItemLabel(item),
      source: formatMetadataValue(item.value),
      output: plan.output,
      status: plan.status,
    };
  });

  return [...metadataRows, ...plannedRows];
}

function getGpsOutput(edit: MetadataEditState, gpsPresent: boolean): string {
  if (!gpsPresent) {
    return "";
  }
  if (edit.stripAll) {
    return "Removed with all metadata";
  }
  return edit.stripGps ? "Removed" : "";
}

function getGpsStatus(edit: MetadataEditState, gpsPresent: boolean): MetadataRow["status"] {
  if (!gpsPresent) {
    return "kept";
  }
  return edit.stripAll || edit.stripGps ? "removed" : "kept";
}

function getMetadataRowPlan(
  tab: MetadataTab,
  label: string,
  value: unknown,
  edit: MetadataEditState,
): Pick<MetadataRow, "output" | "status"> {
  if (edit.stripAll) {
    return { output: "Removed", status: "removed" };
  }

  if (tab === "exif" && isCreatorMetadataLabel(label)) {
    return getFieldActionPlan(edit.creatorAction, edit.creatorValue);
  }

  if (tab === "exif" && isSoftwareMetadataLabel(label)) {
    return getFieldActionPlan(edit.softwareAction, edit.softwareValue);
  }

  if (tab === "exif" && isCreatedDateMetadataLabel(label)) {
    return getFieldActionPlan(edit.createdAtAction, formatDateMetadataOutput(edit.createdAtValue));
  }

  if (tab === "exif" && isTakenDateMetadataLabel(label)) {
    return getFieldActionPlan(edit.takenAtAction, formatDateMetadataOutput(edit.takenAtValue));
  }

  if (tab === "xmp" && edit.stripGps && String(value).includes("GPS")) {
    return { output: "GPS data removed", status: "removed" };
  }

  return { output: "", status: "kept" };
}

function getFieldActionPlan(action: MetadataFieldAction, value: string): Pick<MetadataRow, "output" | "status"> {
  if (action === "remove") {
    return { output: "Removed", status: "removed" };
  }
  if (action === "set") {
    return { output: value || "Empty value removes field", status: value ? "edited" : "removed" };
  }
  return { output: "", status: "kept" };
}

function isCreatorMetadataLabel(label: string): boolean {
  const normalized = label.toLowerCase();
  return normalized === "artist" || normalized === "creator" || normalized === "author";
}

function isSoftwareMetadataLabel(label: string): boolean {
  return label.toLowerCase() === "software";
}

function isCreatedDateMetadataLabel(label: string): boolean {
  return label.toLowerCase() === "datetime";
}

function isTakenDateMetadataLabel(label: string): boolean {
  const normalized = label.toLowerCase();
  return normalized === "datetimeoriginal" || normalized === "datetimedigitized";
}

function formatDateMetadataOutput(value: string): string {
  return value.replace("T", " ");
}

function buildPlannedMetadataRows(
  tab: MetadataTab,
  edit: MetadataEditState,
  existingLabels: string[],
): MetadataRow[] {
  if (tab !== "exif" || edit.stripAll) {
    return [];
  }

  const rows: MetadataRow[] = [];
  if (edit.creatorAction !== "keep" && !existingLabels.some(isCreatorMetadataLabel)) {
    const plan = getFieldActionPlan(edit.creatorAction, edit.creatorValue);
    rows.push({ label: "Artist", source: "Not present", output: plan.output, status: plan.status });
  }

  if (edit.softwareAction !== "keep" && !existingLabels.some(isSoftwareMetadataLabel)) {
    const plan = getFieldActionPlan(edit.softwareAction, edit.softwareValue);
    rows.push({ label: "Software", source: "Not present", output: plan.output, status: plan.status });
  }

  if (edit.createdAtAction !== "keep" && !existingLabels.some(isCreatedDateMetadataLabel)) {
    const plan = getFieldActionPlan(edit.createdAtAction, formatDateMetadataOutput(edit.createdAtValue));
    rows.push({ label: "DateTime", source: "Not present", output: plan.output, status: plan.status });
  }

  if (edit.takenAtAction !== "keep" && !existingLabels.some(isTakenDateMetadataLabel)) {
    const plan = getFieldActionPlan(edit.takenAtAction, formatDateMetadataOutput(edit.takenAtValue));
    rows.push({ label: "DateTimeOriginal", source: "Not present", output: plan.output, status: plan.status });
  }

  return rows;
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
  const randomizable = isRandomizableParamType(parameter.type);

  return {
    id: parameter.name,
    title: parameter.title,
    mode: "manual",
    value: getInitialParamValue(parameter),
    minValue: formatRandomMin(parameter),
    maxValue: formatRandomMax(parameter),
    placeholder: formatParamPlaceholder(parameter),
    unit: inferUnit(parameter.name),
    type: parameter.type,
    choices: parameter.choices.map(String),
    range: parameter.value_range ?? parameter.random_default,
    randomizable,
    includeWhenEmpty: shouldIncludeEmptyParam(parameter),
  };
}

function canRandomizeParam(param: PipelineParam): boolean {
  return param.type === "boolean" || isRandomizableParamType(param.type);
}

function randomizeParamControl(param: PipelineParam): PipelineParam {
  if (!canRandomizeParam(param)) {
    return param;
  }

  if (param.type === "integer" || param.type === "number") {
    const range = getNumericRange(param);
    const value = randomNumber(range.min, range.max);
    const formattedValue = param.type === "integer" ? String(Math.round(value)) : formatRandomDecimal(value);

    return { ...param, mode: "manual", value: formattedValue };
  }

  if (param.type === "enum") {
    const value = param.choices.length > 0 ? param.choices[Math.floor(Math.random() * param.choices.length)] : param.value;
    return { ...param, mode: "manual", value };
  }

  if (param.type === "rgb_color") {
    return { ...param, mode: "manual", value: randomHexColor() };
  }

  if (param.type === "boolean") {
    return { ...param, value: Math.random() >= 0.5 ? "true" : "false" };
  }

  return param;
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
  if (!param.randomizable) {
    return undefined;
  }

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
    return param.includeWhenEmpty || param.value.trim() !== "";
  }

  if (param.type === "enum") {
    return param.choices.length > 0;
  }

  return true;
}

function parseParamValue(value: string, type: string): unknown {
  const normalized = value.trim();
  if (normalized === "") {
    return type === "string" && value === "" ? "" : undefined;
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

  if (type === "boolean") {
    if (normalized === "true") {
      return true;
    }
    if (normalized === "false") {
      return false;
    }
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

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function randomNumber(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function formatRandomDecimal(value: number): string {
  return Number(value.toFixed(2)).toString();
}

function randomHexColor(): string {
  const value = Math.floor(Math.random() * 0xffffff);
  return `#${value.toString(16).padStart(6, "0")}`;
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

function getInitialParamValue(parameter: MethodParameter): string {
  if (parameter.type !== "boolean" && parameter.type !== "string") {
    return "";
  }

  return parameter.default === null || parameter.default === undefined ? "" : String(parameter.default);
}

function shouldIncludeEmptyParam(parameter: MethodParameter): boolean {
  return parameter.type === "string";
}

function isRandomizableParamType(type: string): boolean {
  return type === "integer" || type === "number" || type === "enum" || type === "rgb_color";
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
