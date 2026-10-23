import type { PageLoader } from "express/rsc";

/** Set a cookie and redirect before the page starts rendering. */
export const loader: PageLoader = (_req, res) => {
  res.cookie("loader-redirect", "yes");
  res.redirect("/login");
};

/** Fail the test if rendering continues after the redirect. */
export default function NeverRendered() {
  throw new Error("Redirected component must never render");
}
