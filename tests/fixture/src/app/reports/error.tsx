import type { ErrorProps } from "express/rsc";

/** Render the report failure message instead of the failed page. */
export default function ErrorBoundary({ error }: ErrorProps) {
  return (
    <p data-testid="route-error">
      Report failed:{" "}
      {error instanceof Error ? error.message : "Request rejected"}
    </p>
  );
}
