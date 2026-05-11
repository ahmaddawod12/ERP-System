/**
 * I5: Dashboard loading segment.
 * Provides instant loading UI during route transitions within /app/*.
 */
import { LoadingState } from "@/components/states/loading-state";

export default function DashboardLoading() {
  return (
    <div className="p-6">
      <LoadingState label="Loading..." />
    </div>
  );
}
