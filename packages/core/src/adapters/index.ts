// Public surface of the adapters module. The worker imports from here (or
// from the package barrel `index.ts` which re-exports us).

export {
  BackendAdapterRegistry,
  isSupabaseBackendMeta,
  type BackendAdapter,
  type BackendMeta,
  type SupabaseBackendMeta,
  type GenericBackendMeta,
  type SupabaseBackendConfig,
  type AuthModel,
  type AdapterRegistrationError,
} from "./backend-adapter.js";
export { supabaseAdapter, SUPABASE_TYPE } from "./supabase.js";
export { defaultBackendRegistry } from "./registry.js";
export {
  reconRepoViaRegistry,
  type RepoReconResult,
  type RepoSupabaseConfig,
} from "./recon.js";
