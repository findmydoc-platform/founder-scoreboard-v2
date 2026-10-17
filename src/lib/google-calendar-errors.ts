export class GoogleWorkspaceOAuthContractError extends Error {
  readonly code:
    | "invalid_configuration"
    | "invalid_state"
    | "expired_state"
    | "state_binding_mismatch"
    | "invalid_token_response"
    | "scope_mismatch"
    | "provider_revoked"
    | "reconnect_required";

  constructor(
    code:
      | "invalid_configuration"
      | "invalid_state"
      | "expired_state"
      | "state_binding_mismatch"
      | "invalid_token_response"
      | "scope_mismatch"
      | "provider_revoked"
      | "reconnect_required",
    message: string,
  ) {
    super(message);
    this.name = "GoogleWorkspaceOAuthContractError";
    this.code = code;
  }
}

