/**
 * Health check for the host platform (Render's `healthCheckPath`).
 *
 * Deliberately does no Shopify auth and no database work — it answers whether
 * the process is up and serving, not whether every dependency is reachable.
 */
export const loader = () =>
  new Response("ok", {
    status: 200,
    headers: {
      "Content-Type": "text/plain",
      "Cache-Control": "no-store",
    },
  });
