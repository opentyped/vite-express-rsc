import { Outlet } from "react-router";

/** Wrap report pages in a shared layout. */
export default function Layout() {
  return (
    <section>
      <h2>Reports</h2>
      <Outlet />
    </section>
  );
}
