import { pageUser } from "@/lib/pageUser";
import { dict } from "@/i18n";
import {
  discoverMedia,
  jellyfinLibrary,
  jellyfinProfiles,
  listDownloads,
  listMediaRequests,
  mediaServiceIssues,
} from "@/lib/media";
import { servicesForDisplay } from "@/lib/services";
import { MediaLibrary } from "@/components/media/MediaLibrary";
import { watchHistory } from "@/lib/watchHistory";

export const dynamic = "force-dynamic";

function within<T>(
  promise: Promise<T>,
  fallback: T,
  milliseconds = 4000,
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) =>
      setTimeout(() => resolve(fallback), milliseconds),
    ),
  ]);
}

export default async function MediaPage() {
  const user = await pageUser();
  const d = dict(user.locale);
  const services = await servicesForDisplay();
  const [
    discover,
    library,
    requests,
    downloads,
    history,
    profiles,
    serviceIssues,
  ] = await Promise.all([
    within(discoverMedia(), {
      configured: !!services.overseerr.url,
      page: 1,
      pages: 1,
      items: [],
    }),
    within(jellyfinLibrary(user.jellyfinUserId ?? undefined), {
      configured: !!(services.jellyfin.url || services.jellyfin.localUrl),
      items: [],
    }),
    within(listMediaRequests(), []),
    within(listDownloads(), {
      configured: !!services.qbittorrent.url,
      items: [],
    }),
    watchHistory(user.id),
    within(jellyfinProfiles(), []),
    within(mediaServiceIssues(), []),
  ]);

  return (
    <MediaLibrary
      d={d}
      initialDiscover={discover}
      library={library}
      requests={requests}
      downloads={downloads}
      initialHistory={history}
      jellyfinProfiles={profiles}
      initialServiceIssues={serviceIssues}
      jellyfinUserId={user.jellyfinUserId ?? ""}
      jellyfin={{
        url: services.jellyfin.url,
        localUrl: services.jellyfin.localUrl,
        appUrl: services.jellyfin.appUrl,
      }}
      canManage={user.role !== "viewer"}
    />
  );
}
