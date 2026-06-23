// Canonical host redirect: www.geoloc.cc -> geoloc.cc (301), preserving path + query.
// Runs on every request; non-www requests pass straight through to static assets.
export async function onRequest(context) {
  const url = new URL(context.request.url);
  if (url.hostname === "www.geoloc.cc") {
    url.hostname = "geoloc.cc";
    return Response.redirect(url.toString(), 301);
  }
  return context.next();
}
