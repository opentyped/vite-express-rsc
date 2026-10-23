import type { createProbe } from "./server/probe";
import type { createStreams } from "./server/stream";

// Type the application's res.locals, which components read through getRequestContext().locals.
declare global {
  namespace Express {
    interface Locals {
      user: { id: string };
      requestId: string;
      order: string[];
      nonce?: string;
      services: {
        probe: ReturnType<typeof createProbe>;
        streams: ReturnType<typeof createStreams>;
      };
    }
  }
}

export {};
