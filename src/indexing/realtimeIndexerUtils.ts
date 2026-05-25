export function scheduledPathMatchesTarget(filePath: string, targetPath: string): boolean {
  const normalized = targetPath.replace(/\/+$/, "");
  if (!normalized) {
    return filePath === targetPath;
  }
  return filePath === normalized || filePath.startsWith(`${normalized}/`);
}
