import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { OptionGroup, Page } from "@/components/site";
import { generateChallenge, store, type Context } from "@/lib/captcha";

export const Route = createFileRoute("/create")({
  head: () => ({
    meta: [
      { title: "What do you have today? — StepOut" },
      {
        name: "description",
        content: "Share your time, energy and constraints to get a challenge that fits your day.",
      },
      { property: "og:title", content: "Create a challenge — StepOut" },
      {
        property: "og:description",
        content: "A little context helps the challenge fit your actual life.",
      },
    ],
  }),
  component: Create,
});

function Create() {
  const nav = useNavigate();
  const [ctx, setCtx] = useState<Context>({
    time: "10 min",
    energy: "Normal",
    company: "Alone",
    constraints: "",
    mood: "",
  });
  const set = (k: keyof Context) => (v: string) => setCtx((c) => ({ ...c, [k]: v }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    store.setContext(ctx);
    store.setChallenge(generateChallenge(ctx));
    store.setReflection(null);
    nav({ to: "/challenge" });
  };

  return (
    <Page narrow>
      <h1 className="display rise text-5xl md:text-7xl">What do you have today?</h1>
      <p className="rise-2 mt-5 text-muted-foreground">
        A little context helps the challenge fit your actual life.
      </p>

      <form onSubmit={submit} className="rise-3 mt-14">
        <OptionGroup
          label="Time available"
          options={["5 min", "10 min", "20 min", "30 min", "60+ min"]}
          value={ctx.time}
          onChange={set("time")}
        />
        <OptionGroup
          label="Energy"
          options={["Low", "Normal", "High"]}
          value={ctx.energy}
          onChange={set("energy")}
        />
        <OptionGroup
          label="Company"
          options={["Alone", "With someone", "Either"]}
          value={ctx.company}
          onChange={set("company")}
        />
        <label className="block border-t py-8">
          <span className="label">Constraints</span>
          <textarea
            rows={2}
            className="field mt-3 text-lg"
            value={ctx.constraints}
            onChange={(e) => set("constraints")(e.target.value)}
            placeholder="Can’t spend money, don’t want to talk to strangers, staying near home…"
          />
        </label>
        <label className="block border-t py-8">
          <span className="label">Mood / preference — optional</span>
          <input
            className="field mt-3 text-lg"
            value={ctx.mood}
            onChange={(e) => set("mood")(e.target.value)}
            placeholder="Something quiet / something weird / surprise me…"
          />
        </label>
        <div className="border-t pt-10">
          <button type="submit" className="btn w-full justify-center md:w-auto">
            Generate my challenge →
          </button>
        </div>
      </form>
    </Page>
  );
}
