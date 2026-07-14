import { LoadingState } from "@/components/states/loading-state";

export default function WorkspaceSelectionLoading() {
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 dark:bg-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-4xl">
        <LoadingState label="Loading your workspaces…" />
      </div>
    </main>
  );
}
