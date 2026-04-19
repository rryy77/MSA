import { type NextRequest, NextResponse } from "next/server";
import { decodeMsaSessionCookie, MSA_SESSION_COOKIE_NAME } from "@/lib/msaSession";

/**
 * Next.js 16 では middleware の代わりに proxy のみ使用可能。
 * ページ遷移のみ MSA Cookie を要求。API は各 Route Handler で認可する
 * （参加用トークンでの PATCH など、Cookie なしのリクエストがあるため）。
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/p/") ||
    pathname.startsWith("/auth/")
  ) {
    return NextResponse.next();
  }

  if (pathname.includes(".") && pathname !== "/favicon.ico") {
    return NextResponse.next();
  }

  const raw = request.cookies.get(MSA_SESSION_COOKIE_NAME)?.value;
  if (!decodeMsaSessionCookie(raw)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
