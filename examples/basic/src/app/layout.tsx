import { Link, Outlet } from "react-router";
import Counter from "./components/Counter";
import "./style.css";

export const metadata = {
  title: { default: "Express + Vite RSC", template: "%s · Express + Vite RSC" },
  description: "Server rendered example",
  openGraph: { siteName: "Express RSC", images: ["/default.png"] },
};

export default function Layout() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
      </head>
      <body>
        <header>
          <h1>Express + Vite RSC</h1>
          <nav>
            <Link to="/">Home</Link> <Link to="/dashboard">Dashboard</Link>{" "}
            <Link to="/dashboard/users/42">User 42</Link>{" "}
            <Link to="/login">Login</Link> <Link to="/guarded">Account</Link>{" "}
            <Link to="/guarded/details">Account details</Link>{" "}
            <Link to="/reports/slow">Report</Link>
          </nav>
          <Counter />
        </header>
        <main>
          <Outlet />
        </main>
      </body>
    </html>
  );
}
