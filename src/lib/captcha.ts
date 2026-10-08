export type Challenge = {
  id: string;
  title: string;
  premise: string;
  duration: number;
  rules: string[];
  safetyNotes: string;
  reflectionPrompt: string;
};

export type Context = {
  time: string;
  energy: string;
  company: string;
  constraints: string;
  mood: string;
};

export type Reflection = { text: string; completed: string };

const SAFE = "Stay somewhere safe and public";

export const CHALLENGES: Challenge[] = [
  {
    id: "unnoticed",
    title: "Find somewhere you’ve never noticed before.",
    premise:
      "Walk for ten minutes without opening a map. When you find a place that makes you stop, stay there for three minutes.",
    duration: 10,
    rules: ["No maps", "No scrolling", "No searching", SAFE],
    safetyNotes: "Turn back whenever you want. Tell someone if you go far.",
    reflectionPrompt: "What made you stop?",
  },
  {
    id: "five-sounds",
    title: "Collect five sounds you can’t name.",
    premise:
      "Stand still somewhere outside. Close your eyes if it feels safe. Count five sounds you can hear but couldn’t describe to a friend.",
    duration: 5,
    rules: ["No headphones", "No recording", "Stand still", SAFE],
    safetyNotes: "Keep your eyes open near traffic.",
    reflectionPrompt: "Which sound stayed with you?",
  },
  {
    id: "colour",
    title: "Follow one colour until it runs out.",
    premise:
      "Pick the first red thing you see. Walk toward the next red thing, then the next. Stop when you can’t find another.",
    duration: 20,
    rules: ["No maps", "No photos", "Only one colour", SAFE],
    safetyNotes: "Don’t cross roads without looking up from the colour.",
    reflectionPrompt: "Where did the colour lead you?",
  },
  {
    id: "sky",
    title: "Watch the sky change once.",
    premise:
      "Find a place where you can see a wide piece of sky. Stay until something in it has visibly moved, faded or arrived.",
    duration: 10,
    rules: ["No phone in hand", "No music", "Stay put", SAFE],
    safetyNotes: "Never look directly at the sun.",
    reflectionPrompt: "What changed first?",
  },
];

const read = <T>(k: string): T | null => {
  if (typeof window === "undefined") return null;
  try {
    const v = sessionStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
};
const write = (k: string, v: unknown) => sessionStorage.setItem(k, JSON.stringify(v));

export const store = {
  getContext: () => read<Context>("pc.context"),
  setContext: (c: Context) => write("pc.context", c),
  getChallenge: () => read<Challenge>("pc.challenge") ?? CHALLENGES[0]!,
  setChallenge: (c: Challenge) => write("pc.challenge", c),
  getReflection: () => read<Reflection>("pc.reflection"),
  setReflection: (r: Reflection | null) => write("pc.reflection", r),
};

/** Mock generator. Replace with a call to the model later. */
export function generateChallenge(ctx: Context | null, exclude?: string): Challenge {
  const minutes = ctx ? parseInt(ctx.time) || 60 : 10;
  const pool = CHALLENGES.filter((c) => c.id !== exclude);
  const fit = pool.filter((c) => c.duration <= minutes);
  const list = fit.length ? fit : pool;
  return list[Math.floor(Math.random() * list.length)]!;
}

export const numberWord = (n: number) =>
  ({ 5: "Five", 10: "Ten", 20: "Twenty", 30: "Thirty", 60: "Sixty" })[n] ?? String(n);
