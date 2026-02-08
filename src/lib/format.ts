export function formatTime(ts: number | null | undefined): string {
  if (!ts) {
    return "";
  }
  const date = new Date(ts);
  return date.toLocaleString();
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  let size = Math.max(0, bytes);
  let idx = 0;
  while (size >= 1024 && idx < units.length - 1) {
    size /= 1024;
    idx += 1;
  }
  return `${size.toFixed(size >= 10 || idx === 0 ? 0 : 1)} ${units[idx]}`;
}

export function truncate(text: string, max = 140): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max - 1)}…`;
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function formatTokens(value: number | null | undefined): string {
  if (!Number.isFinite(value)) {
    return "-";
  }
  return new Intl.NumberFormat().format(value as number);
}

export function formatCompactTokens(value: number | null | undefined): string {
  if (!Number.isFinite(value)) {
    return "-";
  }
  const raw = value as number;
  const abs = Math.abs(raw);
  if (abs >= 1_000_000) {
    return `${(raw / 1_000_000).toFixed(1)}m`;
  }
  if (abs >= 10_000) {
    return `${Math.round(raw / 1_000)}k`;
  }
  if (abs >= 1_000) {
    return `${(raw / 1_000).toFixed(1)}k`;
  }
  return String(Math.round(raw));
}
