/// <reference types="vite/client" />
/// <reference types="@vitejs/plugin-rsc/types" />
declare module "virtual:express/rsc/routes" {
  export const tree: import("./runtime/routes.js").TreeNode;
}

declare module "virtual:express/rsc/router" {
  const router: import("express").Router;
  export default router;
}

declare module "virtual:express/rsc/config" {
  /** Browser build directory, relative to the Node build. */
  export const clientDirectory: string;
}

declare module "virtual:express/rsc/version" {
  const version: string;
  export default version;
}
