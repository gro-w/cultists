/** Resolve content-package asset references from the repository-root entrypoint. */
export function resolveAssetPath(value) {
  const path = String(value ?? "");
  if (path.startsWith("data/assets/")) return path;
  return path;
}

export default resolveAssetPath;
