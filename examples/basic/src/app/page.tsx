import { Suspense } from "react";
import { db } from "../server/db";
import { getRequestContext } from "@opentyped/vite-express-rsc/context";

async function Content() {
  const before = getRequestContext();
  const count = await db.user.count();
  const after = getRequestContext();

  return (
    <p>
      Users: {count}; user: {after.user?.id}; request: {before.requestId}/
      {after.requestId}
    </p>
  );
}

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
