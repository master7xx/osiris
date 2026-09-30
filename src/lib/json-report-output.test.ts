import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { writeJsonReport } from '../../tools/write-json-report';
it('writes Unicode directly and refuses overwrite or ambiguous arguments', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'osiris-report-'));
  const path = join(dir, 'review.json');
  const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    const report = { title: 'Київ — Петербург «новости» ⚡️', nested: ['Україна', 'déjà vu'] };
    await writeJsonReport(report, ['--output', path]);
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(report);
    await expect(writeJsonReport({}, ['--output', path])).rejects.toThrow();
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(report);
    await expect(writeJsonReport({}, ['--output'])).rejects.toThrow('Usage');
  } finally { spy.mockRestore(); await rm(dir, { recursive: true, force: true }); }
});

it('preserves prior review UUIDs, handles BOM and rejects invalid report references', async () => {
  const { previousReviewArgs } = await import('../../tools/read-previous-review');
  const { writeFile } = await import('node:fs/promises');
  const dir = await mkdtemp(join(tmpdir(), 'osiris-prior-'));
  const path = join(dir, 'prior.json');
  const id = 'f91ccc8b-613c-423c-a0d5-16a9294eee31';
  try {
    await writeFile(path, '\uFEFF' + JSON.stringify({ reconciliation: { stored_event_reviews: [{ id }, { id }] } }), 'utf8');
    expect(await previousReviewArgs(['--output','next.json','--previous-report',path])).toEqual({ args: ['--output','next.json'], previousIds: [id] });
    await expect(previousReviewArgs(['--previous-report'])).rejects.toThrow();
    await writeFile(path, JSON.stringify({ reconciliation: { stored_event_reviews: [{ id: 'unsafe' }] } }));
    await expect(previousReviewArgs(['--previous-report',path])).rejects.toThrow('UUID');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
