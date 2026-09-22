// Default registry: Supabase is registered out of the box. Future adapters
// (Firebase in #38) extend this list.
//
// Why a module-level singleton: the worker process is single-tenant per
// invocation, and adapters are pure (no per-request state). Building the
// registry once at module load is the cheapest path; tests that need a
// fresh registry construct their own `new BackendAdapterRegistry()`.

import { BackendAdapterRegistry } from "./backend-adapter.js";
import { supabaseAdapter } from "./supabase.js";
import { firebaseAdapter } from "./firebase.js";

/** The process-wide default registry. Supabase + Firebase at load time.
 *  Registration order is detection order (see `detect`): Supabase first
 *  because its sniff is the more specific (config URL + ref); Firebase's
 *  markers are broader (an SDK import alone counts), so it runs second. */
export const defaultBackendRegistry = new BackendAdapterRegistry();

defaultBackendRegistry.register(supabaseAdapter);
defaultBackendRegistry.register(firebaseAdapter);
