import { getProbe } from "../../../server/probe";

/** Record an unexpected loader call if authorization fails to stop it. */
export async function loader() {
  getProbe().pageLoads++;

  return {};
}

/** Record an unexpected render of protected content. */
export default function NeverRendered() {
  return <p>Forbidden component must never render</p>;
}
