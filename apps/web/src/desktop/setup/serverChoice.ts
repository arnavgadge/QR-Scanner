import type { DiscoveredServer } from '../bridge';

/**
 * Which main computer a new station pairs with. Exactly one found: that one. More than one: never
 * picked silently; an administrator chooses (`mustChoose`) by name.
 */
export function serverChoice(
  servers: DiscoveredServer[],
  chosen: string | null,
): { server: DiscoveredServer | undefined; mustChoose: boolean } {
  if (servers.length === 1) return { server: servers[0], mustChoose: false };
  return {
    server: servers.find((s) => s.serverId === chosen),
    mustChoose: servers.length > 1,
  };
}

/** How a found main computer is shown: its computer name, with the short system ID. */
export const serverDisplayName = (s: DiscoveredServer) =>
  s.name ? `${s.name} (${s.label})` : s.label;
