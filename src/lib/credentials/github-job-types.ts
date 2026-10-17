export type GitHubJobContext = Readonly<{
  family: "planning-projection" | "planning-lifecycle" | "comment-webhook" | "planning-webhook";
  id: string;
  lockToken: string;
}>;
