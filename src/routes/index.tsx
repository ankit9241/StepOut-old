import { createFileRoute, Link } from "@tanstack/react-router";
import { Page } from "@/components/site";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "StepOut — Real-World Challenges Away From Your Screen" },
      {
        name: "description",
        content:
          "Give a little context. Get a small physical challenge to complete away from your screen.",
      },
      { property: "og:title", content: "StepOut" },
      { property: "og:description", content: "Step out from your screen into the real world." },
    ],
  }),
  component: Index,
});

const LOOP = ["Tell us", "Get challenged", "Go outside", "Come back"];

function Index() {
  return (
    <Page>
      <section className="max-w-4xl">
        <p className="label rise">StepOut</p>
        <h1 className="display rise-2 mt-6 text-[3.25rem] md:text-[7rem]">
          A challenge you can’t solve from your <em className="text-primary">screen.</em>
        </h1>
        <p className="rise-3 mt-8 max-w-md text-lg text-muted-foreground">
          Give us a little context. We’ll give you something to do in the real world.
        </p>
        <div className="rise-4 mt-10 flex flex-wrap items-center gap-8">
          <Link to="/dashboard" className="btn">
            Mind Dump & Dashboard →
          </Link>
          <Link to="/create" className="link-quiet text-sm">
            Get a challenge
          </Link>
          <Link to="/how-it-works" className="link-quiet text-sm">
            How it works
          </Link>
        </div>
      </section>

      <ol className="mt-28 grid border-t md:mt-40 md:grid-cols-4">
        {LOOP.map((s, i) => (
          <li key={s} className="flex items-baseline gap-4 border-b py-6 md:border-b-0 md:py-8">
            <span className="label">0{i + 1}</span>
            <span className="display text-3xl">{s}</span>
          </li>
        ))}
      </ol>

      <section className="mt-28 grid gap-10 md:mt-40 md:grid-cols-12">
        <p className="label md:col-span-4">Your screen is only the starting point.</p>
        <div className="md:col-span-8">
          <p className="display text-3xl md:text-5xl">
            The AI creates a small physical challenge based on your available time, energy and
            constraints.
          </p>
          <p className="mt-6 max-w-lg text-muted-foreground">
            The challenge is designed to be completed away from your phone. You read it once, put
            the phone away, and go.
          </p>
          <Link to="/create" className="btn mt-10">
            Go outside
          </Link>
        </div>
      </section>
    </Page>
  );
}
