import { useCallback, useEffect, useRef } from "react";
import {
  useLoaderData,
  useNavigation,
  useRouteError,
  useSearchParams,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { loadCompanyStaff } from "../lib/company-staff.server";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);

  const url = new URL(request.url);

  return loadCompanyStaff({
    admin,
    session,
    search: url.searchParams.get("q")?.trim() ?? "",
    after: url.searchParams.get("after"),
    before: url.searchParams.get("before"),
  });
};

export default function CompanyStaffPage() {
  const { companies, pageInfo, search, staffAccessError, setupError } =
    useLoaderData();
  const [, setSearchParams] = useSearchParams();
  const navigation = useNavigation();
  const searchRef = useRef(null);
  const searchInitialized = useRef(false);

  const isLoading = navigation.state === "loading";

  const navigateTo = useCallback(
    (params) => {
      const next = new URLSearchParams();
      const term = params.q ?? search;
      if (term) next.set("q", term);
      if (params.after) next.set("after", params.after);
      if (params.before) next.set("before", params.before);
      setSearchParams(next, { preventScrollReset: true });
    },
    [search, setSearchParams],
  );

  // Polaris web components emit native events that React 18 does not bind
  // through JSX props, so the search field is wired up by hand.
  useEffect(() => {
    const field = searchRef.current;
    if (!field) return undefined;

    if (!searchInitialized.current) {
      field.value = search;
      searchInitialized.current = true;
    }

    let timer;
    const handleInput = (event) => {
      const value = event.target.value ?? "";
      clearTimeout(timer);
      timer = setTimeout(() => navigateTo({ q: value.trim() }), 400);
    };

    field.addEventListener("input", handleInput);
    return () => {
      clearTimeout(timer);
      field.removeEventListener("input", handleInput);
    };
  }, [navigateTo, search]);

  return (
    <s-page heading="Company staff">
      {setupError && (
        <s-banner tone="critical" heading="Companies are unavailable">
          <s-paragraph>{setupError}</s-paragraph>
          <s-paragraph>
            B2B companies require a Shopify Plus store with B2B enabled, and the
            app needs the <code>read_companies</code> access scope.
          </s-paragraph>
        </s-banner>
      )}

      {staffAccessError && (
        <s-banner tone="warning" heading="Staff details are hidden">
          <s-paragraph>
            Companies and locations loaded, but staff names, emails, and phone
            numbers could not be read: {staffAccessError}
          </s-paragraph>
          <s-paragraph>
            <code>read_users</code> is a restricted scope. Ask Shopify Support
            to enable it for this app, then add it to{" "}
            <code>shopify.app.toml</code>, redeploy, and reinstall the app on
            this store.
          </s-paragraph>
        </s-banner>
      )}

      <s-section padding="none">
        <s-table variant="auto" {...(isLoading ? { loading: true } : {})}>
          <s-search-field
            slot="filters"
            ref={searchRef}
            label="Search companies"
            labelAccessibilityVisibility="exclusive"
            placeholder="Search companies by name"
          ></s-search-field>
          <s-table-header-row>
            <s-table-header listSlot="primary">Company</s-table-header>
            <s-table-header listSlot="labeled">Main contact</s-table-header>
            <s-table-header listSlot="labeled">Locations</s-table-header>
            <s-table-header listSlot="inline">Assigned staff</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {companies.map((company) => (
              <s-table-row key={company.id}>
                <s-table-cell>{company.name}</s-table-cell>
                <s-table-cell>{company.mainContact?.name ?? "—"}</s-table-cell>
                <s-table-cell>{company.locationsCount}</s-table-cell>
                <s-table-cell>
                  <s-badge tone={company.staff.length > 0 ? "success" : "info"}>
                    {String(company.staff.length)}
                  </s-badge>
                </s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      </s-section>

      {companies.length === 0 && !setupError && (
        <s-section>
          <s-paragraph>
            {search
              ? `No companies match "${search}".`
              : "This store has no B2B companies yet."}
          </s-paragraph>
        </s-section>
      )}

      {companies.map((company) => (
        <s-section key={company.id} heading={company.name}>
          {company.mainContact && (
            <s-paragraph>
              Main contact: {company.mainContact.name}
              {company.mainContact.email
                ? ` · ${company.mainContact.email}`
                : ""}
              {company.mainContact.phone
                ? ` · ${company.mainContact.phone}`
                : ""}
            </s-paragraph>
          )}

          {company.staff.length === 0 ? (
            <s-paragraph>
              {staffAccessError
                ? "Staff details are unavailable until the read_users scope is granted."
                : "No staff members are assigned to this company's locations."}
            </s-paragraph>
          ) : (
            <s-table variant="auto">
              <s-table-header-row>
                <s-table-header listSlot="primary">Name</s-table-header>
                <s-table-header listSlot="labeled">Email</s-table-header>
                <s-table-header listSlot="labeled">Phone</s-table-header>
                <s-table-header listSlot="labeled">Locations</s-table-header>
                <s-table-header listSlot="inline">Status</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {company.staff.map((staff) => (
                  <s-table-row key={staff.id}>
                    <s-table-cell>{staff.name}</s-table-cell>
                    <s-table-cell>
                      {staff.email ? (
                        <s-link href={`mailto:${staff.email}`}>
                          {staff.email}
                        </s-link>
                      ) : (
                        "—"
                      )}
                    </s-table-cell>
                    <s-table-cell>
                      {staff.phone ? (
                        <s-link href={`tel:${staff.phone}`}>
                          {staff.phone}
                        </s-link>
                      ) : (
                        "—"
                      )}
                    </s-table-cell>
                    <s-table-cell>{staff.locations.join(", ")}</s-table-cell>
                    <s-table-cell>
                      <s-badge tone={staff.active ? "success" : "info"}>
                        {staff.active ? "Active" : "Inactive"}
                      </s-badge>
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          )}
        </s-section>
      ))}

      {pageInfo && (pageInfo.hasPreviousPage || pageInfo.hasNextPage) && (
        <s-section>
          <s-stack direction="inline" gap="base">
            <s-button
              variant="tertiary"
              {...(pageInfo.hasPreviousPage ? {} : { disabled: true })}
              onClick={() => navigateTo({ before: pageInfo.startCursor })}
            >
              Previous
            </s-button>
            <s-button
              variant="tertiary"
              {...(pageInfo.hasNextPage ? {} : { disabled: true })}
              onClick={() => navigateTo({ after: pageInfo.endCursor })}
            >
              Next
            </s-button>
          </s-stack>
        </s-section>
      )}
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
