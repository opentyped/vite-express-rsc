"use client";
import { useState } from "react";
import { useRevalidator } from "react-router";

/** A client component: posts to the native API route, then refreshes the page data. */
export default function TodoForm() {
  const [title, setTitle] = useState("");
  const { revalidate } = useRevalidator();

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        await fetch("/api/todos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title }),
        });
        setTitle("");
        await revalidate();
      }}
    >
      <input
        aria-label="New todo"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
      />
      <button disabled={!title}>Add</button>
    </form>
  );
}
