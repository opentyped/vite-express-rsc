export const metadata = { title: "Slow report" };

export default async function Slow() {
  await new Promise((resolve) => setTimeout(resolve, 100));

  return <p>Finished report</p>;
}
