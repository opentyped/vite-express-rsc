import { Outlet } from "react-router";

export default function Layout() {
  return (
    <section>
      <h2>Reports</h2>
      <Outlet />
    </section>
  );
}
