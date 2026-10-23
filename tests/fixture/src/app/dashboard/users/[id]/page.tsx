import type { MetadataFunction } from "express/rsc";

/** Set the title and canonical URL for the requested user. */
export const metadata: MetadataFunction = ({ params }) => ({
  title: `User ${params.id}`,
  canonical: `/dashboard/users/${params.id}`,
});

/** Render the user ID taken from the dynamic route. */
export default function User({ params }: { params: Record<string, string> }) {
  return <p>User ID: {params.id}</p>;
}
