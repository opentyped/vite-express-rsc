import type {
  Middlewares,
  MetadataFunction,
  PageProps,
} from "@opentyped/vite-express-rsc";
import type { Request, Response } from "express";
import { getRequestContext } from "@opentyped/vite-express-rsc/context";
import { probe } from "../../server/probe";

export const middlewares: Middlewares = (_req, res, next) => {
  res.locals.order.push("endpoint");
  next();
};

export async function loader(req: Request, res: Response) {
  probe.pageLoads++;
  res.locals.order.push("page-loader");
  res.cookie("loaded", "yes");
  res.set("X-Page-Loader", "native-express");

  return {
    user: getRequestContext().user?.id,
    order: [...res.locals.order],
    query: req.query.q ?? null,
  };
}

export const metadata = (async ({ loaderData }) => {
  probe.metadataCalls++;

  return {
    title: `Member ${loaderData.user}`,
    description: "Member profile",
    canonical: "/guarded",
    openGraph: { images: ["/member.png"] },
    robots: { index: false, follow: false },
  };
}) satisfies MetadataFunction<typeof loader>;

export default function Page({ loaderData }: PageProps<typeof loader>) {
  probe.renders++;

  return (
    <>
      <h3>Private member page</h3>
      <p>{loaderData.user}</p>
      <pre>{JSON.stringify(loaderData)}</pre>
    </>
  );
}
