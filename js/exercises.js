// Exercise names and form cues, copied from the Between Blocks app so the plan reads the same.
// `bw`: bodyweight (no weight field). `timed`: the target is seconds, logged as reps. `hold`: timed and held still.
// `coach`: the camera coach can run this exercise (push-ups, squats, glute bridges, Romanian deadlifts; see js/moves.js).
// `cable`: done on the cable machine (functional trainer); the weight is the stack's number, not dumbbells.

export const EXERCISES = {
  arm_circles: { name: "Arm circles", group: "warmup", bw: true, timed: true },
  pushup_he:  { name: "Push-up, hands elevated", group: "push", bw: true },
  pushup:     { name: "Push-up", group: "push", bw: true, coach: true },
  pushup_fe:  { name: "Push-up, feet elevated", group: "push", bw: true },
  dip:        { name: "Dip", group: "push", bw: true },
  db_bench:   { name: "DB bench press", group: "push" },
  db_incl:    { name: "DB incline press", group: "push" },
  db_ohp:     { name: "Overhead press", group: "push" },
  pushdown:   { name: "Tricep pushdown", group: "push", cable: true },
  cable_press: { name: "Cable chest press", group: "push", cable: true },
  cable_ohp:  { name: "Half-kneeling cable press", group: "push", cable: true },
  hang:       { name: "Dead hang", group: "pull", bw: true, timed: true, hold: true },
  scap_pull:  { name: "Scapular pull", group: "pull", bw: true },
  pullup_neg: { name: "Pull-up negative", group: "pull", bw: true },
  pullup_b:   { name: "Band pull-up", group: "pull", bw: true },
  pullup:     { name: "Pull-up, neutral grip", group: "pull", bw: true },
  table_row:  { name: "Table row", group: "pull", bw: true },
  db_row:     { name: "One-arm row", group: "pull" },
  db_pullover: { name: "DB pullover", group: "pull" },
  face_pull:  { name: "Face pull", group: "pull", cable: true },
  lat_pd:     { name: "Kneeling lat pulldown", group: "pull", cable: true },
  cable_row:  { name: "Cable row", group: "pull", cable: true },
  rev_fly:    { name: "Reverse fly, bent over", group: "pull" },
  db_curl:    { name: "Curl", group: "pull" },
  bw_squat:   { name: "Bodyweight squat", group: "legs", bw: true, coach: true },
  goblet:     { name: "Goblet squat", group: "legs", coach: true },
  split_sq:   { name: "Split squat", group: "legs" },
  lunge:      { name: "Walking lunge", group: "legs" },
  step_up:    { name: "Step-up", group: "legs" },
  cable_goblet: { name: "Cable goblet squat", group: "legs", cable: true },
  glute_br:   { name: "Glute bridge", group: "hinge", bw: true, coach: true },
  sl_bridge:  { name: "One-leg glute bridge", group: "hinge", bw: true },
  db_rdl:     { name: "Romanian deadlift", group: "hinge", coach: true },
  kb_swing:   { name: "Kettlebell swing", group: "hinge" },
  cable_rdl:  { name: "Cable Romanian deadlift", group: "hinge", cable: true },
  nordic:     { name: "Nordic curl", group: "hinge", bw: true },
  hollow:     { name: "Hollow hold", group: "core", bw: true, timed: true, hold: true },
  knee_raise: { name: "Hanging knee raise", group: "core", bw: true },
  ab_wheel:   { name: "Ab wheel", group: "core", bw: true },
  plank:      { name: "Plank", group: "core", bw: true, timed: true, hold: true },
  pallof:     { name: "Pallof press", group: "core", cable: true },
  farmer:     { name: "Farmer's walk", group: "carry", timed: true },
};

export const CUES = {
  arm_circles: ["Stand tall, arms straight out at shoulder height", "Small circles first, growing bigger", "30 seconds forwards, then 30 seconds backwards"],
  hang:       ["Neutral grips, arms fully straight", "Squeeze the handles, keep your legs still", "Step down before your grip gives out"],
  scap_pull:  ["Hang with straight arms", "Pull your shoulder blades down, elbows stay straight", "You rise 2–3 inches; lower slowly"],
  pullup_neg: ["Step up so your chin is over the bar", "Lower as slowly as you can, about 5 seconds", "Step back up. Never jump into it"],
  pullup_b:   ["Start from straight arms, chest up", "Pull until your chin clears the bar", "Lower under control, no dropping"],
  pullup:     ["Start from straight arms, chest up", "Pull until your chin clears the bar", "Lower under control, no dropping"],
  knee_raise: ["Hang with straight arms", "Lift your knees to hip height, no swinging", "Lower slowly and pause at the bottom"],
  pushup:     ["Hands under shoulders, body in one straight line", "Lower until your chest is a fist from the floor", "Elbows about 45° from your sides"],
  pushup_he:  ["Hands on a desk or counter", "Body in one straight line", "Lower your chest to the edge, push back"],
  bw_squat:   ["Feet shoulder width, toes slightly out", "Sit down until thighs are at least level", "Knees follow your toes, heels stay down"],
  goblet:     ["Hold one dumbbell upright at your chest", "Sit down between your knees, chest tall", "Drive up through your whole foot"],
  glute_br:   ["Feet flat, close to your hips", "Push through your heels, squeeze your glutes", "Pause a second at the top, ribs down"],
  sl_bridge:  ["One foot flat, the other leg straight out at knee height", "Push through the heel, hips stay level, no twisting", "Pause a second at the top; all reps on one side, then switch"],
  hollow:     ["Press your low back flat into the floor", "Arms and legs up, chin tucked", "Back lifting? Bend your knees until it stops"],
  db_curl:    ["Elbows pinned to your sides", "Curl up without swinging your back", "Lower slowly, about 2 seconds"],
  db_ohp:     ["Dumbbells at shoulder height", "Brace your stomach and press straight up", "Don't lean back; lower to your shoulders"],
  db_row:     ["Free hand and knee on the bench, back flat", "Pull the dumbbell toward your hip", "Lower all the way to a full stretch"],
  db_rdl:     ["Soft knees, push your hips back", "Dumbbells slide down your thighs, back flat", "Stop at a hamstring stretch, squeeze up"],
  farmer:     ["A dumbbell in each hand, arms straight at your sides", "Stand tall: shoulders down and back, no leaning", "Short, steady steps. Set them down before your grip fails"],
  // cable machine: first time on each, pick a pin you could move about 15 times, and note the number
  lat_pd:     ["Pulley at the top, two handles; kneel facing the stack, arms straight overhead", "Pull your elbows down to your sides until your hands reach your upper chest", "Let the weight back up slowly, all the way to straight arms"],
  cable_row:  ["Sit on the bench facing the machine, pulley low, feet planted", "Pull the handles to your lower ribs, squeezing your shoulder blades together", "Arms all the way straight between reps; sit tall, don't rock"],
  cable_press: ["Pulleys at chest height, a handle in each hand, facing away; one foot forward", "Press forward until your arms are straight, hands meeting in front", "Back slowly until your hands are beside your chest"],
  cable_ohp:  ["Pulley at the bottom; kneel on the knee on the cable's side, handle at your shoulder", "Squeeze your glutes and press straight up, no leaning", "Lower to your shoulder slowly; all reps on one side, then switch"],
  pushdown:   ["Pulley at the top, rope or short bar; elbows pinned to your sides", "Push down until your arms are straight, spread the rope at the bottom", "Let it up until your forearms are just above level; elbows don't move"],
  face_pull:  ["Pulley at face height, rope; hold the ends with thumbs toward you", "Pull the rope toward your eyes, hands apart, elbows high", "Pause, then let it back slowly. Keep it light"],
  cable_goblet: ["Pulley at the bottom, rope or handle held at your chest; step back a little", "Sit down between your knees, chest tall, heels down", "Stand up through your whole foot"],
  cable_rdl:  ["Pulley at the bottom, both handles or a rope; face the machine, step back", "Soft knees, push your hips back until you feel the hamstring stretch", "Squeeze your glutes to stand up; back stays flat"],
  pallof:     ["Pulley at chest height, stand side-on, handle held at your chest with both hands", "Press it straight out and hold 2 seconds; don't let it pull you round", "Back to your chest. All reps on one side, then switch"],
};

export const exName = (k) => (EXERCISES[k] && EXERCISES[k].name) || k;
export const isTimed = (k) => !!(EXERCISES[k] && EXERCISES[k].timed);
export const isHold = (k) => !!(EXERCISES[k] && EXERCISES[k].hold);   // timed and held still (vs. timed movement like arm circles)
export const isBodyweight = (k) => !!(EXERCISES[k] && EXERCISES[k].bw);
export const canCoach = (k) => !!(EXERCISES[k] && EXERCISES[k].coach);
export const isCable = (k) => !!(EXERCISES[k] && EXERCISES[k].cable);
