export const desktopSidebarStorageKey = "founderops.desktop-sidebar-expanded";

// Run synchronously in the document head, before streamed sidebar markup can paint.
export const desktopSidebarBootstrapScript = `try{document.documentElement.dataset.desktopSidebarExpanded=String(localStorage.getItem(${JSON.stringify(desktopSidebarStorageKey)})!=="false")}catch{document.documentElement.dataset.desktopSidebarExpanded="true"}`;

export function desktopSidebarExpandedSnapshot() {
  return document.documentElement.dataset.desktopSidebarExpanded !== "false";
}

export function subscribeToDesktopSidebar(listener: () => void) {
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-desktop-sidebar-expanded"] });
  return () => observer.disconnect();
}

export function toggleDesktopSidebarPreference() {
  const expanded = !desktopSidebarExpandedSnapshot();
  document.documentElement.dataset.desktopSidebarExpanded = String(expanded);
  try {
    localStorage.setItem(desktopSidebarStorageKey, String(expanded));
  } catch {
    // Keep the preference for this document even when storage is unavailable.
  }
}
