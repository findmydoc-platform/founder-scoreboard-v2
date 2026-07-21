const modalStack: HTMLElement[] = [];
const inertSnapshots = new Map<HTMLElement, boolean>();
const zIndexSnapshots = new Map<HTMLElement, string>();

const modalBaseZIndex = 80;
const modalZIndexStep = 8;

let scrollSnapshot: {
  bodyOverflow: string;
  bodyOverscrollBehavior: string;
  rootOverflow: string;
} | null = null;

function topModal() {
  return modalStack.at(-1) || null;
}

function collectInactiveBranches(dialog: HTMLElement) {
  const inactive = new Set<HTMLElement>();

  for (const stackedDialog of modalStack) {
    if (stackedDialog !== dialog && !stackedDialog.contains(dialog)) inactive.add(stackedDialog);
  }

  let branch: HTMLElement | null = dialog;
  while (branch?.parentElement) {
    const parent: HTMLElement = branch.parentElement;
    for (const sibling of Array.from(parent.children)) {
      if (sibling !== branch && sibling instanceof HTMLElement) inactive.add(sibling);
    }
    if (parent === document.body) break;
    branch = parent;
  }

  return inactive;
}

function synchronizeInertState() {
  const activeDialog = topModal();
  const inactiveBranches = activeDialog ? collectInactiveBranches(activeDialog) : new Set<HTMLElement>();

  for (const [element, originalInert] of Array.from(inertSnapshots.entries())) {
    if (inactiveBranches.has(element)) continue;
    if (element.isConnected) element.inert = originalInert;
    inertSnapshots.delete(element);
  }

  for (const element of inactiveBranches) {
    if (!inertSnapshots.has(element)) inertSnapshots.set(element, element.inert);
    element.inert = true;
  }
}

function synchronizeZIndexes() {
  modalStack.forEach((dialog, index) => {
    if (!zIndexSnapshots.has(dialog)) zIndexSnapshots.set(dialog, dialog.style.zIndex);
    dialog.style.zIndex = String(modalBaseZIndex + index * modalZIndexStep);
  });
}

function synchronizeScrollLock() {
  if (modalStack.length > 0 && !scrollSnapshot) {
    scrollSnapshot = {
      bodyOverflow: document.body.style.overflow,
      bodyOverscrollBehavior: document.body.style.overscrollBehavior,
      rootOverflow: document.documentElement.style.overflow,
    };
    document.body.style.overflow = "hidden";
    document.body.style.overscrollBehavior = "none";
    document.documentElement.style.overflow = "hidden";
    return;
  }

  if (modalStack.length > 0 || !scrollSnapshot) return;
  document.body.style.overflow = scrollSnapshot.bodyOverflow;
  document.body.style.overscrollBehavior = scrollSnapshot.bodyOverscrollBehavior;
  document.documentElement.style.overflow = scrollSnapshot.rootOverflow;
  scrollSnapshot = null;
}

function synchronizeModalEnvironment() {
  synchronizeInertState();
  synchronizeZIndexes();
  synchronizeScrollLock();
}

export function registerModal(dialog: HTMLElement) {
  const existingIndex = modalStack.lastIndexOf(dialog);
  if (existingIndex >= 0) modalStack.splice(existingIndex, 1);
  modalStack.push(dialog);
  synchronizeModalEnvironment();
}

export function unregisterModal(dialog: HTMLElement) {
  const wasTopModal = topModal() === dialog;
  const stackIndex = modalStack.lastIndexOf(dialog);
  if (stackIndex >= 0) modalStack.splice(stackIndex, 1);

  const originalZIndex = zIndexSnapshots.get(dialog);
  if (originalZIndex !== undefined) dialog.style.zIndex = originalZIndex;
  zIndexSnapshots.delete(dialog);

  synchronizeModalEnvironment();
  return { nextTopModal: topModal(), wasTopModal };
}

export function isTopModal(dialog: HTMLElement | null) {
  return Boolean(dialog) && topModal() === dialog;
}
