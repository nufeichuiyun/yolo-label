// 留空沿用分离部署的 8000 端口；同源部署显式设置为 /。
export function resolveApiBaseUrl(
  configured: string | undefined,
  development: boolean,
  location?: { protocol: string; hostname: string }
): string {
  if (configured !== undefined) return configured.trim() === '/' ? '' : configured.trim().replace(/\/$/, '')
  if (development || !location) return ''
  return `${location.protocol}//${location.hostname}:8000`
}
