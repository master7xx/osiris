// MapLibre's cross-origin worker fallback contains a dynamic import.meta URL
// that Turbopack treats as a build-time asset. We configure an absolute,
// same-origin worker URL; resolve the unused cross-origin fallback at runtime.
module.exports = function maplibreWorkerLoader(source) {
  const pattern = /new URL\(([a-zA-Z_$][\w$]*),import\.meta\.url\)/g;
  let count = 0;
  const output = source.replace(pattern, (_, url) => {
    count++;
    return `new URL(${url},globalThis.location.href)`;
  });
  if (count !== 1) throw new Error('MapLibre worker loader needs review after dependency change');
  return output;
};
