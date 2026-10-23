import type { Todos } from "./server/todos";

// Types res.locals for Express handlers and getRequestContext().locals for components.
declare global {
  namespace Express {
    interface Locals {
      todos: Todos;
    }
  }
}

export {};
