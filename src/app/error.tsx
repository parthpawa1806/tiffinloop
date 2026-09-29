"use client";

import Link from "next/link";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <p className="mt-2 text-sm text-black/60 dark:text-white/60">
        Your last action may not have finished. Go back to the dropout to see what was saved before trying again.
      </p>
      <pre className="mt-4 whitespace-pre-wrap rounded-md bg-black/5 p-3 text-xs dark:bg-white/10">{error.message}</pre>
      <div className="mt-4 flex gap-3 text-sm">
        <button onClick={reset} className="rounded-md bg-black px-3 py-1.5 font-medium text-white dark:bg-white dark:text-black">
          Try again
        </button>
        <Link href="/" className="rounded-md border border-black/15 px-3 py-1.5 dark:border-white/20">Back to dropouts</Link>
      </div>
    </div>
  );
}
