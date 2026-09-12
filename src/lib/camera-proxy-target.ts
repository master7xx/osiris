const HOSTS = ['cdn.skylinewebcams.com', 'cdn2.skylinewebcams.com', 's3-eu-west-1.amazonaws.com', 'voyage.aprr.fr', 'stream.inmoves.nl', 'thb.gov.tw', 'etraffic.dgt.es'];
export function cameraProxyTarget(value: string, base?: string): URL {
  const url = new URL(value, base);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port
    || !HOSTS.some(host => url.hostname === host || url.hostname.endsWith('.' + host))) throw new Error('Forbidden camera target');
  return url;
}
