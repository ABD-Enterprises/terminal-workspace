export interface NavigationItem {
  path: string;
  label: string;
  description: string;
}

export const navigationItems: NavigationItem[] = [
  {
    path: "/hosts",
    label: "Hosts",
    description: "Inventory, trust, and launch.",
  },
  {
    path: "/sessions",
    label: "Sessions",
    description: "Terminal tabs, panes, and restore.",
  },
  {
    path: "/snippets",
    label: "Snippets",
    description: "Saved commands and broadcast runs.",
  },
  {
    path: "/keys",
    label: "Keys",
    description: "SSH identities, keygen, and trust.",
  },
  {
    path: "/transfers",
    label: "Transfers",
    description: "Remote files and transfer queue.",
  },
  {
    path: "/tunnels",
    label: "Tunnels",
    description: "Active port forwards across sessions.",
  },
  {
    path: "/settings",
    label: "Settings",
    description: "Preferences, backup, and runtime mode.",
  },
];
