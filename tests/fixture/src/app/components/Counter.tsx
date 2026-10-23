"use client";
import { useState } from "react";

/** Render a client-side counter to demonstrate hydration and preserved state. */
export default function Counter() {
  const [count, setCount] = useState(0);

  return <button onClick={() => setCount(count + 1)}>Count: {count}</button>;
}
