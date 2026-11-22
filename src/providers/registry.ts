import type { Capability, Platform, SocialProvider } from "./types";

export interface ProviderRegistry {
  register(provider: SocialProvider): void;
  get(id: string): SocialProvider | undefined;
  list(): SocialProvider[];
  /** Provider làm được `capability` trên `platform`, theo thứ tự đăng ký (= thứ tự ưu tiên). */
  providersFor(platform: Platform, capability: Capability): SocialProvider[];
}

export function createRegistry(): ProviderRegistry {
  const byId = new Map<string, SocialProvider>();
  return {
    register(provider) {
      if (byId.has(provider.id))
        throw new Error(`Provider "${provider.id}" đã đăng ký`);
      byId.set(provider.id, provider);
    },
    get: (id) => byId.get(id),
    list: () => [...byId.values()],
    providersFor: (platform, capability) =>
      [...byId.values()].filter((p) =>
        p.support[platform]?.includes(capability),
      ),
  };
}
