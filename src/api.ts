export const API = "https://ali-memory-bank.tom-d-vox.workers.dev";
export type Session = {
  id: string;
  title: string;
  created_at: number | null;
  updated_at: number | null;
  topics: string[];
  message_count: number;
  core: number;
};
export type Hit = Session & {
  messageOrder: number;
  role: string;
  excerpt: string;
};
export type Message = {
  id: string;
  ord: number;
  role: string;
  timestamp: string | null;
  content: string;
  parent_id: string | null;
};
export type SearchResult = {
  results: Hit[];
  total: number;
  offset: number;
  query: string;
};
export type Slice = { session: Session; messages: Message[]; start: number };
export type Stats = {
  sessions: number;
  messages: number;
  coreSessions: number;
  earliest: number | null;
  latest: number | null;
};
export type Topic = { topic: string; count: number };
export type Identity = { email: string; expiresAt: number };

export async function get<T>(
  path: string,
  token: string,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(API + path, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
    signal,
  });
  if (response.status === 401)
    throw new Error("Your session expired. Please sign in again.");
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error || "The archive could not be read.");
  return data as T;
}

export function download(
  name: string,
  content: string,
  mime = "text/markdown",
) {
  const url = URL.createObjectURL(
    new Blob([content], { type: `${mime};charset=utf-8` }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
