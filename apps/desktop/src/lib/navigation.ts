export interface NavigationItem {
  path: string;
  label: string;
  description: string;
  badge?: string;
}

export const navigationItems: NavigationItem[] = [
  {
    path: "/hosts",
    label: "Hosts",
    description: "Inventory, tags, groups, favorites, and quick filters.",
  },
  {
    path: "/sessions",
    label: "Sessions",
    description: "Terminal tabs, split panes, reconnect flow, and restore.",
    badge: "Local",
  },
  {
    path: "/snippets",
    label: "Snippets",
    description: "Reusable commands, libraries, and broadcast execution.",
  },
  {
    path: "/keys",
    label: "Keys",
    description: "Imported identities, generated SSH keys, and known hosts.",
  },
  {
    path: "/transfers",
    label: "Transfers",
    description: "SFTP browser, upload queue, and remote file operations.",
  },
  {
    path: "/settings",
    label: "Settings",
    description: "Preferences, restore behavior, and local-first defaults.",
  },
];
