import type { Request, Response } from "express";
import type { MetadataFunction, PageProps } from "express/rsc";

/** Load one todo with native Express request and response objects. */
export function loader(req: Request<{ id: string }>, res: Response) {
  const todo = res.locals.todos.get(req.params.id);

  if (!todo) {
    res.status(404);
  }

  return todo ?? null;
}

export const metadata: MetadataFunction<typeof loader> = ({ loaderData }) => ({
  title: loaderData?.title ?? "Not found",
});

/** Render the loaded todo. */
export default function TodoPage({
  loaderData: todo,
}: PageProps<typeof loader>) {
  if (!todo) {
    return <p>No such todo.</p>;
  }

  return (
    <>
      <h1>{todo.title}</h1>
      <p>{todo.done ? "Done" : "Open"}</p>
    </>
  );
}
