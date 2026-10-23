import { getProbe } from "../../../server/probe";

/** Render the catch-all path and record that its component ran. */
export default function Docs({ params }: { params: Record<string, string> }) {
  getProbe().renders++;

  return <p>Documentation: {params.slug}</p>;
}
