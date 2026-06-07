export type TimeAgoStyle = "compact" | "long";

export function timeAgo(ts: number, style: TimeAgoStyle = "compact"): string {
  if (!ts) {
    return "bilinmiyor";
  }

  const diffMs = Math.max(0, Date.now() - ts);
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) {
    return "az önce";
  }

  if (minutes < 60) {
    if (style === "compact") {
      return `${minutes}dk önce`;
    }
    return `${minutes} dakika önce`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    if (style === "compact") {
      return `${hours}sa önce`;
    }
    return `${hours} saat önce`;
  }

  const days = Math.floor(hours / 24);
  if (style === "compact") {
    return `${days}g önce`;
  }
  return `${days} gün önce`;
}
