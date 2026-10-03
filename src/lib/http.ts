import { ZodError } from 'zod';
export class ApiError extends Error { constructor(public status: number, message: string, public code = 'request_failed') { super(message); } }
export function json(data: unknown, status = 200) { return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } }); }
export function fail(error: unknown) {
  if (error instanceof ApiError) return json({ error: error.message, code: error.code }, error.status);
  if (error instanceof ZodError) return json({ error: 'Invalid request', details: error.issues.map(i => ({ path: i.path, message: i.message })) }, 400);
  console.error('Puente request failed:', error instanceof Error ? error.message : 'database operation');
  return json({ error: 'The operation could not be completed. Please retry.', code: 'internal_error' }, 500);
}
export async function endpoint(fn: () => Promise<unknown>) { try { return json(await fn()); } catch (error) { return fail(error); } }
export function assertDb(error: { message: string } | null) { if (error) throw new Error(error.message); }
