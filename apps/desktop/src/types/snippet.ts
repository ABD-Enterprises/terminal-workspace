import { splitCommaList } from "../lib/utils";

export interface SnippetRecord {
  id: string;
  title: string;
  description: string;
  command: string;
  tags: string[];
  targetHostIds: string[];
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
}

export interface SnippetFormValues {
  title: string;
  description: string;
  command: string;
  tags: string;
  targetHostIds: string[];
}

export const emptySnippetFormValues: SnippetFormValues = {
  title: "",
  description: "",
  command: "",
  tags: "",
  targetHostIds: [],
};

export const sampleSnippets: SnippetRecord[] = [
  {
    id: "api-tail",
    title: "Tail API logs",
    description: "Quick check of the billing API service log.",
    command: "sudo journalctl -u billing-api -n 120 --no-pager",
    tags: ["logs", "api"],
    targetHostIds: ["billing-api"],
    createdAt: "2026-03-28T18:10:00.000Z",
    updatedAt: "2026-03-29T08:45:00.000Z",
  },
  {
    id: "disk-scan",
    title: "Disk usage scan",
    description: "Operator shortcut for filesystem pressure checks.",
    command: "df -h && du -sh /var/log 2>/dev/null | sort -h",
    tags: ["ops", "storage"],
    targetHostIds: ["prod-gateway", "edge-router-07"],
    createdAt: "2026-03-27T14:20:00.000Z",
    updatedAt: "2026-03-29T07:40:00.000Z",
  },
];

export function createSnippetRecord(
  values: SnippetFormValues,
  currentSnippet?: SnippetRecord
): SnippetRecord {
  const now = new Date().toISOString();

  return {
    id: currentSnippet?.id ?? crypto.randomUUID(),
    title: values.title.trim(),
    description: values.description.trim(),
    command: values.command,
    tags: splitCommaList(values.tags),
    targetHostIds: values.targetHostIds,
    createdAt: currentSnippet?.createdAt ?? now,
    updatedAt: now,
    lastRunAt: currentSnippet?.lastRunAt,
  };
}

export function snippetToFormValues(snippet: SnippetRecord): SnippetFormValues {
  return {
    title: snippet.title,
    description: snippet.description,
    command: snippet.command,
    tags: snippet.tags.join(", "),
    targetHostIds: snippet.targetHostIds,
  };
}
