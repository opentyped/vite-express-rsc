import type { RequestHandler } from "express";
import type { Todo } from "../../../server/todos";

/** List all todos. */
export const GET: RequestHandler<Record<string, never>, Todo[]> = (
  _req,
  res,
) => {
  res.json(res.locals.todos.list());
};

GET.openapi = {
  operationId: "listTodos",
  tags: ["Todos"],
  responses: { "200": { description: "All todos" } },
};

/** Create a todo from a JSON body. */
export const POST: RequestHandler<
  Record<string, never>,
  Todo,
  { title: string }
> = (req, res) => {
  res.json(res.locals.todos.add(req.body.title));
};

POST.openapi = {
  operationId: "createTodo",
  tags: ["Todos"],
  responses: { "200": { description: "The created todo" } },
};
