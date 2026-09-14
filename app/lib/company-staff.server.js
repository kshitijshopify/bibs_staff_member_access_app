/**
 * Shared data access for B2B company staff assignments.
 *
 * Used by the embedded admin page (`app.companies.jsx`), the admin JSON API
 * (`api.company-staff.js`), and the storefront app proxy
 * (`proxy.company-staff.js`) so the query, the access-scope handling, and the
 * response shape stay identical between them.
 */

export const COMPANIES_PER_PAGE = 10;
export const MAX_COMPANIES_PER_PAGE = 50;
const LOCATIONS_PER_COMPANY = 20;
const STAFF_PER_LOCATION = 20;
const ROLE_ASSIGNMENTS_PER_CONTACT = 50;

const STAFF_MEMBER_SELECTION = `
  id
  name
  firstName
  lastName
  email
  phone
  active
  isShopOwner
  avatar { url }
`;

/**
 * A photo of the customer's assigned account manager, kept on the customer.
 *
 * It cannot live on the staff member: `StaffMember` has no metafields at all.
 * `reference` is what makes a `file_reference` metafield usable — its `value`
 * is only a gid. Resolving that reference is why the app needs `read_files`;
 * a metafield typed `url` would be readable from `value` alone.
 */
const STAFF_PROFILE_IMAGE_SELECTION = `
  staffProfileImage: metafield(namespace: "custom", key: "staff_profile_image") {
    id
    type
    value
    reference {
      ... on MediaImage {
        # Rendered as a small avatar on a storefront page, so ask Shopify's CDN
        # for a thumbnail rather than shipping the merchant's full-size upload.
        image {
          url(transform: { maxWidth: 256, maxHeight: 256 })
          altText
        }
      }
      ... on GenericFile {
        url
      }
    }
  }
`;

/**
 * Staff member fields live behind the `read_users` scope, which Shopify grants
 * only after a manual review. Callers still have to work before that approval
 * lands, so the staff selection is optional and we retry without it on denial.
 */
function buildCompaniesQuery({ includeStaff }) {
  const staffAssignments = includeStaff
    ? `staffMemberAssignments(first: ${STAFF_PER_LOCATION}) {
                nodes {
                  id
                  staffMember { ${STAFF_MEMBER_SELECTION} }
                }
              }`
    : "";

  return `#graphql
    query CompanyAssignedStaff(
      $first: Int
      $last: Int
      $after: String
      $before: String
      $query: String
    ) {
      companies(
        first: $first
        last: $last
        after: $after
        before: $before
        query: $query
      ) {
        pageInfo {
          hasNextPage
          hasPreviousPage
          startCursor
          endCursor
        }
        nodes {
          id
          name
          contactsCount { count }
          mainContact {
            id
            customer {
              id
              displayName
              defaultEmailAddress { emailAddress }
              defaultPhoneNumber { phoneNumber }
            }
          }
          locations(first: ${LOCATIONS_PER_COMPANY}) {
            nodes {
              id
              name
              ${staffAssignments}
            }
          }
        }
      }
    }`;
}

/**
 * Resolves the companies a single customer belongs to, along with the staff
 * assigned to the specific locations that customer holds a role at.
 */
function buildCustomerStaffQuery({ includeStaff }) {
  const staffAssignments = includeStaff
    ? `staffMemberAssignments(first: ${STAFF_PER_LOCATION}) {
                    nodes {
                      id
                      staffMember { ${STAFF_MEMBER_SELECTION} }
                    }
                  }`
    : "";

  return `#graphql
    query CustomerCompanyStaff($customerId: ID!) {
      customer(id: $customerId) {
        id
        ${STAFF_PROFILE_IMAGE_SELECTION}
        companyContactProfiles {
          id
          isMainContact
          title
          company {
            id
            name
          }
          roleAssignments(first: ${ROLE_ASSIGNMENTS_PER_CONTACT}) {
            nodes {
              id
              role { id name }
              companyLocation {
                id
                name
                ${staffAssignments}
              }
            }
          }
        }
      }
    }`;
}

function accessDeniedMessages(payload) {
  return (payload?.errors ?? [])
    .filter(
      (error) =>
        error?.extensions?.code === "ACCESS_DENIED" ||
        /access denied|not approved|read_users|permission/i.test(
          error?.message ?? "",
        ),
    )
    .map((error) => error.message);
}

async function runQuery(admin, query, variables) {
  const response = await admin.graphql(query, { variables });
  return response.json();
}

/** Accepts either a numeric id or a `gid://shopify/Company/123` string. */
function toNumericId(id) {
  if (!id) return null;
  const match = String(id).match(/(\d+)\s*$/);
  return match ? match[1] : null;
}

export function toCustomerGid(customerId) {
  const numericId = toNumericId(customerId);
  return numericId ? `gid://shopify/Customer/${numericId}` : null;
}

function normalizeStaffMember(staff) {
  return {
    id: staff.id,
    name:
      staff.name ||
      [staff.firstName, staff.lastName].filter(Boolean).join(" ") ||
      staff.email,
    firstName: staff.firstName ?? null,
    lastName: staff.lastName ?? null,
    email: staff.email ?? null,
    phone: staff.phone ?? null,
    active: staff.active,
    isShopOwner: staff.isShopOwner,
    avatarUrl: staff.avatar?.url ?? null,
    // Filled in by loadStaffProfileImages — see the note there on why the
    // photo cannot be read straight off the staff member.
    profileImageUrl: null,
    locations: [],
  };
}

/**
 * Staff are assigned to company *locations*, not to the company itself, so the
 * same person can appear under several locations. Collapse them into a single
 * entry and keep the list of locations they cover.
 */
function collectStaff(locations) {
  const staffById = new Map();

  for (const location of locations) {
    for (const assignment of location?.staffMemberAssignments?.nodes ?? []) {
      const staff = assignment?.staffMember;
      if (!staff) continue;

      const existing = staffById.get(staff.id);
      if (existing) {
        if (!existing.locations.includes(location.name)) {
          existing.locations.push(location.name);
        }
        continue;
      }

      const normalized = normalizeStaffMember(staff);
      normalized.locations.push(location.name);
      staffById.set(staff.id, normalized);
    }
  }

  return [...staffById.values()].sort((a, b) =>
    (a.name ?? "").localeCompare(b.name ?? ""),
  );
}

/**
 * Trims a staff member down to what is safe to hand a storefront visitor.
 *
 * `phone` is the staff member's Shopify account phone number, which may be a
 * personal one. Drop it from this projection if the merchant would rather only
 * publish a business contact.
 */
export function toPublicStaff(staff, fallbackImageUrl = null) {
  return {
    id: staff.id,
    name: staff.name,
    email: staff.email,
    phone: staff.phone,
    // Precedence: the photo on this staff member's own customer record, then
    // one set on the viewing customer's record, then the Shopify account
    // avatar — which is an auto-generated placeholder unless they uploaded one.
    profileImageUrl:
      staff.profileImageUrl ?? fallbackImageUrl ?? staff.avatarUrl,
    avatarUrl: staff.avatarUrl,
    locations: staff.locations,
  };
}

/**
 * Turns a `custom.staff_profile_image` metafield into a usable URL.
 *
 * Covers both shapes a merchant is likely to pick: a `file_reference`, where
 * `value` is only a gid and the URL has to come from `reference`, and a plain
 * `url`/text metafield, where `value` is the URL itself. The `http` test keeps
 * an unresolved gid from being handed to the storefront as if it were a URL.
 */
function resolveStaffProfileImage(metafield) {
  if (!metafield) return null;

  const referenceUrl =
    metafield.reference?.image?.url ?? metafield.reference?.url ?? null;
  if (referenceUrl) return referenceUrl;

  const value = metafield.value?.trim();
  return value && /^https?:\/\//i.test(value) ? value : null;
}

const STAFF_IMAGE_LOOKUP_LIMIT = 50;

function buildStaffProfileImagesQuery() {
  return `#graphql
    query StaffProfileImages($query: String!, $first: Int!) {
      customers(first: $first, query: $query) {
        nodes {
          id
          displayName
          firstName
          lastName
          defaultEmailAddress { emailAddress }
          ${STAFF_PROFILE_IMAGE_SELECTION}
        }
      }
    }`;
}

/** Quotes a value for Shopify search syntax so spaces do not split the term. */
function quoteSearchValue(value) {
  return `"${String(value).replace(/(["\\])/g, "\\$1")}"`;
}

function normalizeKey(value) {
  return (value ?? "").trim().toLowerCase();
}

function staffSearchClauses(staff) {
  const clauses = [];

  for (const member of staff) {
    if (member.email) {
      clauses.push(`email:${quoteSearchValue(member.email)}`);
    } else if (member.firstName && member.lastName) {
      clauses.push(
        `(first_name:${quoteSearchValue(member.firstName)} AND ` +
          `last_name:${quoteSearchValue(member.lastName)})`,
      );
    } else if (member.name) {
      clauses.push(quoteSearchValue(member.name));
    }
  }

  return clauses;
}

/**
 * Finds each staff member's profile photo, keyed by staff id.
 *
 * The photo cannot be read off the staff member: `StaffMember` has no
 * metafields at all. The merchant instead keeps `custom.staff_profile_image` on
 * a Customer record standing for the same person, so this matches the two up.
 *
 * Email is tried first because it is unique. A full name is not — two customers
 * can share one — so a name match is only trusted when exactly one customer
 * carries that name, otherwise the staff member is left without a photo rather
 * than shown the wrong person's face.
 */
async function loadStaffProfileImages(admin, staff) {
  const clauses = staffSearchClauses(staff);
  if (clauses.length === 0) return new Map();

  const payload = await runQuery(admin, buildStaffProfileImagesQuery(), {
    query: clauses.join(" OR "),
    first: STAFF_IMAGE_LOOKUP_LIMIT,
  });

  if (payload.errors?.length) {
    console.warn(
      `[company-staff] Could not look up staff profile images: ` +
        `${payload.errors[0].message}`,
    );
    return new Map();
  }

  const byEmail = new Map();
  const byName = new Map();
  const ambiguousNames = new Set();

  for (const node of payload.data?.customers?.nodes ?? []) {
    const imageUrl = resolveStaffProfileImage(node.staffProfileImage);
    if (!imageUrl) continue;

    const email = normalizeKey(node.defaultEmailAddress?.emailAddress);
    if (email) byEmail.set(email, imageUrl);

    const name = normalizeKey(
      node.displayName ||
        [node.firstName, node.lastName].filter(Boolean).join(" "),
    );
    if (!name) continue;

    if (byName.has(name) && byName.get(name) !== imageUrl) {
      ambiguousNames.add(name);
    } else {
      byName.set(name, imageUrl);
    }
  }

  const imageByStaffId = new Map();

  for (const member of staff) {
    const email = normalizeKey(member.email);
    const emailMatch = email ? byEmail.get(email) : null;
    if (emailMatch) {
      imageByStaffId.set(member.id, emailMatch);
      continue;
    }

    const name = normalizeKey(member.name);
    if (name && !ambiguousNames.has(name) && byName.has(name)) {
      imageByStaffId.set(member.id, byName.get(name));
    }
  }

  return imageByStaffId;
}

function flattenCompany(company) {
  const locations = company.locations?.nodes ?? [];
  const mainContact = company.mainContact?.customer ?? null;

  return {
    id: company.id,
    name: company.name,
    contactsCount: company.contactsCount?.count ?? 0,
    locationsCount: locations.length,
    locations: locations.map((location) => ({
      id: location.id,
      name: location.name,
    })),
    mainContact: mainContact
      ? {
          id: mainContact.id,
          name: mainContact.displayName,
          email: mainContact.defaultEmailAddress?.emailAddress ?? null,
          phone: mainContact.defaultPhoneNumber?.phoneNumber ?? null,
        }
      : null,
    staff: collectStaff(locations),
  };
}

export function hasStaffScope(session) {
  return (session?.scope ?? "")
    .split(",")
    .map((scope) => scope.trim())
    .includes("read_users");
}

/**
 * Runs a staff-bearing query, transparently retrying without the staff
 * selection when Shopify denies it. Returns the payload plus what went wrong.
 */
async function runWithStaffFallback(admin, session, buildQuery, variables) {
  // `read_users` can only sit in shopify.app.toml once Shopify Support has
  // enabled it for the app, so the store may legitimately be running without
  // it. Reading the granted scopes off the session avoids spending a request
  // on a query that is guaranteed to come back denied.
  const staffScopeGranted = hasStaffScope(session);

  let staffAccessError = staffScopeGranted
    ? null
    : "This app is not requesting the read_users access scope yet.";

  let payload = await runQuery(
    admin,
    buildQuery({ includeStaff: staffScopeGranted }),
    variables,
  );

  if (staffScopeGranted) {
    const staffDenied = accessDeniedMessages(payload);
    if (staffDenied.length > 0) {
      staffAccessError = staffDenied[0];
      payload = await runQuery(
        admin,
        buildQuery({ includeStaff: false }),
        variables,
      );
    }
  }

  return {
    payload,
    staffAccessGranted: staffScopeGranted && !staffAccessError,
    staffAccessError,
  };
}

/**
 * Loads companies with the staff members assigned to their locations.
 *
 * Never throws on a missing access scope — inspect `staffAccessError` and
 * `setupError` on the result to tell the caller what is unavailable and why.
 */
export async function loadCompanyStaff({
  admin,
  session,
  search = "",
  after = null,
  before = null,
  limit = COMPANIES_PER_PAGE,
  companyId = null,
}) {
  const pageSize = Math.min(
    Math.max(Number(limit) || COMPANIES_PER_PAGE, 1),
    MAX_COMPANIES_PER_PAGE,
  );

  // A company id filter is an exact lookup, so it replaces the search term
  // rather than combining with it.
  const numericCompanyId = toNumericId(companyId);
  const queryFilter = numericCompanyId
    ? `id:${numericCompanyId}`
    : search || null;

  const variables = {
    query: queryFilter,
    ...(before
      ? { last: pageSize, before }
      : { first: pageSize, after: after || null }),
  };

  const { payload, staffAccessGranted, staffAccessError } =
    await runWithStaffFallback(
      admin,
      session,
      buildCompaniesQuery,
      variables,
    );

  if (!payload.data?.companies) {
    return {
      companies: [],
      pageInfo: null,
      search,
      staffAccessGranted: false,
      staffAccessError,
      setupError:
        payload.errors?.[0]?.message ??
        "Companies could not be loaded for this store.",
    };
  }

  return {
    companies: payload.data.companies.nodes.map(flattenCompany),
    pageInfo: payload.data.companies.pageInfo,
    search,
    staffAccessGranted,
    staffAccessError,
    setupError: null,
  };
}

/**
 * Loads the staff assigned to the company locations that one specific customer
 * holds a role at.
 *
 * `customerId` must come from a source the storefront cannot forge — for an app
 * proxy request that is the signed `logged_in_customer_id` parameter, never a
 * value supplied by the caller.
 */
export async function loadStaffForCustomer({ admin, session, customerId }) {
  const customerGid = toCustomerGid(customerId);

  if (!customerGid) {
    return {
      company: null,
      companies: [],
      staff: [],
      staffProfileImageUrl: null,
      staffAccessGranted: false,
      staffAccessError: null,
      setupError: "A valid customer id is required.",
    };
  }

  const { payload, staffAccessGranted, staffAccessError } =
    await runWithStaffFallback(admin, session, buildCustomerStaffQuery, {
      customerId: customerGid,
    });

  if (!payload.data) {
    return {
      company: null,
      companies: [],
      staff: [],
      staffProfileImageUrl: null,
      staffAccessGranted: false,
      staffAccessError,
      setupError:
        payload.errors?.[0]?.message ??
        "Company details could not be loaded for this customer.",
    };
  }

  const staffProfileImageUrl = resolveStaffProfileImage(
    payload.data.customer?.staffProfileImage,
  );
  const profiles = payload.data.customer?.companyContactProfiles ?? [];
  const allLocations = [];

  const companies = profiles.map((profile) => {
    const assignments = profile.roleAssignments?.nodes ?? [];
    const locations = assignments
      .map((assignment) => assignment?.companyLocation)
      .filter(Boolean);

    allLocations.push(...locations);

    return {
      id: profile.company?.id ?? null,
      name: profile.company?.name ?? null,
      isMainContact: profile.isMainContact,
      title: profile.title ?? null,
      locations: assignments.map((assignment) => ({
        id: assignment.companyLocation?.id ?? null,
        name: assignment.companyLocation?.name ?? null,
        role: assignment.role?.name ?? null,
      })),
    };
  });

  const staff = collectStaff(allLocations);

  // One extra request, and only when there is actually someone to look up.
  if (staff.length > 0) {
    const imageByStaffId = await loadStaffProfileImages(admin, staff);
    for (const member of staff) {
      member.profileImageUrl = imageByStaffId.get(member.id) ?? null;
    }
  }

  return {
    company: companies[0] ?? null,
    companies,
    staff,
    staffProfileImageUrl,
    staffAccessGranted,
    staffAccessError,
    setupError: null,
  };
}
