/** Throw during page rendering to exercise error handling. */
export default function Failure() {
  throw new Error("Expected page failure");
}
