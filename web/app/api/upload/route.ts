import { NextResponse } from "next/server";

/* Hand a .ibt to the ingest service.
 *
 * The browser posts here rather than straight at Render, for two reasons that
 * both matter: the ingest URL stays server-side, and the upload travels
 * same-origin so it is not at the mercy of a CORS policy that has to stay open
 * to "*" to work.
 *
 * This route does not parse anything. Parsing is Python on Render (the language
 * boundary in CLAUDE.md), and this side only forwards bytes and relays what the
 * service says back — including its failures, verbatim. A file that cannot be
 * read has to reach the driver as a reason, never as a silent nothing. */

export const dynamic = "force-dynamic";
// A session .ibt runs to tens of megabytes; the default body budget is smaller
// than that, and a truncated telemetry file fails deep inside the parser with a
// confusing error rather than at the door.
export const maxDuration = 60;

const DEFAULT_INGEST_URL = "https://proctor-ingest.onrender.com/ingest";

/** Telemetry files only. The parser rejects anything else anyway, but it does
 *  so after the whole file has crossed the network. */
const ALLOWED = /\.ibt$/i;

export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch (error) {
    return NextResponse.json(
      { error: `That upload could not be read as a file: ${String(error)}` },
      { status: 400 },
    );
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file was attached to the upload." }, { status: 400 });
  }
  if (!ALLOWED.test(file.name)) {
    return NextResponse.json(
      {
        error: `${file.name} is not a .ibt telemetry file. iRacing writes these into your telemetry folder at the end of a session.`,
      },
      { status: 400 },
    );
  }
  if (file.size === 0) {
    return NextResponse.json(
      { error: `${file.name} is empty — iRacing may still have been writing it.` },
      { status: 400 },
    );
  }

  const target = process.env.PROCTOR_INGEST_URL ?? DEFAULT_INGEST_URL;

  const forward = new FormData();
  forward.set("file", file, file.name);
  forward.set("user_id", String(form.get("user_id") ?? "caden"));
  // force=true re-runs a file whose bytes are already known, which is what the
  // driver means when they upload the same session again after new analysis
  // modules have landed.
  if (form.get("force") === "true") forward.set("force", "true");

  let res: Response;
  try {
    res = await fetch(target, { method: "POST", body: forward });
  } catch (error) {
    return NextResponse.json(
      {
        error: `The ingest service could not be reached: ${String(error)}. The file was not uploaded, so nothing was lost — try again once it is back.`,
      },
      { status: 502 },
    );
  }

  const text = await res.text();
  if (!res.ok) {
    return NextResponse.json(
      { error: `The ingest service rejected ${file.name}: ${res.status} ${text.slice(0, 500)}` },
      { status: res.status },
    );
  }

  try {
    return NextResponse.json(JSON.parse(text));
  } catch {
    return NextResponse.json(
      { error: `The ingest service replied with something that is not JSON: ${text.slice(0, 300)}` },
      { status: 502 },
    );
  }
}
