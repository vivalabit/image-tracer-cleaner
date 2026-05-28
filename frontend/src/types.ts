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

export type MetadataEditPayload = {
  strip_gps?: boolean;
  strip_all?: boolean;
  creator?: string;
  software?: string;
  created_at?: string;
  taken_at?: string;
};

export type RecipeStep = Operation & {
  enabled: boolean;
};

export type RandomizeRequest = {
  file: File;
  seed: number | null;
  output_format: OutputFormat;
  operations: Operation[];
  metadata?: MetadataEditPayload | null;
};

export type DimensionsDelta = {
  original: {
    width: number;
    height: number;
  };
  output: {
    width: number;
    height: number;
  };
  width_delta: number;
  height_delta: number;
};

export type FileSizeDelta = {
  original_bytes: number;
  output_bytes: number;
  delta_bytes: number;
  delta_percent: number | null;
};

export type MetadataChanges = {
  changed: boolean;
  added: string[];
  removed: string[];
  modified: string[];
};

export type ImageAnalysis = {
  original_hash: string;
  output_hash: string;
  dimensions_delta: DimensionsDelta;
  file_size_delta: FileSizeDelta;
  metadata_changes: MetadataChanges;
  visual_similarity_score: number;
};

export type ColorProfileMetadata = {
  present: boolean;
  bytes: number;
  sha256: string;
};

export type ImageMetadata = {
  format: string | null;
  dimensions: {
    width: number;
    height: number;
  };
  exif: Record<string, unknown>;
  iptc: Record<string, unknown>;
  xmp: Record<string, unknown>;
  gps_presence: boolean;
  color_profile: ColorProfileMetadata | null;
  file_hash: string;
};
