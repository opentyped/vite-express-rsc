import type { RequestHandler } from "express";
import type { Todo } from "../../../../server/todos";

/** Read one todo. */
export const GET: RequestHandler<{ id: string }, Todo> = (req, res) => {
  const todo = res.locals.todos.get(req.params.id);

  if (todo) {
    res.json(todo);
  } else {
    res.sendStatus(404);
  }
};

GET.openapi = {
  operationId: "getTodo",
  tags: ["Todos"],
  responses: {
    "200": { description: "The todo" },
    "404": { description: "No todo with this id" },
  },
};

/** Delete one todo. */
export const DELETE: RequestHandler<{ id: string }> = (req, res) => {
  res.sendStatus(res.locals.todos.remove(req.params.id) ? 204 : 404);
};
