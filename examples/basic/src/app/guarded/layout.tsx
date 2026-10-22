import { Outlet } from "react-router";
import type { Middlewares, PageProps } from "@opentyped/vite-express-rsc";
import { probe } from "../../server/probe";

export const middlewares: Middlewares = [
  async (_req, res, next) => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    res.locals.order.push("layout-a");
    next();
  },
  (_req, res, next) => {
    res.locals.order.push("layout-b");

    if (res.locals.user.id !== "member") {
      res.cookie("auth-attempt", "1");
      res.cookie("auth-second", "2");
      res.redirect("/login");

      return;
    }

    next();
  },
];

export async function loader(
  _req: import("express").Request,
  res: import("express").Response,
) {
  probe.layoutLoads++;
  res.locals.order.push("layout-loader");

  return { organization: "Example organization" };
}

export const metadata = {
  title: { default: "Account", template: "%s · Account" },
  description: "Private area",
  openGraph: { images: ["/account.png"] },
};

export default function Layout({ loaderData }: PageProps<typeof loader>) {
  probe.renders++;

  return (
    <section data-layout="guarded">
      <h2>{loaderData.organization}</h2>
      <Outlet />
    </section>
  );
}
