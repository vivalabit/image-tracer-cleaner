export type NumericRange = {
  min: number;
  max: number;
};

export type MethodParameter = {
  name: string;
  type: string;
  title: string;
  description: string;
  default: unknown | null;
  choices: unknown[];
  value_range: NumericRange | null;
  random_default: NumericRange | null;
};

export type MethodDefinition = {
  name: string;
  title: string;
  description: string;
  legacy_name: string;
  parameters: MethodParameter[];
  has_settings: boolean;
  reversible: boolean;
};

export type OutputFormat = "PNG" | "JPEG" | "WEBP";

export type Operation = {
  name: string;
  params: Record<string, unknown>;
};

export type RecipeStep = Operation & {
  enabled: boolean;
};

export type RandomizeRequest = {
  file: File;
  seed: number | null;
  output_format: OutputFormat;
  operations: Operation[];
};
