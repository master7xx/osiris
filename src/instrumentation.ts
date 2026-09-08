export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { installServerFetchInstrumentation } = await import('./lib/server-fetch-debug');
  installServerFetchInstrumentation();
}
