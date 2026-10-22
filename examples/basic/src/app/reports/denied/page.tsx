import { probe } from "../../../server/probe";

export async function loader() {
  probe.pageLoads++;

  return {};
}

export default function NeverRendered() {
  return <p>Forbidden component must never render</p>;
}
