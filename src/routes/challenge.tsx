import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Page } from "@/components/site";
import { CHALLENGES, generateChallenge, store, type Challenge } from "@/lib/captcha";

export const Route = createFileRoute("/challenge")({
  head: () => ({
    meta: [
      { title: "Your CAPTCHA — Physical CAPTCHA" },
      {
        name: "description",
        content: "Your physical challenge. Read it once, then leave the screen.",
      },
      { property: "og:title", content: "Your CAPTCHA — Physical CAPTCHA" },
      { property: "og:description", content: "A small field instruction for the real world." },
    ],
  }),
  component: ChallengePage,
});

function ChallengePage() {
  const nav = useNavigate();
  const [c, setC] = useState<Challenge>(CHALLENGES[0]!);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => setC(store.getChallenge()), []);

  const another = () => {
    const next = generateChallenge(store.getContext(), c.id);
    store.setChallenge(next);
    setC(next);
  };
  const go = () => {
    setLeaving(true);
    setTimeout(() => nav({ to: "/go" }), 650);
  };

  return (
    <Page>
      <article
        key={c.id}
        className={`max-w-4xl transition-all duration-700 ${leaving ? "translate-y-[-12px] opacity-0" : ""}`}
      >
        <div className="rise flex items-baseline justify-between border-b pb-4">
          <p className="label !text-primary">Your CAPTCHA</p>
          <p className="label">{c.duration} minutes</p>
        </div>
        <h1 className="display rise-2 mt-10 text-[2.75rem] md:text-[5.5rem]">{c.title}</h1>
        <p className="rise-3 mt-8 max-w-xl text-lg md:text-xl">{c.premise}</p>

        <div className="rise-4 mt-14 grid gap-10 md:grid-cols-12">
          <div className="md:col-span-5">
            <p className="label">Rules</p>
            <ul className="mt-4">
              {c.rules.map((r) => (
                <li key={r} className="flex gap-4 border-b py-3">
                  <span className="text-primary">—</span>
                  {r}
                </li>
              ))}
            </ul>
          </div>
          <p className="text-sm text-muted-foreground md:col-span-5 md:col-start-8 md:pt-9">
            {c.safetyNotes}
          </p>
        </div>

        <div className="rise-4 mt-16 flex flex-col gap-6 md:flex-row md:items-center md:gap-10">
          <button onClick={go} className="btn justify-center">
            I’m going out →
          </button>
          <button onClick={another} className="link-quiet text-sm">
            Give me another one
          </button>
        </div>
      </article>
    </Page>
  );
}
