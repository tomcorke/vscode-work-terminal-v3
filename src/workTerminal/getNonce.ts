export function getNonce(): string {
  return crypto.randomUUID().replaceAll("-", "");
}
