import { createFromReadableStream } from "@vitejs/plugin-rsc/browser";
import { startTransition } from "react";
import type { DataRouter } from "react-router";
import { hydrateRoot, type ReactFormState } from "react-dom/client";
import {
  unstable_getRSCStream as getRSCStream,
  unstable_RSCHydratedRouter as HydratedRouter,
  type unstable_RSCPayload as Payload,
} from "react-router/dom";

// Decode the initial server response and attach React to the existing HTML.
createFromReadableStream<Payload>(getRSCStream()).then((payload) => {
  startTransition(async () => {
    hydrateRoot(
      document,
      <HydratedRouter
        createFromReadableStream={createFromReadableStream}
        payload={payload}
      />,
      {
        formState:
          payload.type === "render"
            ? ((await payload.formState) as ReactFormState | undefined)
            : undefined,
      },
    );
  });
});

if (import.meta.hot) {
  import.meta.hot.on("rsc:update", () => {
    // Fast Refresh must commit client edits before RSC reconciles against the DOM.
    requestAnimationFrame(() => {
      void (
        window as Window & { __reactRouterDataRouter?: DataRouter }
      ).__reactRouterDataRouter?.revalidate();
    });
  });
}
