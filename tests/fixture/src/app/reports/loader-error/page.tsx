/** Throw before rendering to exercise loader error handling. */
export async function loader() {
  throw new Error("Expected report loader failure");
}

/** Fail if a page renders after its loader has failed. */
export default function NeverRendered() {
  return <p>Must never render</p>;
}
