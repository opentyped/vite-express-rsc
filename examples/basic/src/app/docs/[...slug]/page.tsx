import { probe } from "../../../server/probe";

export default function Docs({ params }: { params: Record<string, string> }) {
  probe.renders++;

  return <p>Documentation: {params["*"]}</p>;
}
