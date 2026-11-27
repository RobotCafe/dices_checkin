"use client";
import { onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut, type User } from "firebase/auth";
import { collection, doc, getDoc, onSnapshot, query, where, type Query } from "firebase/firestore";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { auth, db } from "./firebase";
import type { Headcount, Household, Pass, Person, Program, StaffMember, Visit } from "./types";

type Session =
  | { state: "loading" }
  | { state: "out" }
  | { state: "denied"; email: string }
  | { state: "in"; user: User; staff: StaffMember };

const Ctx = createContext<Session>({ state: "loading" });
export const useSession = () => useContext(Ctx);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [s, setS] = useState<Session>({ state: "loading" });
  useEffect(
    () =>
      onAuthStateChanged(auth, async (user) => {
        if (!user?.email) return setS({ state: "out" });
        const email = user.email.toLowerCase();
        try {
          const snap = await getDoc(doc(db, "staff", email));
          if (snap.exists()) setS({ state: "in", user, staff: snap.data() as StaffMember });
          else setS({ state: "denied", email });
        } catch {
          setS({ state: "denied", email });
        }
      }),
    [],
  );
  return <Ctx.Provider value={s}>{children}</Ctx.Provider>;
}

export const signIn = () => signInWithPopup(auth, new GoogleAuthProvider());
export const logOut = () => signOut(auth);

/** Live query. Re-subscribes when `key` changes; pass null to skip. */
export function useQuery<T>(q: Query | null, key: string): T[] {
  const [rows, setRows] = useState<T[]>([]);
  useEffect(() => {
    setRows([]);
    if (!q) return;
    return onSnapshot(q, (snap) => setRows(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as T)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return rows;
}

/** Programs this staff member may work in (leads see only theirs). */
export function usePrograms(): Program[] {
  const s = useSession();
  const all = useQuery<Program>(collection(db, "programs"), "programs");
  if (s.state !== "in") return [];
  const scope = s.staff.role === "admin" ? null : s.staff.programIds ?? null;
  return all
    .filter((p) => !p.archived && (!scope || scope.includes(p.id)))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Everything one program's check-in needs. Queries are per program so scoped leads stay within their rules. */
export function useProgramData(programId: string | null) {
  const k = programId ?? "";
  const people = useQuery<Person>(programId ? query(collection(db, "people"), where("programIds", "array-contains", programId), where("mergedInto", "==", null)) : null, "p" + k);
  const households = useQuery<Household>(programId ? query(collection(db, "households"), where("programIds", "array-contains", programId), where("mergedInto", "==", null)) : null, "h" + k);
  const passes = useQuery<Pass>(programId ? query(collection(db, "passes"), where("programId", "==", programId)) : null, "pa" + k);
  const visits = useQuery<Visit>(programId ? query(collection(db, "visits"), where("programId", "==", programId)) : null, "v" + k);
  const headcounts = useQuery<Headcount>(programId ? query(collection(db, "headcounts"), where("programId", "==", programId)) : null, "hc" + k);
  return { people, households, passes, visits, headcounts };
}
