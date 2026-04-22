import { parseRequestBody } from '@/lib/api/request';
import { handleRouteError } from '@/lib/api/response';
import { proxyToHttpFunction } from '@/lib/firebase/functions-proxy';
import { readModelSchema } from '@/lib/validation/schemas';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const body = await parseRequestBody(request, readModelSchema);
    return await proxyToHttpFunction(request, 'readModelV1', body);
  } catch (error) {
    return handleRouteError(error);
  }
}