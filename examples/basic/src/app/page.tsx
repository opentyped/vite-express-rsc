import { Link } from "react-router";
import { getRequestContext } from "express/rsc/context";
import TodoForm from "./TodoForm";

/** A server component: it reads the store directly, no API call needed. */
export default function Home() {
  const todos = getRequestContext().locals.todos.list();

  return (
    <>
      <h1>Todos</h1>
      <ul>
        {todos.map((todo) => (
          <li key={todo.id}>
            <Link to={`/todos/${todo.id}`}>{todo.title}</Link>
          </li>
        ))}
      </ul>
      <TodoForm />
    </>
  );
}
