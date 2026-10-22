import { Outlet } from "react-router";

export default function DashboardLayout() {
  return (
    <section data-layout="dashboard">
      <h2>Dashboard layout</h2>
      <Outlet />
    </section>
  );
}
