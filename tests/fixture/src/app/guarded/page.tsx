import type { Middlewares, MetadataFunction, PageProps } from "express/rsc";
import type { Request, Response } from "express";
import { getRequestContext } from "express/rsc/context";
import { getProbe } from "../../server/probe";

/** Record middleware that runs only for the account page. */
export const middlewares: Middlewares = (_req, res, next) => {
  res.locals.order.push("endpoint");
  next();
};

/** Load member data and stage response headers after authorization. */
export async function loader(req: Request, res: Response) {
  getProbe().pageLoads++;
  res.locals.order.push("page-loader");
  res.cookie("loaded", "yes");
  res.set("X-Page-Loader", "native-express");

  return {
    user: getRequestContext().locals.user.id,
    order: [...res.locals.order],
    query: req.query.q ?? null,
  };
}

/** Build page metadata from the authorized loader result. */
export const metadata = (async ({ loaderData }) => {
  getProbe().metadataCalls++;

  return {
    title: `Member ${loaderData.user}`,
    description: "Member profile",
    canonical: "/guarded",
    openGraph: { images: ["/member.png"] },
    robots: { index: false, follow: false },
  };
}) satisfies MetadataFunction<typeof loader>;

/** Render the member data supplied by the page loader. */
export default function Page({ loaderData }: PageProps<typeof loader>) {
  getProbe().renders++;

  return (
    <>
      <h3>Private member page</h3>
      <p>{loaderData.user}</p>
      <pre>{JSON.stringify(loaderData)}</pre>
    </>
  );
}
