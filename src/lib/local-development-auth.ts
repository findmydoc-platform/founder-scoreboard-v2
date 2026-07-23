type RuntimeEnvironment = Record<string, string | undefined>;

function localRuntimeEnvironment(): RuntimeEnvironment {
  return {
    NODE_ENV: process.env.NODE_ENV,
    ENABLE_LOCAL_LOGIN: process.env.ENABLE_LOCAL_LOGIN,
    NEXT_PUBLIC_ENABLE_LOCAL_LOGIN: process.env.NEXT_PUBLIC_ENABLE_LOCAL_LOGIN,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_URL: process.env.SUPABASE_URL,
  };
}

export function isLoopbackHostname(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
}

export function isLoopbackRequestHost(host: string) {
  try {
    return isLoopbackHostname(new URL(`http://${host}`).hostname);
  } catch {
    return false;
  }
}

export function isLoopbackSupabaseUrl(value: string | undefined) {
  if (!value) return false;
  try {
    return isLoopbackHostname(new URL(value).hostname);
  } catch {
    return false;
  }
}

export function isLocalLoginSimulationEnabled(environment: RuntimeEnvironment = localRuntimeEnvironment()) {
  return environment.NODE_ENV === "development"
    && environment.NEXT_PUBLIC_ENABLE_LOCAL_LOGIN === "true"
    && isLoopbackSupabaseUrl(environment.NEXT_PUBLIC_SUPABASE_URL);
}

export function isLocalLoginRequestAllowed(host: string, environment: RuntimeEnvironment = localRuntimeEnvironment()) {
  return environment.NODE_ENV === "development"
    && environment.ENABLE_LOCAL_LOGIN === "true"
    && isLoopbackRequestHost(host)
    && isLoopbackSupabaseUrl(environment.NEXT_PUBLIC_SUPABASE_URL || environment.SUPABASE_URL);
}
