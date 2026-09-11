import { authenticate, sessionStorage } from "../shopify.server";

export const action = async ({ request }) => {
  const { payload, session, topic, shop } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);
  const current = payload.current;

  // The company staff page gates on session.scope to decide whether it can ask
  // for staff member fields, so this has to land for `read_users` to take
  // effect without a reinstall.
  if (session) {
    session.scope = current.toString();
    await sessionStorage.storeSession(session);
  }

  return new Response();
};
