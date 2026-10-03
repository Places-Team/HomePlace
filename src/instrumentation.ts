/** Personal schedules start on server boot, including mobile-only installations. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startDeviceCleanup } = await import("./lib/linkDeviceRemoval");
    await startDeviceCleanup();
    const { startPlantReminderScheduler } = await import(
      "./lib/plantReminders"
    );
    startPlantReminderScheduler();
  }
}
