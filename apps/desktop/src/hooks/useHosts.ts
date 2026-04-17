import { useAppStore } from "../store/app-store";
import {
  applyHostFilters,
  buildHostEnvironmentSections,
  collectHostEnvironments,
  collectHostGroups,
  collectHostTags,
  useHostsStore,
} from "../store/hosts-store";

interface ActiveHostFilters {
  activeEnvironmentId: string;
  activeTag: string;
  favoritesOnly: boolean;
}

export function useHosts(filters: ActiveHostFilters) {
  const hosts = useHostsStore((state) => state.hosts);
  const environments = useHostsStore((state) => state.environments);
  const query = useAppStore((state) => state.sidebarSearch);
  const filteredHosts = applyHostFilters(hosts, {
    query,
    activeEnvironmentId: filters.activeEnvironmentId,
    activeTag: filters.activeTag,
    favoritesOnly: filters.favoritesOnly,
  });

  return {
    allHosts: hosts,
    filteredHosts,
    environmentSections: buildHostEnvironmentSections(filteredHosts, environments),
    environments: collectHostEnvironments(environments),
    groups: collectHostGroups(hosts),
    tags: collectHostTags(hosts),
  };
}
