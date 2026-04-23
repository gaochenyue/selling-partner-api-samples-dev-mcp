// Type declaration for @huggingface/transformers when it's not installed.
// This package is an optionalDependency — it may not be present in CI environments
// where its native transitive deps (onnxruntime-node) can't download binaries.
declare module "@huggingface/transformers" {
  export function pipeline(
    task: string,
    model: string,
    options?: Record<string, unknown>,
  ): Promise<any>;
  export const env: {
    backends: {
      onnx: Record<string, unknown>;
    };
    [key: string]: unknown;
  };
}
