/** Throw during rendering to demonstrate the report error boundary. */
export default function Broken() {
  throw new Error("Expected report render failure");
}
