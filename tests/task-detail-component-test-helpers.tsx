import { JSDOM } from "jsdom";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { Task } from "../src/lib/types";

const DOM_GLOBALS = [
  "window",
  "self",
  "document",
  "navigator",
  "HTMLElement",
  "SVGElement",
  "Node",
  "Event",
  "MouseEvent",
  "getComputedStyle",
  "IS_REACT_ACT_ENVIRONMENT",
] as const;

export function taskFixture(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    order: 0,
    title: "Task",
    description: "",
    status: "Offen",
    priority: "P2",
    assignee: "",
    owner: "",
    workstream: "",
    deadline: "",
    definitionOfDone: "",
    dependsOn: "",
    evidenceLink: "",
    evidenceLinks: [],
    linkedPullRequests: [],
    issueNumber: "",
    issueUrl: "",
    note: "",
    watched: false,
    hours: 0,
    startDate: "",
    endDate: "",
    sprintId: "",
    reviewStatus: "not_requested",
    scorePoints: 0,
    scoreFinal: false,
    githubRepo: "management",
    githubIssueNumber: null,
    githubIssueUrl: "",
    githubIssueSyncStatus: "not_synced",
    githubIssueLastSyncedAt: "",
    githubIssueSyncError: "",
    taskType: "deliverable",
    parentTaskId: "",
    approvalStatus: "approved",
    approvalRevision: 1,
    parentApprovalStatus: "approved",
    scoreRelevant: true,
    ...overrides,
  };
}

export async function renderTestUi(ui: ReactNode) {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
    url: "http://localhost",
  });
  const previousGlobals = new Map<string, PropertyDescriptor | undefined>();
  const replacements: Record<(typeof DOM_GLOBALS)[number], unknown> = {
    window: dom.window,
    self: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    SVGElement: dom.window.SVGElement,
    Node: dom.window.Node,
    Event: dom.window.Event,
    MouseEvent: dom.window.MouseEvent,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    IS_REACT_ACT_ENVIRONMENT: true,
  };

  for (const key of DOM_GLOBALS) {
    previousGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value: replacements[key],
    });
  }

  const container = dom.window.document.querySelector<HTMLElement>("#root");
  if (!container) throw new Error("Test root is missing.");
  const root = createRoot(container);
  await act(async () => {
    root.render(ui);
  });

  return {
    container,
    async click(element: Element, init: MouseEventInit = {}) {
      let defaultPreventedByComponent = false;
      const preventBrowserNavigation = (event: Event) => {
        defaultPreventedByComponent = event.defaultPrevented;
        event.preventDefault();
      };
      container.addEventListener("click", preventBrowserNavigation);
      try {
        await act(async () => {
          element.dispatchEvent(new dom.window.MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            button: 0,
            ...init,
          }));
        });
      } finally {
        container.removeEventListener("click", preventBrowserNavigation);
      }
      return !defaultPreventedByComponent;
    },
    async cleanup() {
      await act(async () => {
        root.unmount();
      });
      dom.window.close();
      for (const key of DOM_GLOBALS) {
        const descriptor = previousGlobals.get(key);
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    },
  };
}
