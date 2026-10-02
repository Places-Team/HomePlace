import { pageUser } from "@/lib/pageUser";
import { listPlants, plantDto, plantSettings } from "@/lib/plants";
import { telegramConfig } from "@/lib/integrations";
import { prisma } from "@/lib/db";
import { PlantsWorkspace } from "@/components/plants/PlantsWorkspace";
export const dynamic = "force-dynamic";
export default async function PlantsPage({
  searchParams,
}: {
  searchParams: Promise<{ plant?: string }>;
}) {
  const user = await pageUser();
  const [plants, settings, telegram, query, pending] = await Promise.all([
    listPlants(user.id),
    plantSettings(user.id),
    telegramConfig(),
    searchParams,
    prisma.plantAlert.count({
      where: {
        plant: { userId: user.id },
        finishedAt: null,
        attempts: { gt: 0 },
      },
    }),
  ]);
  return (
    <PlantsWorkspace
      now={new Date().toISOString()}
      ru={user.locale === "ru"}
      initialPlants={JSON.parse(
        JSON.stringify(
          plants.filter((plant) => !plant.deletedAt).map(plantDto),
        ),
      )}
      initialSettings={settings}
      telegramReady={telegram?.enabled === true}
      focusId={query.plant}
      pending={pending}
    />
  );
}
