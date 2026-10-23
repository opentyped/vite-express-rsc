import { db } from "../../server/db";

/** Read server-side data and render the dashboard page. */
export default async function Dashboard() {
  return <p>Dashboard users: {await db.user.count()}</p>;
}
