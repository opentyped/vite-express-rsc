import type { ReactFormState } from "react-dom/client";
import { createFromReadableStream } from "@vitejs/plugin-rsc/ssr";
import { renderToReadableStream } from "react-dom/server.edge";
import {
  unstable_routeRSCServerRequest as routeRequest,
  unstable_RSCStaticRouter as StaticRouter,
} from "react-router";

/**
 * Return an RSC response directly or turn it into streaming HTML for a page
 * request.
 */
export function generateHTML(
  request: Request,
  serverResponse: Response,
  nonce?: string,
) {
  return routeRequest({
    request,
    serverResponse,
    nonce,
    createFromReadableStream,
    /**
     * Render the decoded route tree with its browser bootstrap script and CSP
     * nonce.
     */
    async renderHTML(getPayload, options) {
      const payload = await getPayload();

      return renderToReadableStream(
        <StaticRouter getPayload={getPayload} nonce={options.nonce} />,
        {
          ...options,
          bootstrapScriptContent:
            await import.meta.viteRsc.loadBootstrapScriptContent("index"),
          formState:
            payload.type === "render"
              ? ((await payload.formState) as ReactFormState | undefined)
              : undefined,
          signal: request.signal,
        },
      );
    },
  });
}
