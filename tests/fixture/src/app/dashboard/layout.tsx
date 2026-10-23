import { Outlet } from "react-router";

/** Keep the dashboard shell mounted while nested pages change. */
export default function DashboardLayout() {
  return (
    <section data-layout="dashboard">
      <h2>Dashboard layout</h2>
      <Outlet />
    </section>
  );
}
