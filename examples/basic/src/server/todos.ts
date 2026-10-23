export interface Todo {
  id: string;
  title: string;
  done: boolean;
}

/** An in-memory todo store; replace it with a database. */
export function createTodos() {
  const items = new Map<string, Todo>();
  let next = 1;

  /** Add a todo and return it. */
  const add = (title: string): Todo => {
    const todo = { id: String(next++), title, done: false };

    items.set(todo.id, todo);

    return todo;
  };

  add("Read the README");
  add("Open /api/openapi");

  return {
    add,
    list: () => [...items.values()],
    get: (id: string) => items.get(id),
    remove: (id: string) => items.delete(id),
  };
}

export type Todos = ReturnType<typeof createTodos>;
