import { pageUser } from "@/lib/pageUser";
import { dict } from "@/i18n";
import { discoverMedia, jellyfinLibrary, listDownloads, listMediaRequests } from "@/lib/media";
import { servicesForDisplay } from "@/lib/services";
import { MediaLibrary } from "@/components/media/MediaLibrary";

export const dynamic = "force-dynamic";

export default async function MediaPage() {
  const user = await pageUser();
  const d = dict(user.locale);
  const [discover, library, requests, downloads, services] = await Promise.all([
    discoverMedia(),
    jellyfinLibrary(),
    listMediaRequests(),
    listDownloads(),
    servicesForDisplay(),
  ]);

  return (
    <MediaLibrary
      d={d}
      initialDiscover={discover}
      library={library}
      requests={requests}
      downloads={downloads}
      jellyfin={{
        url: services.jellyfin.url,
        localUrl: services.jellyfin.localUrl,
        appUrl: services.jellyfin.appUrl,
      }}
      canManage={user.role !== "viewer"}
    />
  );
}
