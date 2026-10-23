export const metadata = { title: "Slow report" };

/** Delay the report so its Suspense fallback can be observed. */
export default async function Slow() {
  await new Promise((resolve) => setTimeout(resolve, 100));

  return <p>Finished report</p>;
}
