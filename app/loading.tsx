export default function Loading() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-8">
        <div className="h-8 w-48 animate-pulse bg-muted" />
        <div className="mt-10 grid gap-4">
          <div className="h-10 w-2/3 animate-pulse bg-muted" />
          <div className="h-32 animate-pulse bg-muted" />
          <div className="h-32 animate-pulse bg-muted" />
        </div>
      </div>
    </main>
  );
}
