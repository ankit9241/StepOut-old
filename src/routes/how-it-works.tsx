import { createFileRoute, Link } from "@tanstack/react-router";
import { Page } from "@/components/site";

export const Route = createFileRoute("/how-it-works")({
  head: () => ({
    meta: [
      { title: "How it works — StepOut" },
      {
        name: "description",
        content:
          "The screen is the shortest part. How StepOut turns context into a real-world task.",
      },
      { property: "og:title", content: "How it works — StepOut" },
      { property: "og:description", content: "The screen is the shortest part." },
    ],
  }),
  component: How,
});

const STEPS = [
  ["Tell us where you are in your day", "Give us your available time, energy and constraints."],
  [
    "Gemma creates the challenge",
    "Open-source AI turns that context into a small real-world task.",
  ],
  ["Leave the screen", "The challenge is designed to be completed away from your phone."],
  ["Come back", "Reflect on what happened if you want to."],
];

function How() {
  return (
    <Page>
      <h1 className="display rise max-w-3xl text-5xl md:text-8xl">
        The screen is the shortest part.
      </h1>

      <ol className="rise-3 mt-20">
        {STEPS.map(([t, d], i) => (
          <li key={t} className="grid gap-3 border-t py-10 md:grid-cols-12 md:gap-10">
            <span className="display text-2xl text-primary md:col-span-1">0{i + 1}</span>
            <h2 className="display text-3xl md:col-span-6 md:text-4xl">{t}</h2>
            <p className="text-muted-foreground md:col-span-5 md:pt-2">{d}</p>
          </li>
        ))}
      </ol>

      <section className="grid gap-6 border-t pt-16 md:grid-cols-12 md:gap-10">
        <p className="label md:col-span-4">Why open-source AI?</p>
        <div className="max-w-xl md:col-span-8">
          <p className="text-lg">
            StepOut is designed around open-weight models. Challenge generation can run
            locally, on your own hardware, and the model can be swapped or adapted to your place,
            language and pace.
          </p>
          <Link to="/create" className="btn mt-10">
            Get a challenge →
          </Link>
        </div>
      </section>
    </Page>
  );
}
