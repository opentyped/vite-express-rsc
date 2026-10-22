// Keep this file a script so the virtual module declaration is ambient.

/// <reference types="vite/client" />
/// <reference types="@vitejs/plugin-rsc/types" />
declare module "virtual:express-rsc/routes" {
  export const definitions: import("./runtime/types.js").Definition[];
}

declare module "virtual:express-rsc/version" {
  const version: string;
  export default version;
}
