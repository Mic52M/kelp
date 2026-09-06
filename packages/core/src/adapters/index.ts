// Public surface of the adapters module. The worker imports from here (or
// from the package barrel `index.ts` which re-exports us).

export {
  BackendAdapterRegistry,
  type BackendAdapter,
  type BackendMeta,
  type AuthModel,
  type AdapterRegistrationError,
} from "./backend-adapter.js";
export { supabaseAdapter, SUPABASE_TYPE } from "./supabase.js";
export { defaultBackendRegistry } from "./registry.js";