import { useAppStore } from "../store/app-store";
import {
  applyHostFilters,
  collectHostGroups,
  collectHostTags,
  useHostsStore,
} from "../store/hosts-store";

interface ActiveHostFilters {
  activeGroup: string;
  activeTag: string;
  favoritesOnly: boolean;
}

export function useHosts(filters: ActiveHostFilters) {
  const hosts = useHostsStore((state) => state.hosts);
  const query = useAppStore((state) => state.sidebarSearch);

  return {
    allHosts: hosts,
    filteredHosts: applyHostFilters(hosts, {
      query,
      activeGroup: filters.activeGroup,
      activeTag: filters.activeTag,
      favoritesOnly: filters.favoritesOnly,
    }),
    groups: collectHostGroups(hosts),
    tags: collectHostTags(hosts),
  };
}
