import type { MetadataFunction } from "@opentyped/vite-express-rsc";

export const metadata: MetadataFunction = ({ params }) => ({
  title: `User ${params.id}`,
  canonical: `/dashboard/users/${params.id}`,
});

export default function User({ params }: { params: Record<string, string> }) {
  return <p>User ID: {params.id}</p>;
}
