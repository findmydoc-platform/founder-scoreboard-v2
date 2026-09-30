"use client";

import { Component, type ReactNode } from "react";
import { UiButton, UiNotice } from "@/shared/atoms/ui-primitives";

type PlanningViewLoadBoundaryProps = {
  children: ReactNode;
  onReturnToBoard: () => void;
};

export class PlanningViewLoadBoundary extends Component<PlanningViewLoadBoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <UiNotice role="alert" tone="danger" className="flex flex-wrap items-center gap-3">
          <span>Diese Ansicht konnte nicht geladen werden.</span>
          <UiButton onClick={this.props.onReturnToBoard} size="sm">Zum Board</UiButton>
        </UiNotice>
      );
    }
    return this.props.children;
  }
}
