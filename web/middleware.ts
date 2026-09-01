import { NextResponse, type NextRequest } from "next/server";

/* Send a phone to the phone app.
 *
 * The desktop shell at / is built for >= 1440x900 (see AppShell.tsx) and the
 * phone has its own app at /m. Nothing connected the two: there was no
 * middleware, no link, and no width check anywhere in the app, so the only
 * reference to /m in the whole repo was manifest.ts's start_url — which only
 * applies AFTER someone has already installed the app to their home screen,
 * from a page they could not read.
 *
 * WHY USER AGENT AND NOT WIDTH. Middleware runs on the server, before any
 * markup exists, so there is no viewport to measure. Doing it on the client
 * instead would mean painting the wrong app first and swapping it, which is
 * both slower and visibly wrong. UA is the only signal available this early,
 * and being wrong about it is survivable because the choice is escapable in
 * both directions.
 *
 * TABLETS ARE DELIBERATELY NOT PHONES. An iPad gets the desktop app: the lap
 * rail and the ribbon want the width, and a tablet has it. That is why the
 * pattern below matches "Android ... Mobile" rather than bare "Android", and
 * does not match iPad at all.
 */
const PHONE_UA = /iPhone|iPod|Android.+Mobile|IEMobile|BlackBerry|Opera Mini|webOS/i;

/* The escape hatch, in both directions. ?desktop=1 pins the desktop app on a
 * phone and ?desktop=0 releases it, and the choice is remembered so it does not
 * have to be re-typed on every visit. A redirect you cannot get out of is worse
 * than no redirect: it decides for a driver who has already decided. */
const OVERRIDE_COOKIE = "proctor-view";
const OVERRIDE_PARAM = "desktop";
const ONE_YEAR = 60 * 60 * 24 * 365;

export function middleware(request: NextRequest) {
  const { nextUrl, cookies, headers } = request;
  const override = nextUrl.searchParams.get(OVERRIDE_PARAM);

  // An explicit choice is recorded and always wins over the sniff.
  if (override === "1" || override === "0") {
    const url = nextUrl.clone();
    url.searchParams.delete(OVERRIDE_PARAM);
    const wantsDesktop = override === "1";

    // Leaving the desktop app on a phone means going to /m; pinning it means
    // staying. Either way the parameter is dropped from the address so the
    // link people copy afterwards carries the app, not the override.
    if (!wantsDesktop && nextUrl.pathname === "/") url.pathname = "/m";
    if (wantsDesktop && nextUrl.pathname === "/m") url.pathname = "/";

    const response = NextResponse.redirect(url);
    response.cookies.set(OVERRIDE_COOKIE, wantsDesktop ? "desktop" : "phone", {
      path: "/",
      maxAge: ONE_YEAR,
      sameSite: "lax",
    });
    return response;
  }

  if (nextUrl.pathname !== "/") return NextResponse.next();
  if (cookies.get(OVERRIDE_COOKIE)?.value === "desktop") return NextResponse.next();
  if (!PHONE_UA.test(headers.get("user-agent") ?? "")) return NextResponse.next();

  /* The search string is carried across whole. ?screen= and ?view= are how one
   * driver tells another what to look at, and dropping them here would turn a
   * shared link into "the app, somewhere". /m reads what it can honour. */
  const url = nextUrl.clone();
  url.pathname = "/m";
  return NextResponse.redirect(url);
}

export const config = {
  /* Only the two app roots. Everything else — /api, /icon, /manifest.webmanifest,
   * _next assets — must never be redirected: an API call answering with a 307 to
   * an HTML page is the kind of failure that reads as a parse error somewhere
   * far away from its cause. */
  matcher: ["/", "/m"],
};
