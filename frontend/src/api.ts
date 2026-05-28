import type { ImageAnalysis, ImageMetadata, MethodDefinition, RandomizeRequest } from "./types";

type MethodsResponse = {
  methods: MethodDefinition[];
};

export async function fetchMethods(): Promise<MethodDefinition[]> {
  const response = await fetch("/api/methods");
  if (!response.ok) {
    const message = await readErrorMessage(response, "Failed to load methods");
    throw new Error(message);
  }

  const payload = (await response.json()) as MethodsResponse;
  return payload.methods;
}

export async function randomizeImage(input: RandomizeRequest, signal?: AbortSignal): Promise<Blob> {
  const formData = new FormData();
  formData.append("file", input.file);
  formData.append("operations", JSON.stringify(input.operations));
  formData.append("output_format", input.output_format);

  if (input.metadata) {
    formData.append("metadata", JSON.stringify(input.metadata));
  }

  if (input.seed !== null) {
    formData.append("seed", String(input.seed));
  }

  const response = await fetch("/api/randomize", {
    method: "POST",
    body: formData,
    signal,
  });

  if (!response.ok) {
    const message = await readErrorMessage(response, "Randomize request failed");
    throw new Error(message);
  }

  return response.blob();
}

export async function readImageMetadata(file: File): Promise<ImageMetadata> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch("/api/metadata/read", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const message = await readErrorMessage(response, "Metadata request failed");
    throw new Error(message);
  }

  return response.json() as Promise<ImageMetadata>;
}

export async function analyzeImages(original: File, output: Blob, signal?: AbortSignal): Promise<ImageAnalysis> {
  const formData = new FormData();
  formData.append("original", original);
  formData.append("output", output, "output");

  const response = await fetch("/api/analyze", {
    method: "POST",
    body: formData,
    signal,
  });

  if (!response.ok) {
    const message = await readErrorMessage(response, "Analyze request failed");
    throw new Error(message);
  }

  return response.json() as Promise<ImageAnalysis>;
}

async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const payload = (await response.json()) as { detail?: unknown };
    if (typeof payload.detail === "string") {
      return payload.detail;
    }
  }

  if (response.status === 500 && contentType.includes("text/plain")) {
    return "Backend is unavailable. Start FastAPI on 127.0.0.1:8000 and reload this page.";
  }

  return `${fallback}: ${response.status}`;
}
