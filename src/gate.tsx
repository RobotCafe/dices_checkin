"use client";
import type { ReactNode } from "react";
import { logOut, signIn, useSession } from "@/lib/useData";

export function Gate({ children, adminOnly = false }: { children: ReactNode; adminOnly?: boolean }) {
  const s = useSession();
  if (s.state === "loading") return <main>Loading…</main>;
  if (s.state === "out")
    return (
      <main>
        <h1>DICES check-in</h1>
        <p>Staff only.</p>
        <button onClick={signIn}>Sign in with Google</button>
      </main>
    );
  if (s.state === "denied")
    return (
      <main>
        <h1>Not on the staff list</h1>
        <p>{s.email} hasn't been invited. Ask the admin to add you.</p>
        <button className="secondary" onClick={logOut}>Sign out</button>
      </main>
    );
  if (adminOnly && s.staff.role !== "admin") return <main><p>Admins only.</p></main>;
  return <>{children}</>;
}
