import type { ComponentProps, ReactNode } from "react";
import type { AuthControl } from "@/features/settings/organisms/auth-control";
import type { GitHubSyncTrigger } from "@/features/tasks/molecules/github-sync-trigger";
import type { PlanningState } from "@/features/planning/model/planning-state";
import type { Profile } from "@/lib/types";

export type ApplicationNavigation = {
  mobileNavOpen: boolean;
  openMobileNav: () => void;
  navigate: (href: string) => void;
};

export type ApplicationHeaderLifecycle = {
  planningState: PlanningState;
  enabled: boolean;
  notificationsWorkspace?: boolean;
  profiles: Profile[];
  account?: Omit<ComponentProps<typeof AuthControl>, "onOpenProfile" | "onOpenAdministration" | "variant">;
  github: ComponentProps<typeof GitHubSyncTrigger>;
};

export type ApplicationHeaderProps = {
  area: { title: string; description?: string; supportingContext?: string; heading?: boolean };
  lifecycle: ApplicationHeaderLifecycle;
  navigation: ApplicationNavigation;
  context?: ReactNode;
  focus?: { active: boolean; toggle: () => void };
  notices?: ReactNode;
};
