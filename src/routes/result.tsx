import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Page } from "@/components/site";
import {
  CHALLENGES,
  generateChallenge,
  numberWord,
  store,
  type Challenge,
  type Reflection,
} from "@/lib/captcha";

export const Route = createFileRoute("/result")({
  head: () => ({
    meta: [
      { title: "You went somewhere — StepOut" },
      { name: "description", content: "A short field note on what you did away from the screen." },
      { property: "og:title", content: "You went somewhere — StepOut" },
      { property: "og:description", content: "A personal field note." },
    ],
  }),
  component: Result,
});

function Result() {
  const nav = useNavigate();
  const [c, setC] = useState<Challenge>(CHALLENGES[0]!);
  const [r, setR] = useState<Reflection | null>(null);
  useEffect(() => {
    setC(store.getChallenge());
    setR(store.getReflection());
  }, []);

  const mins = numberWord(c.duration).toLowerCase();
  const partial = r && r.completed !== "Yes";
  const reflection = partial
    ? `You set out on a ${mins}-minute challenge and didn’t finish it the way it was written. That’s fine. You still left the screen, and the part you did was real.`
    : `You started with a ${mins}-minute challenge and ended up paying attention to something you would usually walk past. That was the point.`;

  const another = () => {
    store.setChallenge(generateChallenge(store.getContext(), c.id));
    store.setReflection(null);
    nav({ to: "/challenge" });
  };

  return (
    <Page narrow>
      <p className="label rise">Field note</p>
      <h1 className="display rise-2 mt-6 text-6xl md:text-8xl">You went somewhere.</h1>
      <p className="display rise-3 mt-10 text-2xl italic md:text-3xl">{reflection}</p>

      <dl className="rise-4 mt-16">
        <div className="border-t py-8">
          <dt className="label">What you did</dt>
          <dd className="mt-3 text-lg">
            {c.title} {c.premise}
          </dd>
        </div>
        <div className="border-t py-8">
          <dt className="label">What you noticed</dt>
          <dd className="mt-3 text-lg">
            {r?.text?.trim() ? (
              <>“{r.text.trim()}”</>
            ) : (
              <span className="text-muted-foreground">
                Kept to yourself. Some things are better that way.
              </span>
            )}
          </dd>
        </div>
        <div className="border-t py-8">
          <dt className="label !text-primary">Next Challenge</dt>
          <dd className="mt-6">
            <button onClick={another} className="btn">
              Give me another →
            </button>
          </dd>
        </div>
      </dl>
    </Page>
  );
}
