import { ANALYSIS_LABELS } from "../../../shared/sessionSummary.js";

export const SLP_STEPHEN_SOURCE =
  "https://slpstephen.com/blogs/news/the-complete-list-of-stuttering-treatment-techniques";

export type TechniqueBand = "preschool" | "school" | "adolescent";
export type PatternTag = (typeof ANALYSIS_LABELS)[number] | "Fear" | "Rate" | "Breath" | "Tension";

export interface TechniqueChunk {
  id: string;
  title: string;
  band: TechniqueBand;
  ages: string;
  patterns: PatternTag[];
  /** Passage embedded and later shown to Gemini as retrieval context. */
  text: string;
}

/**
 * Grounded passages from SLP Stephen Groner's "Looooong List of 27 Incredible
 * Stuttering Treatment Techniques." Chunked one technique per document so
 * retrieval can match conversation-mode pattern flags to a specific tool.
 */
export const SLP_STEPHEN_CHUNKS: TechniqueChunk[] = [
  {
    id: "slowed-speech",
    title: "The Slowed-Down Speech Technique (for parents and listeners)",
    band: "preschool",
    ages: "2–6, and as a model at any age",
    patterns: ["Rate", "Block", "SoundRep", "WordRep"],
    text: `Preschool therapy is often indirect: change the environment so a young brain can find more fluency, rather than asking a toddler to master a motor drill. Slowed-down speech does two things. It models a smoother rate, and it builds time into the conversation so the speaker feels less rushed. Talk a notch slower, like plodding through snow. Add slightly longer pauses in natural places. Stretch the beginning of the first word in a sentence, where children who stutter often have it hardest. Reflect their sentence back even slower: if they say they went to music class, you say it back in a slow, easy way. Do not bark "slow down" at the child. Show it. Source: SLP Stephen.`,
  },
  {
    id: "reduced-demands",
    title: "The Reduced Demands Technique (for parents)",
    band: "preschool",
    ages: "2–6",
    patterns: ["Fear", "Block", "Interjection"],
    text: `Talking in front of people is already hard work. Dial speaking demands way back. Have daily one-on-one time and let the child lead the topic. Do not finish their sentences or guess the word. Make more comments than questions so they are not in the hot seat: "He's climbing the castle" instead of "What's he doing now?" When you do ask, use closed questions that can be answered with a word or a yes/no. Leave a brief pause between turns. Treat the message as the most important thing in the room, not the stop-and-start way it arrived. A lighter speaking burden often leads to easier speech. Source: SLP Stephen.`,
  },
  {
    id: "verbal-feedback",
    title: "The Verbal Feedback Technique (Lidcombe / response contingencies)",
    band: "preschool",
    ages: "3–6 only",
    patterns: ["SoundRep", "WordRep", "Block"],
    text: `Only meant for children about 3–6. Parents give brief verbal responses about speech so the brain can learn without an intricate technique. Most comments should be for fluent speech: genuine praise ("that was lovely, smooth talking"), a simple self-evaluation question ("was that smooth?"), or a matter-of-fact acknowledge ("no bumps"). Rarely, for unambiguous stuttered speech, acknowledge ("a little bumpy there") or ask for self-correction ("can you say that again smoothly?"). If the child reacts negatively, stop the correction comments. This also normalizes talking about stuttering. Source: SLP Stephen / Lidcombe Program.`,
  },
  {
    id: "syllable-timed",
    title: "The Syllable-Timed Speech Technique (Westmead / robot speech)",
    band: "preschool",
    ages: "3–12; not shown to translate well to adults",
    patterns: ["SoundRep", "WordRep", "Block", "Rate"],
    text: `Syllable-timed speech uses rhythm to induce fluent speech. Break words into syllables and put a clear boundary after each one while keeping a normal tone and speed: talk.like.this. Practice with pictures first, then in conversation. Clinical trials: children 3–12 who practiced 5–10 minutes, four to six times per day, for 9–12 months reduced stuttering by 96%. The same results have not been seen in adults, likely because adult speech-motor systems are less plastic. Do not prescribe this as an adult first-line tool. Source: SLP Stephen / Westmead Program.`,
  },
  {
    id: "speech-mechanism",
    title: "Learn about the speech mechanism",
    band: "school",
    ages: "6+",
    patterns: ["Block", "Breath", "Tension"],
    text: `Speaking is the most physically complex thing humans do: more than 100 muscles in tenths of a second. Air from the diaphragm is the fuel. The larynx turns air into voice. Tongue, lips, and teeth shape about 45 English speech sounds. Vowels are open and voiced; consonants add constriction. Weaker neural connections for this rapid timing help explain disjointed speech in people who stutter. Teaching the mechanism is not a parlor trick — it gives a school-age speaker a map for later modification and shaping work, and it replaces "my mouth is broken" with "this system needs more time." Source: SLP Stephen.`,
  },
  {
    id: "cancellation",
    title: "The Cancellation Technique (post-block correction)",
    band: "school",
    ages: "6+",
    patterns: ["Block", "Tension", "Prolongation"],
    text: `Stuttering modification: the goal is not zero stuttering, but stuttering that is quicker, easier, and less effortful. A cancellation is a post-block correction. After you have started stuttering, pause, release the held tension in the mouth and throat, then stretch the stuttered sound and say it again more easily. Example: L-l-l-l (pause, let the pressure go) lllllike this. Use after a hard block when extra squeeze has already shown up. Source: SLP Stephen.`,
  },
  {
    id: "pull-out",
    title: "The Pull-Out Technique (in-block correction)",
    band: "school",
    ages: "6+",
    patterns: ["Block", "Prolongation", "Tension"],
    text: `A pull-out is like a cancellation but happens while you are already stuttering. Stay in the moment, then stretch the stuck sound gently and easily so it can slide forward instead of being forced. Example: L-l-l-l-lllllike this. You start stuttering, then lengthen the sound you are on and move to the next sound. Teach this after cancellation is familiar. Source: SLP Stephen.`,
  },
  {
    id: "preparatory-set",
    title: "The Preparatory Set Technique (pre-block correction)",
    band: "school",
    ages: "6+",
    patterns: ["Block", "Prolongation"],
    text: `Many people who stutter can see a feared word coming. A preparatory set eases through that word instead of slamming into a halt. Stretch the first sound of the upcoming word, then keep moving into the rest of the word and the sentence. Example: Lllllike this. Teach after cancellation and pull-out. It is for anticipated blocks, not after the word has already locked. Source: SLP Stephen.`,
  },
  {
    id: "light-bounces",
    title: "The Light Bounces Technique",
    band: "school",
    ages: "6+",
    patterns: ["SoundRep", "WordRep"],
    text: `Light bounces make repetitions gentle, quick, and less painful so the message can keep moving. Do not try to not stutter — that raises tension. Instead, keep the points of contact light so you get easy bounces rather than hard, tense repeats. Not N-N-N____NOT LIKE THIS (hard), but l-l-like this (easy). Best match when the session showed sound or word repetitions. Source: SLP Stephen.`,
  },
  {
    id: "voluntary-stuttering",
    title: "The Voluntary Stuttering Technique (pseudostuttering)",
    band: "school",
    ages: "6+",
    patterns: ["Fear", "SoundRep", "WordRep"],
    text: `One of the worst parts of stuttering is feeling out of control. Voluntary stuttering inserts easy, chosen repetitions into speech that would otherwise have been fluent. Repeat the first sound gently, then move on. You decide when to stutter. That reduces fear of the moment; reduced fear often lets more fluent speech through. It can feel backwards. Offer it as an experiment, never a demand. Source: SLP Stephen.`,
  },
  {
    id: "reduced-rate",
    title: "The Reduced Rate Technique",
    band: "school",
    ages: "6+",
    patterns: ["Rate", "Block", "SoundRep", "WordRep", "Interjection"],
    text: `Speaking needs instant coordination of hundreds of muscles. Slowing rate buys the brain time. It will feel like walking through snow. Practice on name, hometown, school or job at about half speed. Important: only telling someone who stutters to "slow down" will not solve stuttering. This is a practiced, slightly reduced rate, not a scold. Useful when conversation flags show rushing, interjections, or pile-ups of repetitions. Source: SLP Stephen.`,
  },
  {
    id: "pauses-phrasing",
    title: "The Pauses and Phrasing Technique",
    band: "school",
    ages: "6+",
    patterns: ["Rate", "Interjection", "Breath", "Block"],
    text: `Same principle as reduced rate: buy time. Add more pauses in reasonable, natural places than you usually would. Talk (pause) more like this (pause) with thoughtful breaks, instead of pushing a whole paragraph out in one squeeze. This lowers mental workload and gives the breath a place to reset. Strong match for interjections, rushing, and running out of air. Source: SLP Stephen.`,
  },
  {
    id: "eye-contact",
    title: "The Confident Eye Contact Technique",
    band: "school",
    ages: "6+",
    patterns: ["Fear"],
    text: `The most common response to stuttering is looking away. Holding eye contact during a moment of disfluency builds confidence and desensitizes the discomfort. Listeners often stay with you. Practice: look at someone, say your name, hometown, school or job, and do not break eye contact if a stutter comes. If you look away, try that item again. This is about staying present, not staring people down. Source: SLP Stephen.`,
  },
  {
    id: "self-disclosure",
    title: "The Self-Advertising Technique (self-disclosure)",
    band: "school",
    ages: "6+",
    patterns: ["Fear"],
    text: `Panic about being "found out" can tighten speech further. Self-advertising is naming that you stutter as you start a conversation or after a moment has happened: you may need a little more time to get a word out. Stephen's example: "I speak with a slight stutter, so if you hear me get caught on a word, I just need a little more time." It can take the performance edge off. It is also often the hardest thing. Offer it as optional. If they try once and it does not help, they never have to do it again. Source: SLP Stephen.`,
  },
  {
    id: "community",
    title: "Join a stuttering community group",
    band: "school",
    ages: "6+",
    patterns: ["Fear"],
    text: `For many people who stutter, conversation has felt like a judgment zone. Support groups change that: everyone already knows the experience. Belonging can reduce loneliness and, for some, reduce how badly they stutter. Point to the National Stuttering Association, Camp SAY, and FRIENDS. This is an environmental/emotional tool, not a motor drill. Source: SLP Stephen.`,
  },
  {
    id: "stretched-syllable",
    title: "The Stretched Syllable Technique",
    band: "adolescent",
    ages: "12+, some older school-age by trial",
    patterns: ["Block", "Prolongation", "Rate"],
    text: `Fluency shaping / prolonged speech. Slow speech systematically so tiny changes become perceptible. Break a word into syllables. Stretch each syllable for two seconds: first stretchable sound for one second, remaining sounds for the second second, then rest. Example "lightly": Llllll-iiight, rest, llllll-yyyyyy. Sounds that should not be slowed (P B T D K G F S SH CH H unvoiced TH): skip to the first stretchable sound (vowels, M N W V L J R Y Z voiced TH). This is a training rate, not how they must talk forever. Speed it up later with gentle onset and continuous phonation. Source: SLP Stephen.`,
  },
  {
    id: "diaphragmatic",
    title: "The Diaphragmatic Breathing Technique",
    band: "adolescent",
    ages: "12+",
    patterns: ["Breath", "Block", "Tension"],
    text: `Breath is fuel. People who stutter may use shallow breaths, gulps, or squeezing on empty lungs after years of fighting blocks. Breathe with the diaphragm, not the small chest and neck muscles. Relax mouth, throat, and neck. Feel the stomach expand as the diaphragm drops. Take a comfortably full breath. Do not clench at the top — switch immediately into an easy release. Practice ten easy breaths before talking. Match this when the session looks like holding, gasping, or blocks tied to empty air. Source: SLP Stephen.`,
  },
  {
    id: "gentle-onset",
    title: "The Gentle Onset Technique",
    band: "adolescent",
    ages: "12+",
    patterns: ["Block", "Prolongation"],
    text: `Vocal folds can turn on too abruptly, which can show up as blocks. A gentle onset starts voicing at the lowest, softest vibration, swells to normal volume, then eases back. Start at the crest of a comfortable diaphragmatic breath with no hesitation. For unvoiced consonants, put the gentle onset on the first stretchable sound after them (Pay: paaaAAAAAaaay). Keep chest, neck, and face soft. Use with stretched syllable and diaphragmatic breathing in training, then in running speech as continuous phonation. Source: SLP Stephen.`,
  },
  {
    id: "light-contacts",
    title: "The Light Articulatory Contacts Technique",
    band: "adolescent",
    ages: "12+",
    patterns: ["Block", "Prolongation", "Tension"],
    text: `Every consonant needs a touch or narrowing in the mouth. A lot of stuttering happens at those contact points. Light contacts reduce the force so speech can flow: come into position, then touch only as firmly as needed for the sound to still be itself. Practice on P B K, then pot/tip/great, then short sentences. Strong match for hard contacts, pressed prolongations, and tense blocks. Source: SLP Stephen.`,
  },
  {
    id: "continuous-phonation",
    title: "The Continuous Phonation Technique",
    band: "adolescent",
    ages: "12+",
    patterns: ["Block", "Prolongation", "Rate"],
    text: `Continuous phonation is gentle onsets strung together in running speech. Relax. Diaphragmatic breath. Start the first syllable with a soft swell, and do not let voicing die completely before the next syllable uses that leftover vibration. Cycle the ups and downs across the phrase. Build from "I can" to a longer sentence on one breath. Adult fluency-shaping tool when blocks cluster at voice onset. Source: SLP Stephen.`,
  },
  {
    id: "daf",
    title: "Delayed / frequency-altered auditory feedback",
    band: "adolescent",
    ages: "12+",
    patterns: ["SoundRep", "WordRep", "Block"],
    text: `Choral speech (pledge of allegiance with a group) often melts stuttering because of a second rhythmic signal. Small devices such as SpeechEasy play your voice back delayed by milliseconds or at a slightly different pitch. They can induce fluency; some people find the effect wears off with all-day use. This is a device option, not a first homework drill. Mention only if retrieved as a match, with the wear-off caveat. Source: SLP Stephen.`,
  },
  {
    id: "attention-shift",
    title: "The Attention Shift Technique",
    band: "adolescent",
    ages: "12+",
    patterns: ["Fear", "Block", "SoundRep"],
    text: `Shift focus off the stutter and onto meaning. As you say each word, picture what that word describes — not the whole sentence as one image, but word by word. "Hi" might be a wave; "pizza" a slice with cheese. The disclosure in the article: not peer-reviewed, but may help some speakers find spontaneous fluency by taking pressure off the mouth. Offer as an optional experiment. Source: SLP Stephen.`,
  },
  {
    id: "sing-to-start",
    title: "The Sing-to-Start Technique",
    band: "adolescent",
    ages: "12+",
    patterns: ["Block", "Rate", "Fear"],
    text: `People often stutter less when they sing because of built-in rhythm. Sing-to-start: as you open your mouth for a new sentence, prepare internally as if you are about to sing it, then speak it instead of singing. Practice on name, hometown, and an order sentence. Article disclosure: not peer-reviewed; theoretically uses the same fluency people get from singing. Optional, one-trial tool. Source: SLP Stephen.`,
  },
  {
    id: "modifying-phonation",
    title: "Modifying Phonation Intervals (MPI)",
    band: "adolescent",
    ages: "adults, with trained clinician and app",
    patterns: ["Block", "Prolongation"],
    text: `MPI means changing how long the voice stays on. Too many short voiced spurts were linked with more stuttering. Software measures phonation interval length and feeds back when the shortest spans happen so the speaker learns to lengthen voicing. Requires a special app and a specially trained SLP. Do not present this as something they can do from a one-line tip in conversation mode. Source: SLP Stephen.`,
  },
  {
    id: "daily-affirmations",
    title: "Daily Affirmations",
    band: "adolescent",
    ages: "12+",
    patterns: ["Fear"],
    text: `Self-talk shapes what we attempt. People who stutter often carry years of "this will be bad." Daily affirmations replace that with practiced lines, ten times each: one about being safe and okay, one about connecting with people, one about speech being allowed to flow. Example set: "You are good, important, and loved." "You like to connect with people." "You love to talk easily." Language will not delete stuttering, but it can change approach and avoidance. Source: SLP Stephen.`,
  },
  {
    id: "progressive-relaxation",
    title: "Progressive Muscle Relaxation",
    band: "adolescent",
    ages: "10+",
    patterns: ["Tension", "Block", "Breath"],
    text: `Years of forcing words leave the speech system tight. Progressive muscle relaxation teaches the brain the feeling of less: scrunch forehead five seconds ("tight"), then release ("soft"). Repeat with cheeks, then neck/larynx. Three rounds before talking. This is a pre-speech reset, not an emergency brake mid-block. If tensing hurts, skip the squeeze and only practice unclenching. Source: SLP Stephen.`,
  },
  {
    id: "rewarding-interaction",
    title: "The Rewarding Interaction Technique",
    band: "adolescent",
    ages: "12+",
    patterns: ["Fear"],
    text: `The brain prepares movements it expects to be safe. If talking has mostly meant shame, automatic speech preparation can go thin. During a conversation, consciously tell yourself that connecting will be rewarding, not injurious — before, during, and after. This is not fake cheer. If a moment was hard, say so, then still notice being understood. Helps when avoidance and fear showed up more than a specific motor pattern. Source: SLP Stephen.`,
  },
];

export function chunkToEmbeddingText(chunk: TechniqueChunk): string {
  return [
    chunk.title,
    `Age band: ${chunk.band} (${chunk.ages})`,
    `Helpful when: ${chunk.patterns.join(", ")}`,
    chunk.text,
  ].join("\n");
}
