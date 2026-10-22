import type { ReactFormState } from "react-dom/client";
import { createFromReadableStream } from "@vitejs/plugin-rsc/ssr";
import { renderToReadableStream } from "react-dom/server.edge";
import {
  unstable_routeRSCServerRequest as routeRequest,
  unstable_RSCStaticRouter as StaticRouter,
} from "react-router";

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
