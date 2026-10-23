import { Suspense } from "react";
import { getRequestContext } from "express/rsc/context";
import { getStreams } from "../../server/stream";

/** Wait for data or cancel the wait when the client disconnects. */
async function Delayed() {
  const { signal } = getRequestContext();
  const streams = getStreams();

  streams.started++;
  await new Promise<void>((resolve) => {
    /** Stop the delay and record that the client canceled its render. */
    const abort = () => {
      clearTimeout(timer);
      streams.canceled++;
      resolve();
    };

    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      streams.completed++;
      resolve();
    }, 600);

    signal.addEventListener("abort", abort, { once: true });

    if (signal.aborted) {
      abort();
    }
  });

  return signal.aborted ? null : <p>Stream completed</p>;
}

/** Render a fallback before the delayed stream content is ready. */
export default function Streaming() {
  return (
    <Suspense fallback={<p>Stream pending</p>}>
      <Delayed />
    </Suspense>
  );
}
