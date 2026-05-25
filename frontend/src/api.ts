import type { MethodDefinition, Recipe } from "./types";

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

export async function randomizeImage(input: Recipe): Promise<Blob> {
  const { file, ...recipe } = input;
  const formData = new FormData();
  formData.append("file", file);
  formData.append("recipe", JSON.stringify(recipe));

  const response = await fetch("/api/randomize", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const message = await readErrorMessage(response, "Randomize request failed");
    throw new Error(message);
  }

  return response.blob();
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
