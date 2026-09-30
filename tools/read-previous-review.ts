import { readFile } from 'node:fs/promises';

/** Keep previously reviewed UUIDs in scope even when their live conflict/signal window expires. */
export async function previousReviewArgs(args: string[]) {
  const index = args.indexOf('--previous-report');
  if (index < 0) return { args, previousIds: undefined };
  if (args.lastIndexOf('--previous-report') !== index || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error('Invalid previous report argument');
  const raw: unknown = JSON.parse((await readFile(args[index + 1], 'utf8')).replace(/^\uFEFF/, ''));
  if (!raw || typeof raw !== 'object') throw new Error('Invalid previous report');
  const reconciliation = (raw as { reconciliation?: unknown }).reconciliation;
  if (!reconciliation || typeof reconciliation !== 'object') throw new Error('Missing previous review');
  const reviews = (reconciliation as { stored_event_reviews?: unknown }).stored_event_reviews;
  if (!Array.isArray(reviews) || reviews.length > 1000) throw new Error('Invalid previous reviews');
  const previousIds = reviews.map(row => {
    if (!row || typeof row !== 'object' || typeof row.id !== 'string' || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(row.id)) throw new Error('Invalid stored UUID');
    return row.id as string;
  });
  return { args: [...args.slice(0, index), ...args.slice(index + 2)], previousIds: [...new Set(previousIds)] };
}
