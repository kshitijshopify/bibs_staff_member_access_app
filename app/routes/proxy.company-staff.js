import { authenticate } from "../shopify.server";
import { loadStaffForCustomer, toPublicStaff } from "../lib/company-staff.server";

/**
 * Storefront JSON API: GET /apps/company-staff
 *
 * Returns the staff members assigned to the company locations that the
 * *currently logged-in* customer has a role at. Takes no parameters: the
 * customer is read from `logged_in_customer_id`, which Shopify adds and covers
 * with the request signature.
 *
 * `authenticate.public.appProxy` verifies that signature, so a caller cannot
 * forge the customer id or reach this route directly. Nothing here reads a
 * customer id supplied by the client — doing so would let any visitor request
 * another company's account manager.
 */
function json(body, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      // Per-customer data behind a proxy that Shopify may otherwise cache.
      "Cache-Control": "no-store, private",
    },
  });
}

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.public.appProxy(request);

  if (!admin || !session) {
    return json({ loggedIn: false, staff: [], error: "app_not_installed" }, 401);
  }

  const url = new URL(request.url);
  const loggedInCustomerId = url.searchParams.get("logged_in_customer_id");

  if (!loggedInCustomerId) {
    return json({ loggedIn: false, company: null, staff: [] }, 401);
  }

  const result = await loadStaffForCustomer({
    admin,
    session,
    customerId: loggedInCustomerId,
  });

  if (result.setupError) {
    // The detail names internal configuration, so it stays out of a response
    // that a storefront visitor can read.
    return json({ loggedIn: true, company: null, staff: [] }, 502);
  }

  return json({
    loggedIn: true,
    company: result.company,
    companies: result.companies,
    staff: result.staff.map(toPublicStaff),
    staffAccessGranted: result.staffAccessGranted,
  });
};
