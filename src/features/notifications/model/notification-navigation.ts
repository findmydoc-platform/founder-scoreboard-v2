export async function navigateAfterNotificationStatusUpdate(
  updateStatus: () => Promise<void>,
  navigate: () => void,
) {
  await updateStatus();
  navigate();
}
