import { Suspense } from "react";
import { getRequestContext } from "@opentyped/vite-express-rsc/context";
import { streams } from "../../server/stream";

async function Delayed() {
  const { signal } = getRequestContext();

  streams.started++;
  await new Promise<void>((resolve) => {
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

export default function Streaming() {
  return (
    <Suspense fallback={<p>Stream pending</p>}>
      <Delayed />
    </Suspense>
  );
}
