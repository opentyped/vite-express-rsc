import { db } from "../../server/db";

export default async function Dashboard() {
  return <p>Dashboard users: {await db.user.count()}</p>;
}
