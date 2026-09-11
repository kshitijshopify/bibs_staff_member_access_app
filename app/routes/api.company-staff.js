import { authenticate } from "../shopify.server";
import { loadCompanyStaff } from "../lib/company-staff.server";

/**
 * JSON API: GET /api/company-staff
 *
 * Query parameters
 *   q          Search companies by name (ignored when companyId is set).
 *   companyId  Exact company lookup. Accepts `gid://shopify/Company/123`
 *              or the bare numeric id.
 *   limit      Companies per page, 1-50. Defaults to 10.
 *   after      Cursor from a previous response's pageInfo.endCursor.
 *   before     Cursor from a previous response's pageInfo.startCursor.
 *
 * Responds 200 with the payload, or 403 when the store or the app is missing
 * the access needed to read companies at all. A missing `read_users` scope is
 * not an error: companies still load and `staffAccessGranted` reports false.
 *
 * Auth is the embedded app's session token, which App Bridge attaches to
 * same-origin `fetch` calls automatically. Calling this from the storefront
 * needs an App Proxy route instead — the session token does not exist there.
 */
export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);

  const url = new URL(request.url);
  const limit = url.searchParams.get("limit");

  const result = await loadCompanyStaff({
    admin,
    session,
    search: url.searchParams.get("q")?.trim() ?? "",
    after: url.searchParams.get("after"),
    before: url.searchParams.get("before"),
    companyId: url.searchParams.get("companyId"),
    ...(limit ? { limit } : {}),
  });

  return Response.json(result, {
    status: result.setupError ? 403 : 200,
    headers: { "Cache-Control": "no-store" },
  });
};
