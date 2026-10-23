import express from "express";
import app from "express/rsc/bundle";
import { createTodos } from "./server/todos";

const server = express();
// Create shared services once; pages and API routes receive them through res.locals.
const todos = createTodos();

server.use(express.json());
server.use((_req, res, next) => {
  res.locals.todos = todos;
  next();
});
server.use(app);

const port = Number(process.env.PORT ?? 3000);

server.listen(port, () => console.log(`http://localhost:${port}`));
