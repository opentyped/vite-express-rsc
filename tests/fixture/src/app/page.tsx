import { Suspense } from "react";
import { db } from "../server/db";
import { getRequestContext } from "express/rsc/context";

/** Read server data and verify request context survives asynchronous work. */
async function Content() {
  const before = getRequestContext();
  const count = await db.user.count();
  const after = getRequestContext();

  return (
    <p>
      Users: {count}; user: {after.locals.user.id}; request:{" "}
      {before.locals.requestId}/{after.locals.requestId}
    </p>
  );
}

/** Render the home page with a fallback while server data is loading. */
export default function Home() {
  return (
    <>
      <h2>Server rendered home</h2>
      <Suspense fallback={<p>Loading database…</p>}>
        <Content />
      </Suspense>
    </>
  );
}
