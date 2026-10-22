import type { PageLoader } from "@opentyped/vite-express-rsc";

export const loader: PageLoader = (_req, res) => {
  res.cookie("loader-redirect", "yes");
  res.redirect("/login");
};

export default function NeverRendered() {
  throw new Error("Redirected component must never render");
}
