export async function loader() {
  throw new Error("Expected report loader failure");
}

export default function NeverRendered() {
  return <p>Must never render</p>;
}
