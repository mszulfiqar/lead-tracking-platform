import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Speed to Lead",
  description: "Speed-to-Lead platform for HVAC businesses.",
};

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-zinc-50 px-6 py-16 dark:bg-black">
      <main className="flex w-full max-w-lg flex-col items-start gap-6 rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
          Speed to Lead
        </h1>
        <p className="text-base leading-7 text-zinc-600 dark:text-zinc-400">
          Respond to every new inquiry fast. Workspaces are provisioned by the
          platform team.
        </p>
        <Link
          href="/sign-in"
          className="flex h-11 items-center justify-center rounded-full bg-foreground px-5 text-sm font-medium text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc]"
        >
          Sign in
        </Link>
      </main>
    </div>
  );
}
