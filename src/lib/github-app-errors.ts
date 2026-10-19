export class GitHubAppConfigurationError extends Error {}
export class GitHubAppUserTokenRequiredError extends Error {}
export class GitHubAppUserTokenBusyError extends Error {}
export class GitHubConnectionError extends Error {
  constructor(readonly next:string) { super("GitHub-Verbindung konnte nicht hergestellt werden."); }
}
