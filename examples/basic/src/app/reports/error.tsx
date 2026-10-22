import type { ErrorProps } from "@opentyped/vite-express-rsc";

export default function ErrorBoundary({ error }: ErrorProps) {
  return (
    <p data-testid="route-error">
      Report failed:{" "}
      {error instanceof Error ? error.message : "Request rejected"}
    </p>
  );
}
