import {
  disableCompanyWorker,
  updateCompanyWorker,
} from "@/lib/backend/workers-client";
import {
  handleWorkerDisable,
  handleWorkerUpdate,
} from "@/lib/workers/worker-mutation-route-core";

export const runtime = "nodejs";

export async function PATCH(request: Request) {
  return handleWorkerUpdate(request, { update: updateCompanyWorker });
}

export async function DELETE(request: Request) {
  return handleWorkerDisable(request, { disable: disableCompanyWorker });
}
