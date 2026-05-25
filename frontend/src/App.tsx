import { useEffect, useMemo, useState } from "react";
import type { ChangeEvent } from "react";

import { fetchMethods, randomizeImage } from "./api";
import type { MethodDefinition, Operation } from "./types";

function App() {
  const [methods, setMethods] = useState<MethodDefinition[]>([]);
  const [selectedMethods, setSelectedMethods] = useState<Set<string>>(new Set());
  const [file, setFile] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string>("");
  const [previewUrl, setPreviewUrl] = useState<string>("");
  const [seed, setSeed] = useState<string>("42");
  const [isLoadingMethods, setIsLoadingMethods] = useState(true);
  const [isRenderingPreview, setIsRenderingPreview] = useState(false);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let isMounted = true;

    fetchMethods()
      .then((nextMethods) => {
        if (isMounted) {
          setMethods(nextMethods);
          setError("");
        }
      })
      .catch((err: unknown) => {
        if (isMounted) {
          setError(err instanceof Error ? err.message : "Failed to load methods.");
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsLoadingMethods(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!file) {
      setSourceUrl("");
      return;
    }

    const nextSourceUrl = URL.createObjectURL(file);
    setSourceUrl(nextSourceUrl);
    setPreviewUrl("");

    return () => URL.revokeObjectURL(nextSourceUrl);
  }, [file]);

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const operations = useMemo<Operation[]>(
    () =>
      methods
        .filter((method) => selectedMethods.has(method.name))
        .map((method) => ({ name: method.name, params: {} })),
    [methods, selectedMethods],
  );

  const canPreview = file !== null && !isRenderingPreview;

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0] ?? null;
    setFile(nextFile);
    setError("");
  }

  function toggleMethod(name: string) {
    setSelectedMethods((current) => {
      const next = new Set(current);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  }

  async function handlePreview() {
    if (!file) {
      return;
    }

    setIsRenderingPreview(true);
    setError("");

    try {
      const blob = await randomizeImage({ file, operations, seed });
      const nextPreviewUrl = URL.createObjectURL(blob);
      setPreviewUrl((current) => {
        if (current) {
          URL.revokeObjectURL(current);
        }
        return nextPreviewUrl;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Preview request failed.");
    } finally {
      setIsRenderingPreview(false);
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <h1>Image Randomizer</h1>
          <p>FastAPI migration preview</p>
        </div>
        <div className="status-pill">{isLoadingMethods ? "Loading" : `${methods.length} methods`}</div>
      </header>

      <section className="workspace">
        <aside className="controls-panel">
          <label className="file-drop">
            <span>Image</span>
            <input type="file" accept="image/*" onChange={handleFileChange} />
            <strong>{file ? file.name : "Choose file"}</strong>
          </label>

          <label className="field">
            <span>Seed</span>
            <input
              inputMode="numeric"
              placeholder="Optional"
              value={seed}
              onChange={(event) => setSeed(event.target.value)}
            />
          </label>

          <div className="actions">
            <button type="button" onClick={handlePreview} disabled={!canPreview}>
              {isRenderingPreview ? "Rendering..." : "Preview"}
            </button>
          </div>

          {error ? <div className="error-banner">{error}</div> : null}
        </aside>

        <section className="methods-panel" aria-label="Operations">
          {methods.map((method) => (
            <label className="method-row" key={method.name}>
              <input
                type="checkbox"
                checked={selectedMethods.has(method.name)}
                onChange={() => toggleMethod(method.name)}
              />
              <span className="method-copy">
                <span className="method-title">
                  {method.title}
                  <code>{method.legacy_name}</code>
                </span>
                <span>{method.description}</span>
                {method.parameters.length > 0 ? (
                  <span className="method-meta">
                    {method.parameters.map(formatParameter).join(" / ")}
                  </span>
                ) : null}
              </span>
            </label>
          ))}
        </section>

        <section className="preview-grid" aria-label="Preview">
          <ImagePanel title="Source" imageUrl={sourceUrl} emptyText="No file selected" />
          <ImagePanel title="Preview" imageUrl={previewUrl} emptyText="No preview yet" />
        </section>
      </section>
    </main>
  );
}

function ImagePanel(props: { title: string; imageUrl: string; emptyText: string }) {
  return (
    <figure className="image-panel">
      <figcaption>{props.title}</figcaption>
      <div className="image-stage">
        {props.imageUrl ? <img src={props.imageUrl} alt={props.title} /> : <span>{props.emptyText}</span>}
      </div>
    </figure>
  );
}

function formatParameter(parameter: MethodDefinition["parameters"][number]): string {
  if (parameter.random_default) {
    return `${parameter.name} random ${parameter.random_default.min}-${parameter.random_default.max}`;
  }

  if (parameter.default !== null) {
    return `${parameter.name} default ${String(parameter.default)}`;
  }

  if (parameter.choices.length > 0) {
    return `${parameter.name} ${parameter.choices.join("|")}`;
  }

  return parameter.name;
}

export default App;
